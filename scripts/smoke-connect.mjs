/**
 * Connect-error classification used when pairing across a flaky Wi-Fi hop.
 * Loads the compiled main-process module (npm run build).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist", "net.js");
if (!existsSync(dist)) {
  const built = spawnSync("npx", ["tsc", "-p", "tsconfig.json"], {
    cwd: root,
    stdio: "inherit",
  });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

const require = createRequire(import.meta.url);
const { isTransientConnectError } = require("../dist/net.js");

const hostUnreach = Object.assign(new Error("connect EHOSTUNREACH"), {
  code: "EHOSTUNREACH",
});
const refused = Object.assign(new Error("connect ECONNREFUSED"), {
  code: "ECONNREFUSED",
});
assert.equal(isTransientConnectError(hostUnreach), true);
assert.equal(isTransientConnectError(refused), true);
assert.equal(isTransientConnectError(new Error("connect timeout")), true);
assert.equal(isTransientConnectError(new Error("bad code")), false);

console.log("smoke-connect: OK");
