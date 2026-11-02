import { $ } from "bun";

const NAME = "wtow-pg";
const PORT = 55432;
const cmd = process.argv[2] ?? "up";

async function exists() {
  const out = await $`docker ps -a --filter name=^${NAME}$ --format {{.Status}}`.quiet().text();
  return out.trim();
}

async function waitReady() {
  for (let i = 0; i < 30; i++) {
    const r = await $`docker exec ${NAME} pg_isready -U wtow -d wtow`.quiet().nothrow();
    if (r.exitCode === 0) return;
    await Bun.sleep(1000);
  }
  throw new Error("postgres not ready after 30s");
}

async function up() {
  const status = await exists();
  if (!status) {
    await $`docker run -d --name ${NAME} -e POSTGRES_USER=wtow -e POSTGRES_PASSWORD=wtow -e POSTGRES_DB=wtow -p ${PORT}:5432 postgres:16`;
  } else if (!status.startsWith("Up")) {
    await $`docker start ${NAME}`.quiet();
  }
  await waitReady();
  console.log(`postgres ready on 127.0.0.1:${PORT}`);
}

switch (cmd) {
  case "up":
    await up();
    break;
  case "down":
    await $`docker stop ${NAME}`.nothrow();
    break;
  case "reset":
    // 清空 schema，服务下次启动时会重新跑迁移。
    await up();
    await $`docker exec ${NAME} psql -q -U wtow -d wtow -c ${"DROP SCHEMA public CASCADE; CREATE SCHEMA public;"}`;
    console.log("schema reset");
    break;
  default:
    console.error(`unknown command: ${cmd}`);
    process.exit(1);
}
