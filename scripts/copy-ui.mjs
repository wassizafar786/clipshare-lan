import { cpSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "dist", "ui");
mkdirSync(dest, { recursive: true });
cpSync(join(root, "ui"), dest, { recursive: true });
const assetsDest = join(root, "dist", "assets");
mkdirSync(assetsDest, { recursive: true });
cpSync(join(root, "assets"), assetsDest, { recursive: true });
console.log("copied ui → dist/ui, assets → dist/assets");
