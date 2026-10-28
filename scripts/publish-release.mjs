/**
 * Helper: build platform artifacts and print GitHub release steps.
 * Usage:
 *   node scripts/publish-release.mjs          # build for this OS
 *   node scripts/publish-release.mjs --win
 *   node scripts/publish-release.mjs --mac
 *   node scripts/publish-release.mjs --all    # win+mac (needs both toolchains)
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;
const args = new Set(process.argv.slice(2));

function run(cmd, cmdArgs) {
  console.log(`\n> ${cmd} ${cmdArgs.join(" ")}`);
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("npm", ["run", "build"]);

if (args.has("--all")) {
  run("npx", ["electron-builder", "--win", "--mac"]);
} else if (args.has("--mac")) {
  run("npx", ["electron-builder", "--mac"]);
} else if (args.has("--win") || process.platform === "win32") {
  run("npx", ["electron-builder", "--win"]);
} else if (process.platform === "darwin") {
  run("npx", ["electron-builder", "--mac"]);
} else {
  console.error("Specify --win, --mac, or --all");
  process.exit(1);
}

const tag = `v${version}`;
console.log(`
────────────────────────────────────────
ClipShare ${tag} artifacts are under release/

Next (publish so clients see the update bar):
  1. git add -A && git commit -m "Release ${tag}"
  2. git tag ${tag}
  3. git push origin main --tags
  4. Create a GitHub Release for ${tag} and upload files from release/
     gh release create ${tag} release/* --title "${tag}" --generate-notes

Clients check: https://github.com/wassizafar786/clipshare-lan/releases/latest
Override repo with CLIPSHARE_UPDATE_REPO=owner/name
────────────────────────────────────────
`);
