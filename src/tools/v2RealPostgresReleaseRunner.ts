import {
  spawnSync,
} from "child_process";

const databaseUrl =
  process.env.DATABASE_URL;

if (
  typeof databaseUrl !== "string" ||
  databaseUrl.trim().length === 0
) {
  console.error(
    "V2 REAL POSTGRES RELEASE FAILED: DATABASE_URL is mandatory",
  );

  process.exit(1);
}

console.log(
  "=== V2 REAL POSTGRESQL RELEASE SUITE ===",
);

const result =
  spawnSync(
    process.execPath,
    [
      "--test",
      "dist/tools/v2RealPostgresReleaseTests.js",
      "dist/tools/v2RealPostgresExecutionAuthorityTests.js",
    ],
    {
      stdio: "inherit",
      env: process.env,
      timeout: 180_000,
    },
  );

if (result.error) {
  console.error(
    `V2 REAL POSTGRES RELEASE FAILED: ${result.error.name}`,
  );

  process.exit(1);
}

if (result.status !== 0) {
  console.error(
    "V2 REAL POSTGRES RELEASE FAILED",
  );

  process.exit(
    result.status ?? 1,
  );
}

console.log(
  "V2 REAL POSTGRES RELEASE PASSED",
);