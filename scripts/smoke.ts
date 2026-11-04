// 对运行中的服务做端到端冒烟：注册、建项目、发令牌，然后用 CLI 走一遍分配者和开发者流程。
import { $ } from "bun";

const base = (process.env.WTOW_PUBLIC_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const api = `${base}/api/v1`;
const stamp = Date.now().toString(36);
const email = `smoke-${stamp}@example.com`;
const slug = `smoke-${stamp}`;
let cookie = "";

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(api + path, {
    method,
    headers: { "content-type": "application/json", "x-requested-with": "smoke", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

await call("POST", "/auth/register", { email, display_name: "Smoke", password: "password123" });
await call("POST", "/auth/login", { email, password: "password123" });
await call("POST", "/projects", { slug, name: "Smoke" });
const tok = await call("POST", `/projects/${slug}/tokens`, {
  name: "smoke",
  roles: ["tester", "assigner", "developer"],
});

const home = `/tmp/wtow-smoke-${stamp}`;
// 换 HOME 隔离 CLI 配置，但 rustup / cargo 仍需找到原来的工具链。
const realHome = process.env.HOME!;
const env = {
  ...process.env,
  RUSTUP_HOME: process.env.RUSTUP_HOME ?? `${realHome}/.rustup`,
  CARGO_HOME: process.env.CARGO_HOME ?? `${realHome}/.cargo`,
  HOME: home,
  WTOW_BASE_URL: base,
  WTOW_PROJECT: slug,
  WTOW_TOKEN: tok.secret,
};
const root = `${import.meta.dir}/..`;
const cli = (args: string[]) => $`cargo run -q -p wtow-cli -- ${args} --json`.env(env).json();

// 1x1 PNG，验证图文链路：测试者上传截图 → 分配者在指令里引用 → 开发者下载到本地。
const shot = `${home}/shot.png`;
await Bun.write(
  shot,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const raw = await cli([
  "raw",
  "submit",
  "--title",
  "冒烟测试",
  "--desc",
  `金额显示为 0 ![截图](${shot})`,
  "--tag",
  "smoke",
  "--attach",
  shot,
]);
const att = raw.attachments[0]?.id;
if (!att || !raw.description.includes(`](${att})`))
  throw new Error(`attachment not linked: ${raw.description}`);
await cli(["raw", "claim", raw.id]);
await cli(["raw", "related", raw.id]);
const exec = await cli([
  "exec",
  "create",
  "--from",
  raw.id,
  "--instruction",
  `修复金额，现象见 ![截图](${att})`,
  "--target",
  "svc/smoke",
  "--close",
]);
const dangling =
  await $`cargo run -q -p wtow-cli -- exec edit ${exec.id} --instruction ${"见 ![x](ATT-deadbeef)"} --json`
    .env(env)
    .nothrow()
    .quiet();
if (dangling.exitCode !== 6)
  throw new Error(`dangling attachment ref should fail with 6, got ${dangling.exitCode}`);
await cli(["exec", "claim", exec.id]);
const pulled =
  await $`cargo run -q --manifest-path ${root}/Cargo.toml -p wtow-cli -- exec get ${exec.id} --download --json`
    .cwd(home)
    .env(env)
    .json();
const local = pulled.attachments[0]?.local_path;
if (pulled.attachments[0]?.owner_id !== raw.id || !local || !(await Bun.file(local).exists()))
  throw new Error(`attachment not downloaded: ${JSON.stringify(pulled.attachments)}`);
if (!pulled.instruction_local.includes(`](${local})`))
  throw new Error(`instruction not localized: ${pulled.instruction_local}`);
await cli(["exec", "complete", exec.id, "--notes", "done", "--link", "https://example.com/pr/1"]);
const after = await cli(["raw", "get", raw.id]);

if (after.delivery !== "delivered") throw new Error(`expected delivered, got ${after.delivery}`);
console.log(`smoke ok: project=${slug} ${raw.id} -> ${exec.id} delivered`);
