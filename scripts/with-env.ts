// bun 运行 .ts 时会自动加载 .env，这里把它透传给子进程（cargo 不读 .env）。
const [cmd, ...args] = process.argv.slice(2);
const proc = Bun.spawn([cmd, ...args], { stdio: ["inherit", "inherit", "inherit"], env: process.env });
process.on("SIGINT", () => proc.kill("SIGINT"));
process.on("SIGTERM", () => proc.kill("SIGTERM"));
process.exit(await proc.exited);
