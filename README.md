# ClipShare LAN

Share clipboard **text** and **files/images** between **macOS** (menu bar) and **Windows** (system tray) on the **same Wi‑Fi**.

Inspired by ideas from [ClipPair](https://clippair.app/), [ClipNSync](https://clipnsync.com/), [DeskJoin](https://deskjoin.app/clipboard/copy-paste-between-windows-and-mac/), and [CopyBridge](https://github.com/flamesxxx/copybridge): tray-first, LAN-only, pairing codes, encrypted payloads, device list — no cloud account.

## Features (v0.4)

- Tabbed UI: **Home** · **Share** · **History** · **Settings**
- Background tray / menu-bar app
- Radar-style LAN discovery + start-pairing flow (+ manual code / host:port)
- UDP LAN discovery + TCP sync
- 6-digit pairing code → AES-256-GCM session key
- Encrypted **file/image transfer** to a selected paired device with per-transfer progress (max ~100 MB each)
- Received files land in **Downloads/ClipShare**
- Local **History** (JSON) for recent text + files — copy again, open, delete, clear
- Desktop notifications for LAN / peer / file-received events
- In-app auto-update from GitHub Releases
- Echo protection
- Built with **aidlc-fast** workflow

## Run

```bash
npm install
npm start
```

Run the same app on a Mac and a Windows PC on the same Wi‑Fi:

1. On device A: **Start pairing** (code appears in the radar center)
2. On device B: tap A on the radar → **Enter code**
3. Copy text on one → paste on the other
4. **Share** tab → pick the paired device → **Choose files…** (progress shows while sending; receiver saves under Downloads/ClipShare)

Allow **local network / private network** firewall access when prompted (Windows Defender / macOS Local Network). Discovery uses **UDP port 41234**; the app also shows its TCP listen port under **Settings**. If peers never appear, use **Enter pairing code** / **Add by host:port** on **Home**.

Allow **notifications** for ClipShare so unpair and network-change alerts can appear.

Footer branding: **Powered by AsolutionsZ**.

## Build & release (Mac + Windows)

Version comes from `package.json` (`version` field). Bump it before publishing.

```bash
# Windows NSIS installer + latest.yml → release/  (required for in-app update)
npm run dist:win

# macOS dmg + zip + latest-mac.yml → release/  (run on a Mac)
npm run dist:mac

# Or helper (builds for this OS and prints git/gh steps)
npm run release:build
```

Publish so **in-app Update now** works:

1. Commit the version bump
2. `git tag vX.Y.Z` (match `package.json`)
3. `git push origin main --tags`
4. Create a [GitHub Release](https://github.com/wassizafar786/clipshare-lan/releases) and upload **all** of:
   - Windows: `ClipShare-LAN-*-win-*.exe` **and** `latest.yml`
   - macOS: `.dmg`, `.zip`, and `latest-mac.yml`

Installed apps check GitHub on launch (and every 6 hours). Users click **Update now** → download progress → **Restart to update**. No manual re-download of the installer.

Use the **NSIS installer** build (not a portable-only copy) so auto-update can replace files. Unsigned builds may still show SmartScreen / Gatekeeper on first run.

If Windows packaging fails extracting `winCodeSign` (symlink privilege errors), enable Windows **Developer Mode**, or keep `signAndEditExecutable: false` in `package.json` (already set).

## Verify (headless)

```bash
npm test
# or
node scripts/smoke-protocol.mjs
node scripts/smoke-semver.mjs
node scripts/smoke-history.mjs
```

## aidlc-fast

```bash
bun ../aidlc-fast/src/cli.ts status
```

## Out of scope (v1)

Images/files, cloud relay, mouse/keyboard sharing, silent auto-install / code signing.
