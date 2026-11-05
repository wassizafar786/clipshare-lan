const { execFileSync } = require("child_process");
const { existsSync } = require("fs");
const path = require("path");

let pending = null;

/** Seal the Mac app before the disk image and zip are packed. */
module.exports = async function artifactBuildStarted(context) {
  const file = String(context?.file || "");
  if (!file.includes("-mac-")) return;
  const app = path.join(__dirname, "..", "release", "mac-arm64", "ClipShare LAN.app");
  if (!existsSync(app)) return;
  if (!pending) {
    pending = Promise.resolve().then(() => {
      execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
      execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
    });
  }
  await pending;
};
