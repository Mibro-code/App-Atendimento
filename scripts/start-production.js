const { spawnSync } = require("node:child_process");

const migration = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  { cwd: process.cwd(), env: process.env, stdio: "inherit" }
);
if (migration.error) throw migration.error;
if (migration.status !== 0) process.exit(migration.status || 1);

require("../server");
