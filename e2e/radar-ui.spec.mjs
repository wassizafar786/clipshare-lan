/**
 * Minimal Playwright-style E2E for the radar UI harness.
 * Run: npx --yes playwright test e2e/radar-ui.spec.mjs
 * (or: node e2e/radar-ui.spec.mjs after `npx playwright install chromium`)
 *
 * Requires: dist/ui built, and e2e/harness-server.mjs on :4173
 *   node e2e/harness-server.mjs &
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.E2E_BASE || "http://127.0.0.1:4173/";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(base);

await assert.doesNotReject(() => page.getByRole("button", { name: "Start pairing" }).click());
await page.getByText("482913").waitFor({ timeout: 3000 });
await page.getByRole("button", { name: "MacBook, seen" }).click();
await page.getByRole("heading", { name: "Enter pairing code" }).waitFor();
await page.getByText("Manual host:port (fallback)").waitFor();

console.log("e2e radar-ui: OK");
await browser.close();
