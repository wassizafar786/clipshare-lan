# Project knowledge

> Project specialisation and learned rules. Framework never overwrites this file.
> Narrower layer — must not contradict org.md or team.md.

## Standing rules

- (none yet)

## UI

- Pair dialog Cancel must be type=button (or formnovalidate) — required inputs fire validation on submit Cancel. (learned 2026-10-28) <!-- cid:261028-fix-ship-feedback-show-d:d0681d2225119861 -->

- Radar UI: advertise device kind on discovery hello (pc/mac/linux/mobile); show type labels on blips and list, not dots only. (learned 2026-10-28) <!-- cid:261028-fix-ship-feedback-show-d:eced7df5fb30d77b -->

## Desktop

- App updates: package.json version is source of truth; check GitHub releases/latest and show dismissible update bar (openExternal) — no silent install in v1. (learned 2026-10-28) <!-- cid:261028-we-need-to-build-the-fea:b640483cf72f22c5 -->

- Windows electron-builder: set win.signAndEditExecutable=false for unsigned local builds to avoid winCodeSign symlink privilege failures. (learned 2026-10-28) <!-- cid:261028-we-need-to-build-the-fea:3072dc8419f76d2e -->

- Windows tray icons need opaque PNGs; empty/transparent NativeImage is invisible in the notification area. (learned 2026-10-28) <!-- cid:261028-fix-ship-feedback-show-d:30bc6c471f6fdcc7 -->
