use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::exit;

use clap::{Args, Parser, Subcommand};
use contract::error::{exit_code_for_status, ErrorEnvelope};
use reqwest::blocking::{multipart, Client, RequestBuilder, Response};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const SKILL_FILES: &[(&str, &str)] = &[
    ("SKILL.md", include_str!("../skill/SKILL.md")),
    ("references/assigner.md", include_str!("../skill/references/assigner.md")),
    ("references/developer.md", include_str!("../skill/references/developer.md")),
    ("references/tester.md", include_str!("../skill/references/tester.md")),
    ("references/cli.md", include_str!("../skill/references/cli.md")),
];

#[derive(Parser)]
#[command(name = "wtow", version, about = "WTOW 小作文托管平台 CLI")]
struct Cli {
    #[command(flatten)]
    g: Global,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Args)]
struct Global {
    #[arg(long, global = true)]
    json: bool,
    #[arg(long, global = true)]
    base_url: Option<String>,
    #[arg(long, global = true)]
    project: Option<String>,
    #[arg(long, global = true)]
    token: Option<String>,
    #[arg(long, global = true)]
    idempotency_key: Option<String>,
}

#[derive(Subcommand)]
enum Cmd {
    Login {
        #[arg(long)]
        profile: Option<String>,
    },
    Whoami,
    Profile {
        #[command(subcommand)]
        cmd: ProfileCmd,
    },
    Skill {
        #[command(subcommand)]
        cmd: SkillCmd,
    },
    Raw {
        #[command(subcommand)]
        cmd: RawCmd,
    },
    Exec {
        #[command(subcommand)]
        cmd: ExecCmd,
    },
    File {
        #[command(subcommand)]
        cmd: FileCmd,
    },
}

#[derive(Subcommand)]
enum FileCmd {
    /// 下载附件，默认存到 .wtow/attachments/
    Get {
        id: String,
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
}

#[derive(Subcommand)]
enum ProfileCmd {
    List,
    Use { name: String },
}

#[derive(Subcommand)]
enum SkillCmd {
    Install {
        #[arg(long, default_value = "user", value_parser = ["user", "project"])]
        scope: String,
        /// 自定义 skills 目录（如 ~/.carter/skills），装到 <dir>/wtow；给了就忽略 --scope
        #[arg(long)]
        dir: Option<PathBuf>,
    },
}

#[derive(Subcommand)]
enum RawCmd {
    Submit {
        #[arg(long)]
        title: String,
        #[arg(long)]
        desc: String,
        #[arg(long = "tag")]
        tags: Vec<String>,
        #[arg(long = "attach")]
        attach: Vec<PathBuf>,
    },
    List {
        #[arg(long)]
        status: Option<String>,
        #[arg(long)]
        tag: Option<String>,
        #[arg(long)]
        q: Option<String>,
        #[arg(long)]
        mine: bool,
        #[arg(long)]
        page: Option<i64>,
        #[arg(long)]
        page_size: Option<i64>,
    },
    Get {
        id: String,
        /// 把附件下载到本地（默认 .wtow/attachments/<id>/），输出带 local_path 与 description_local
        #[arg(long, num_args = 0..=1)]
        download: Option<Option<PathBuf>>,
    },
    Claim { id: String },
    Release { id: String },
    Related { id: String },
    Execs { id: String },
    Edit {
        id: String,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        desc: Option<String>,
        #[arg(long = "tag")]
        tags: Option<Vec<String>>,
        #[arg(long)]
        if_match: Option<i32>,
    },
    Merge {
        id: String,
        #[arg(long)]
        into: String,
        #[arg(long)]
        reason: String,
        #[arg(long)]
        skip_related_check: bool,
    },
    Duplicate {
        id: String,
        #[arg(long)]
        of: String,
        #[arg(long)]
        reason: String,
        #[arg(long)]
        skip_related_check: bool,
    },
    Ignore {
        id: String,
        #[arg(long)]
        reason: String,
    },
    Reopen {
        id: String,
        #[arg(long)]
        reason: String,
    },
}

#[derive(Subcommand)]
enum ExecCmd {
    Create {
        #[arg(long = "from", value_delimiter = ',', required = true)]
        from: Vec<String>,
        #[arg(long)]
        instruction: String,
        #[arg(long = "target")]
        targets: Vec<String>,
        #[arg(long)]
        priority: Option<String>,
        #[arg(long)]
        developer: Option<i64>,
        #[arg(long)]
        close: bool,
        #[arg(long)]
        skip_related_check: bool,
        #[arg(long = "attach")]
        attach: Vec<PathBuf>,
    },
    List {
        #[arg(long)]
        status: Option<String>,
        #[arg(long)]
        developer: Option<i64>,
        #[arg(long)]
        target: Option<String>,
        #[arg(long)]
        q: Option<String>,
        #[arg(long)]
        page: Option<i64>,
        #[arg(long)]
        page_size: Option<i64>,
    },
    Get {
        id: String,
        /// 把附件下载到本地（默认 .wtow/attachments/<id>/），输出带 local_path 与 instruction_local
        #[arg(long, num_args = 0..=1)]
        download: Option<Option<PathBuf>>,
    },
    Raws { id: String },
    Claim {
        id: String,
        #[arg(long)]
        force: bool,
    },
    Release {
        id: String,
        #[arg(long)]
        reason: String,
    },
    Cancel {
        id: String,
        #[arg(long)]
        reason: String,
        #[arg(long)]
        no_requeue: bool,
    },
    Reopen {
        id: String,
        #[arg(long)]
        reason: String,
    },
    Complete {
        id: String,
        #[arg(long)]
        notes: String,
        #[arg(long = "link")]
        links: Vec<String>,
    },
    Edit {
        id: String,
        #[arg(long)]
        instruction: Option<String>,
        #[arg(long)]
        priority: Option<String>,
        #[arg(long = "target")]
        targets: Option<Vec<String>>,
        #[arg(long)]
        notes: Option<String>,
        #[arg(long = "link")]
        links: Option<Vec<String>>,
        #[arg(long)]
        if_match: Option<i32>,
    },
}

#[derive(Default, Serialize, Deserialize)]
struct Profile {
    base_url: Option<String>,
    project: Option<String>,
    token: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct UserConfig {
    active: Option<String>,
    #[serde(default)]
    profiles: BTreeMap<String, Profile>,
}

#[derive(Default, Deserialize)]
struct RepoConfig {
    base_url: Option<String>,
    project: Option<String>,
}

fn fail(code: i32, json: bool, err_code: &str, message: &str) -> ! {
    if json {
        eprintln!("{}", json!({ "error": { "code": err_code, "message": message, "details": null } }));
    } else {
        eprintln!("error: {message}");
    }
    exit(code)
}

fn config_path() -> PathBuf {
    dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("wtow/config.toml")
}

fn load_user_config() -> UserConfig {
    std::fs::read_to_string(config_path()).ok().and_then(|s| toml::from_str(&s).ok()).unwrap_or_default()
}

fn save_user_config(cfg: &UserConfig, json: bool) {
    let path = config_path();
    let write = || -> std::io::Result<()> {
        std::fs::create_dir_all(path.parent().unwrap())?;
        std::fs::write(&path, toml::to_string_pretty(cfg).unwrap())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(())
    };
    if let Err(e) = write() {
        fail(1, json, "CONFIG", &format!("cannot write {}: {e}", path.display()));
    }
}

fn find_repo_config() -> RepoConfig {
    let mut dir = std::env::current_dir().ok();
    while let Some(d) = dir {
        let p = d.join(".wtow.toml");
        if p.is_file() {
            return std::fs::read_to_string(p).ok().and_then(|s| toml::from_str(&s).ok()).unwrap_or_default();
        }
        dir = d.parent().map(Path::to_path_buf);
    }
    RepoConfig::default()
}

struct Resolved {
    base_url: String,
    project: String,
    token: String,
}

/// 优先级：参数 > 环境变量 > .wtow.toml > 用户配置 active profile，见 DESIGN 11.1。
fn resolve(g: &Global) -> Resolved {
    let user = load_user_config();
    let prof = user.active.as_ref().and_then(|a| user.profiles.get(a));
    let repo = find_repo_config();
    let env = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    let pick = |flag: &Option<String>, env_key: &str, repo_v: Option<&String>, prof_v: Option<&String>| {
        flag.clone().or_else(|| env(env_key)).or_else(|| repo_v.cloned()).or_else(|| prof_v.cloned())
    };
    let base_url = pick(&g.base_url, "WTOW_BASE_URL", repo.base_url.as_ref(), prof.and_then(|p| p.base_url.as_ref()));
    let project = pick(&g.project, "WTOW_PROJECT", repo.project.as_ref(), prof.and_then(|p| p.project.as_ref()));
    let token = g.token.clone().or_else(|| env("WTOW_TOKEN")).or_else(|| prof.and_then(|p| p.token.clone()));
    let missing = |what: &str| -> ! {
        fail(2, g.json, "UNAUTHENTICATED", &format!(
            "missing {what}; run: wtow login --base-url <url> --project <slug> --token <token>"
        ))
    };
    Resolved {
        base_url: base_url.unwrap_or_else(|| missing("base_url")).trim_end_matches('/').to_string(),
        project: project.unwrap_or_else(|| missing("project")),
        token: token.unwrap_or_else(|| missing("token")),
    }
}

fn version_lt(a: &str, b: &str) -> bool {
    let parse = |s: &str| s.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    parse(a) < parse(b)
}

struct Api {
    http: Client,
    r: Resolved,
    json: bool,
    idem: Option<String>,
}

impl Api {
    fn new(r: Resolved, g: &Global) -> Self {
        let http = Client::builder()
            .user_agent(format!("wtow-cli/{VERSION}"))
            .build()
            .unwrap_or_else(|e| fail(5, g.json, "NETWORK", &e.to_string()));
        let api = Api { http, r, json: g.json, idem: g.idempotency_key.clone() };
        api.check_meta();
        api
    }

    fn check_meta(&self) {
        let meta: contract::dto::Meta = self
            .http
            .get(format!("{}/api/v1/meta", self.r.base_url))
            .send()
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.json())
            .unwrap_or_else(|e| fail(5, self.json, "NETWORK", &format!("cannot reach {}: {e}", self.r.base_url)));
        if version_lt(VERSION, &meta.min_cli_version) {
            fail(1, self.json, "CLI_TOO_OLD", &format!(
                "wtow {VERSION} is older than required {}; upgrade: curl -fsSL {}/install.sh | sh",
                meta.min_cli_version, self.r.base_url
            ));
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}/api/v1/projects/{}{path}", self.r.base_url, self.r.project)
    }

    fn req(&self, method: Method, path: &str) -> RequestBuilder {
        let mut b = self.http.request(method.clone(), self.url(path)).bearer_auth(&self.r.token);
        if method == Method::POST {
            let key = self.idem.clone().unwrap_or_else(random_key);
            b = b.header("Idempotency-Key", key);
        }
        b
    }

    fn send(&self, b: RequestBuilder) -> Value {
        let text = self.checked(b).text().unwrap_or_default();
        serde_json::from_str(&text).unwrap_or(Value::Null)
    }

    /// 发送请求；非 2xx 时按错误信封输出并以对应退出码退出。
    fn checked(&self, b: RequestBuilder) -> Response {
        let resp = b.send().unwrap_or_else(|e| fail(5, self.json, "NETWORK", &e.to_string()));
        let status = resp.status();
        if status.is_success() {
            return resp;
        }
        let text = resp.text().unwrap_or_default();
        let code = exit_code_for_status(status.as_u16());
        match serde_json::from_str::<ErrorEnvelope>(&text) {
            Ok(env) if self.json => {
                eprintln!("{}", serde_json::to_string(&env).unwrap());
                exit(code)
            }
            Ok(env) => {
                eprintln!("error [{}]: {}", env.error.code, env.error.message);
                if !env.error.details.is_null() {
                    eprintln!("{}", serde_json::to_string_pretty(&env.error.details).unwrap());
                }
                exit(code)
            }
            Err(_) => fail(code, self.json, "HTTP", &format!("HTTP {status}: {}", text.chars().take(200).collect::<String>())),
        }
    }

    fn get(&self, path: &str, query: &[(&str, Option<String>)]) -> Value {
        let q: Vec<(&str, String)> = query.iter().filter_map(|(k, v)| v.clone().map(|v| (*k, v))).collect();
        self.send(self.req(Method::GET, path).query(&q))
    }

    fn post(&self, path: &str, body: Value) -> Value {
        self.send(self.req(Method::POST, path).json(&body))
    }

    fn upload(&self, files: &[PathBuf]) -> Vec<String> {
        files
            .iter()
            .map(|f| {
                let form = multipart::Form::new()
                    .file("file", f)
                    .unwrap_or_else(|e| fail(6, self.json, "VALIDATION", &format!("{}: {e}", f.display())));
                let v = self.send(self.req(Method::POST, "/files").header("Idempotency-Key", random_key()).multipart(form));
                v["id"].as_str().unwrap_or_default().to_string()
            })
            .collect()
    }
}

impl Api {
    /// 下载附件到 dest，返回绝对路径。
    fn download(&self, id: &str, dest: &Path) -> String {
        let bytes = self
            .checked(self.req(Method::GET, &format!("/files/{id}")))
            .bytes()
            .unwrap_or_else(|e| fail(5, self.json, "NETWORK", &e.to_string()));
        let res = std::fs::create_dir_all(dest.parent().unwrap_or(Path::new(".")))
            .and_then(|_| std::fs::write(dest, &bytes));
        if let Err(e) = res {
            fail(1, self.json, "IO", &format!("{}: {e}", dest.display()));
        }
        std::path::absolute(dest).unwrap_or_else(|_| dest.to_path_buf()).display().to_string()
    }

    /// 下载作文的全部附件，给每个附件补 local_path，并生成把 `](ATT-xxx)` 换成本地路径的 `<field>_local`。
    fn localize(&self, mut v: Value, owner: &str, dir: Option<&Path>, field: &str) -> Value {
        let dir = dir.map_or_else(|| attachments_root().join(owner), Path::to_path_buf);
        let mut paths: BTreeMap<String, String> = BTreeMap::new();
        for a in v["attachments"].as_array_mut().into_iter().flatten() {
            let id = a["id"].as_str().unwrap_or_default().to_string();
            let name = safe_filename(a["filename"].as_str().unwrap_or("file"));
            let path = self.download(&id, &dir.join(format!("{id}-{name}")));
            a["local_path"] = json!(path);
            paths.insert(id, path);
        }
        let text = v[field].as_str().unwrap_or_default();
        let local = contract::refs::rewrite_refs(text, |id| paths.get(id).cloned());
        v[format!("{field}_local")] = json!(local);
        v
    }
}

/// 正文里 `](./shot.png)` 写的是 --attach 的本地路径，上传后换成对应的 `](ATT-xxx)`。
fn link_uploads(text: &str, files: &[PathBuf], ids: &[String]) -> String {
    let mut out = text.to_string();
    for (f, id) in files.iter().zip(ids) {
        out = out.replace(&format!("]({})", f.display()), &format!("]({id})"));
    }
    out
}

/// 附件缓存目录。首次创建时写入 `*` 的 .gitignore，避免误提交。
fn attachments_root() -> PathBuf {
    let root = PathBuf::from(".wtow/attachments");
    let ignore = root.join(".gitignore");
    if !ignore.exists() {
        let _ = std::fs::create_dir_all(&root).and_then(|_| std::fs::write(&ignore, "*\n"));
    }
    root
}

fn safe_filename(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' })
        .collect();
    let s = s.trim_start_matches('.');
    if s.is_empty() { "file".into() } else { s.into() }
}

fn random_key() -> String {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    format!("cli-{nanos:x}-{:x}", std::process::id())
}

fn parse_priority(p: &str, json: bool) -> i64 {
    match p.trim().to_uppercase().trim_start_matches('P').parse::<i64>() {
        Ok(n @ 0..=3) => n,
        _ => fail(6, json, "VALIDATION", "priority must be P0-P3"),
    }
}

fn print(v: &Value, json: bool) {
    if json {
        println!("{}", serde_json::to_string(v).unwrap());
        return;
    }
    let line = |o: &Value| {
        let id = o["id"].as_str().unwrap_or("");
        let status = o["status"].as_str().unwrap_or("");
        let title = o["title"].as_str().or(o["instruction"].as_str()).unwrap_or("");
        format!("{id:<10} {status:<11} {}", title.lines().next().unwrap_or(""))
    };
    match v {
        Value::Object(m) if m.contains_key("items") => {
            for it in v["items"].as_array().into_iter().flatten() {
                println!("{}", line(it));
            }
            println!("total: {}", v["total"]);
        }
        Value::Array(a) if a.iter().all(|o| o.get("id").is_some()) => {
            for it in a {
                println!("{}", line(it));
            }
        }
        Value::Null => println!("ok"),
        _ => println!("{}", serde_json::to_string_pretty(v).unwrap()),
    }
}

fn main() {
    let cli = Cli::parse();
    let g = &cli.g;
    match &cli.cmd {
        Cmd::Login { profile } => login(g, profile.clone()),
        Cmd::Profile { cmd } => profile_cmd(g, cmd),
        Cmd::Skill { cmd: SkillCmd::Install { scope, dir } } => skill_install(g, scope, dir.as_deref()),
        Cmd::Whoami => {
            let api = Api::new(resolve(g), g);
            print(&api.get("/whoami", &[]), g.json);
        }
        Cmd::Raw { cmd } => {
            let api = Api::new(resolve(g), g);
            print(&raw_cmd(&api, cmd), g.json);
        }
        Cmd::Exec { cmd } => {
            let api = Api::new(resolve(g), g);
            print(&exec_cmd(&api, cmd), g.json);
        }
        Cmd::File { cmd: FileCmd::Get { id, output } } => {
            let api = Api::new(resolve(g), g);
            let dest = output.clone().unwrap_or_else(|| attachments_root().join(id));
            print(&json!({ "id": id, "local_path": api.download(id, &dest) }), g.json);
        }
    }
}

fn login(g: &Global, profile: Option<String>) {
    let (Some(base_url), Some(project), Some(token)) = (&g.base_url, &g.project, &g.token) else {
        fail(6, g.json, "VALIDATION", "usage: wtow login --base-url <url> --project <slug> --token <token>")
    };
    let r = Resolved { base_url: base_url.trim_end_matches('/').into(), project: project.clone(), token: token.clone() };
    let api = Api::new(r, g);
    let me = api.get("/whoami", &[]);
    let name = profile.unwrap_or_else(|| project.clone());
    let mut cfg = load_user_config();
    cfg.profiles.insert(name.clone(), Profile {
        base_url: Some(api.r.base_url.clone()),
        project: Some(project.clone()),
        token: Some(token.clone()),
    });
    cfg.active = Some(name.clone());
    save_user_config(&cfg, g.json);
    print(&json!({ "profile": name, "whoami": me }), g.json);
}

fn profile_cmd(g: &Global, cmd: &ProfileCmd) {
    let mut cfg = load_user_config();
    match cmd {
        ProfileCmd::List => {
            let items: Vec<Value> = cfg
                .profiles
                .iter()
                .map(|(n, p)| json!({
                    "name": n, "base_url": p.base_url, "project": p.project,
                    "active": cfg.active.as_deref() == Some(n.as_str()),
                }))
                .collect();
            if g.json {
                println!("{}", Value::Array(items));
            } else {
                for i in items {
                    let mark = if i["active"].as_bool() == Some(true) { "*" } else { " " };
                    println!("{mark} {:<16} {} {}", i["name"].as_str().unwrap(), i["project"].as_str().unwrap_or(""), i["base_url"].as_str().unwrap_or(""));
                }
            }
        }
        ProfileCmd::Use { name } => {
            if !cfg.profiles.contains_key(name) {
                fail(3, g.json, "NOT_FOUND", &format!("profile {name} not found"));
            }
            cfg.active = Some(name.clone());
            save_user_config(&cfg, g.json);
            print(&json!({ "active": name }), g.json);
        }
    }
}

fn skill_install(g: &Global, scope: &str, dir: Option<&Path>) {
    let home = || dirs::home_dir().unwrap_or_else(|| fail(1, g.json, "CONFIG", "cannot locate home directory"));
    let root = match dir {
        // 引号包住或 PowerShell 下 `~` 不会被 shell 展开，这里补上。
        Some(d) => match d.strip_prefix("~") {
            Ok(rest) => home().join(rest),
            Err(_) => d.to_path_buf(),
        }
        .join("wtow"),
        None if scope == "project" => PathBuf::from(".claude/skills/wtow"),
        None => home().join(".claude/skills/wtow"),
    };
    for (rel, content) in SKILL_FILES {
        let p = root.join(rel);
        let res = std::fs::create_dir_all(p.parent().unwrap()).and_then(|_| std::fs::write(&p, content));
        if let Err(e) = res {
            fail(1, g.json, "IO", &format!("{}: {e}", p.display()));
        }
    }
    print(&json!({ "installed": root.display().to_string(), "files": SKILL_FILES.len() }), g.json);
}

fn raw_cmd(api: &Api, cmd: &RawCmd) -> Value {
    match cmd {
        RawCmd::Submit { title, desc, tags, attach } => {
            let ids = api.upload(attach);
            let desc = link_uploads(desc, attach, &ids);
            api.post("/raw", json!({ "title": title, "description": desc, "tags": tags, "attachment_ids": ids }))
        }
        RawCmd::List { status, tag, q, mine, page, page_size } => api.get("/raw", &[
            ("status", status.clone()),
            ("tag", tag.clone()),
            ("q", q.clone()),
            ("mine", mine.then(|| "true".to_string())),
            ("page", page.map(|p| p.to_string())),
            ("page_size", page_size.map(|p| p.to_string())),
        ]),
        RawCmd::Get { id, download } => {
            let v = api.get(&format!("/raw/{id}"), &[]);
            match download {
                Some(dir) => api.localize(v, id, dir.as_deref(), "description"),
                None => v,
            }
        }
        RawCmd::Claim { id } => api.post(&format!("/raw/{id}/claim"), json!({})),
        RawCmd::Release { id } => api.send(api.req(Method::DELETE, &format!("/raw/{id}/claim"))),
        RawCmd::Related { id } => api.get(&format!("/raw/{id}/related"), &[]),
        RawCmd::Execs { id } => api.get(&format!("/raw/{id}/execs"), &[]),
        RawCmd::Edit { id, title, desc, tags, if_match } => {
            let mut b = api.req(Method::PATCH, &format!("/raw/{id}"))
                .json(&json!({ "title": title, "description": desc, "tags": tags }));
            if let Some(v) = if_match {
                b = b.header("If-Match", v.to_string());
            }
            api.send(b)
        }
        RawCmd::Merge { id, into, reason, skip_related_check } => api.post(
            &format!("/raw/{id}/merge"),
            json!({ "target_id": into, "reason": reason, "skip_related_check": skip_related_check }),
        ),
        RawCmd::Duplicate { id, of, reason, skip_related_check } => api.post(
            &format!("/raw/{id}/duplicate"),
            json!({ "target_id": of, "reason": reason, "skip_related_check": skip_related_check }),
        ),
        RawCmd::Ignore { id, reason } => api.post(&format!("/raw/{id}/ignore"), json!({ "reason": reason })),
        RawCmd::Reopen { id, reason } => api.post(&format!("/raw/{id}/reopen"), json!({ "reason": reason })),
    }
}

fn exec_cmd(api: &Api, cmd: &ExecCmd) -> Value {
    match cmd {
        ExecCmd::Create { from, instruction, targets, priority, developer, close, skip_related_check, attach } => {
            let priority = priority.as_deref().map(|p| parse_priority(p, api.json));
            let ids = api.upload(attach);
            let instruction = link_uploads(instruction, attach, &ids);
            api.post("/exec", json!({
                "source_raw_ids": from, "instruction": instruction, "target_resources": targets,
                "priority": priority, "developer_id": developer, "close_sources": close,
                "skip_related_check": skip_related_check, "attachment_ids": ids,
            }))
        }
        ExecCmd::List { status, developer, target, q, page, page_size } => api.get("/exec", &[
            ("status", status.clone()),
            ("developer_id", developer.map(|d| d.to_string())),
            ("target", target.clone()),
            ("q", q.clone()),
            ("page", page.map(|p| p.to_string())),
            ("page_size", page_size.map(|p| p.to_string())),
        ]),
        ExecCmd::Get { id, download } => {
            let v = api.get(&format!("/exec/{id}"), &[]);
            match download {
                Some(dir) => api.localize(v, id, dir.as_deref(), "instruction"),
                None => v,
            }
        }
        ExecCmd::Raws { id } => api.get(&format!("/exec/{id}/raws"), &[]),
        ExecCmd::Claim { id, force } => {
            let path = if *force { format!("/exec/{id}/claim?force=true") } else { format!("/exec/{id}/claim") };
            api.post(&path, json!({}))
        }
        ExecCmd::Release { id, reason } => {
            api.send(api.req(Method::DELETE, &format!("/exec/{id}/claim")).json(&json!({ "reason": reason })))
        }
        ExecCmd::Cancel { id, reason, no_requeue } => api.post(
            &format!("/exec/{id}/cancel"),
            json!({ "reason": reason, "requeue_sources": !no_requeue }),
        ),
        ExecCmd::Reopen { id, reason } => api.post(&format!("/exec/{id}/reopen"), json!({ "reason": reason })),
        ExecCmd::Complete { id, notes, links } => api.post(
            &format!("/exec/{id}/complete"),
            json!({ "developer_notes": notes, "result_links": links }),
        ),
        ExecCmd::Edit { id, instruction, priority, targets, notes, links, if_match } => {
            let priority = priority.as_deref().map(|p| parse_priority(p, api.json));
            let mut b = api.req(Method::PATCH, &format!("/exec/{id}")).json(&json!({
                "instruction": instruction, "priority": priority, "target_resources": targets,
                "developer_notes": notes, "result_links": links,
            }));
            if let Some(v) = if_match {
                b = b.header("If-Match", v.to_string());
            }
            api.send(b)
        }
    }
}
