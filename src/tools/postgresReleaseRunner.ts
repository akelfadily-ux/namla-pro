import { spawnSync } from "child_process";

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error("POSTGRES RELEASE SUITE FAILED: DATABASE_URL environment variable is mandatory for release qualification");
  process.exit(1);
}

console.log("=== EXECUTING ACTUAL POSTGRESQL RELEASE SUITE ===");

const res = spawnSync(process.execPath, ["--test", "dist/tools/actualPostgresServerIntegrationTests.js"], {
  stdio: "inherit",
  env: process.env,
});

if (res.status !== 0) {
  console.error("POSTGRES RELEASE SUITE FAILED");
  process.exit(res.status ?? 1);
}

console.log("POSTGRES RELEASE SUITE PASSED");
