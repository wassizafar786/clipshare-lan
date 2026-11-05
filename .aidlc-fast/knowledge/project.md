# Project knowledge

> Project specialisation and learned rules. Framework never overwrites this file.
> Narrower layer — must not contradict org.md or team.md.

## Standing rules

- --fact File transfers save under Downloads/ClipShare; history JSON is in app userData; max ~100MB per file (learned 2026-11-05) <!-- cid:261105-ui-tabs-instead-of-long-:b9633e3d6212ce07 -->

- --preference Prefer tabbed ClipShare UI (Home · Share · History · Settings) over one long scrolling page (learned 2026-11-05) <!-- cid:261105-ui-tabs-instead-of-long-:3f5c850cd164313a -->

- (none yet)

## UI

- Manual pairing UI must stay above-the-fold (device select + code + host:port), not only collapsed details. (learned 2026-10-29) <!-- cid:261029-we-got-some-issues-1-aft:f9e693ae6a019eed -->

- Pair dialog Cancel must be type=button (or formnovalidate) — required inputs fire validation on submit Cancel. (learned 2026-10-28) <!-- cid:261028-fix-ship-feedback-show-d:d0681d2225119861 -->

- Radar UI: advertise device kind on discovery hello (pc/mac/linux/mobile); show type labels on blips and list, not dots only. (learned 2026-10-28) <!-- cid:261028-fix-ship-feedback-show-d:eced7df5fb30d77b -->

## Desktop

- Peer notifications: one event at a time — paired / unpaired / offline / reconnected (queued), not prune-as-unpaired spam. (learned 2026-11-05) <!-- cid:261105-we-are-getting-an-issue-:c67d6ac596819caf -->

- Paired peers: never delete on stale hello — mark offline and auto-reconnect; only explicit Unpair may toast unpaired. (learned 2026-11-05) <!-- cid:261105-we-are-getting-an-issue-:33f917ae780f5331 -->

- LAN discovery: broadcast hello to 255.255.255.255 and each NIC directed broadcast; prune peers with no hello ~12s so quit devices disappear. (learned 2026-10-29) <!-- cid:261029-we-got-some-issues-1-aft:53a1a9bb3736df57 -->

- App updates: package.json version is source of truth; check GitHub releases/latest and show dismissible update bar (openExternal) — no silent install in v1. (learned 2026-10-28) <!-- cid:261028-we-need-to-build-the-fea:b640483cf72f22c5 -->

- Windows electron-builder: set win.signAndEditExecutable=false for unsigned local builds to avoid winCodeSign symlink privilege failures. (learned 2026-10-28) <!-- cid:261028-we-need-to-build-the-fea:3072dc8419f76d2e -->

- Windows tray icons need opaque PNGs; empty/transparent NativeImage is invisible in the notification area. (learned 2026-10-28) <!-- cid:261028-fix-ship-feedback-show-d:30bc6c471f6fdcc7 -->

- Mac auto-update reads `latest-mac.yml` plus the zip from the GitHub release. A Windows-only release 404s that file. electron-updater's "check your token" line is its generic text for a 404. (learned 2026-11-05) <!-- cid:261105-latest-mac-yml-release:a1c0e4f7b2 -->

- Mac→Windows pairing: macOS often blocks this Electron app from opening an outbound LAN connection (`EHOSTUNREACH`) even when the Windows port is open and Windows can connect to the Mac. Broadcast `please-dial` and finish pairing on the inbound socket. Both computers must be running that build. Mac Info.plist needs `NSLocalNetworkUsageDescription`. (learned 2026-11-05) <!-- cid:261105-mac-to-windows-dialback:b7e2d91c04 -->

- App icon is `build/icon.png` (1024) and `assets/icon.png` for the running window and Dock. Without it, electron-builder uses the default Electron icon, which looks like the React atom. (learned 2026-11-05) <!-- cid:261105-app-icon-not-electron:c4a8f03e11 -->

- A paired peer is online when its TCP socket is writable, even if UDP hellos pause. Inbound clips must claim that socket; do not replace the discovery listen port with the TCP remote port, or Mac→Windows sends miss the real listener and the UI stays "paired · offline". (learned 2026-11-05) <!-- cid:261105-paired-offline-but-receives:d8b1a44e02 -->

- Check for updates must change the Settings line (Checking…, up to date, available, or the error). A finished check that leaves the old sentence looks like a dead button. (learned 2026-11-05) <!-- cid:261105-check-for-updates-silent:e3c91b07aa -->
