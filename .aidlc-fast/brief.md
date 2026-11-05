# Brief

## Intent
Restructure the ClipShare window into four tabs (Home · Share · History · Settings), add LAN file/image transfer to a selected paired peer with per-transfer progress (received files land in Downloads/ClipShare), and persist recent text + file transfers for History management (copy / open / delete / clear).

## Scope
feature

## Acceptance criteria
- [x] Window uses tabs **Home · Share · History · Settings**; no single long-scrolling “everything” page. Each tab fits typical tray-window height without requiring the whole app content to scroll as one page (tab content may scroll internally if needed).
- [x] **Home**: radar pairing, peer list, manual pairing code + host:port add (existing pairing flows preserved).
- [x] **Share**: pick a paired/online peer, send one or more files/images (file picker); show **per-transfer progress** (sent/received %); clear failure messaging.
- [x] **Receive**: incoming files auto-save under the user’s Downloads/`ClipShare` folder (create folder if missing); notify when a file arrives.
- [x] Transfers use the existing paired TCP session and stay encrypted with the session key (chunked protocol; not unbounded JSON-in-clipboard).
- [x] Reasonable size guard (~100 MB per file).
- [x] **History**: local JSON store of recent **text clips** and **file transfers**. Cap retention (200).
- [x] History actions: **copy again** (text), **open file** / show in folder (files), **delete** one, **clear all**.
- [x] **Settings**: device name, sync clipboard toggle, update check (moved off the old stacked page).
- [x] Existing clipboard sync + pairing + auto-update behavior still works.
- [x] Typecheck + smoke tests pass.

## Approach
1. **UI shell**: tab bar + four panels in `ui/`; migrate current sections into Home / Settings; new Share + History panels; keep AsolutionsZ branding visible (Settings or footer).
2. **Wire protocol**: extend TCP framing with chunked `file-offer` / `file-chunk` / `file-ack` (or length-prefixed binary frames) over the paired socket; encrypt chunks with existing session key; emit progress events to the renderer.
3. **Receive path**: write to `path.join(app.getPath("downloads"), "ClipShare", …)`; unique names on collision.
4. **History store**: JSON file under `app.getPath("userData")` (simple, no native SQLite dep); append/prune API in main; IPC for list/mutate; record outbound/inbound text (from clip path) and file transfers.
5. **Version**: bump to **0.4.0** when shipping (protocol + UX feature).

## Files to touch
- `ui/index.html`, `ui/styles.css`, `ui/app.js` — tabs + Share + History
- `electron/types.ts` — wire + history + transfer types
- `electron/net.ts` — chunked file transfer + progress hooks
- `electron/main.ts`, `electron/preload.ts` — IPC (pick files, send, progress, history CRUD, open path)
- `electron/history-store.ts` (new) — JSON persistence
- `electron/clipboard-watch.ts` / clip handler — optional history entries for text
- `README.md` — tabs, file receive folder, size limits
- `.aidlc-fast/brief.md` — this contract
- tests/smoke as needed for framing or history prune

## E2E scenarios
- [x] Tab bar switches Home / Share / History / Settings without losing pairing state. _(static UI + browser)_
- [x] Share/History/Settings panels render; transfer progress UI + history actions wired to IPC.
- [x] Settings still renames device, toggles sync, and surfaces update UI.
- [x] `npm run typecheck` and `npm test` pass.
- [ ] Live two-device file send confirm after install (manual / post-release).

## Notes
- Prefer JSON history over SQLite for zero native deps; revisit if volume becomes an issue.
- Clipboard **images** as automatic file transfers can be a follow-up; this slice is explicit file/image send from Share.
- Out of scope: cloud sync of history, multi-peer broadcast of one file, resume of interrupted transfers across app restarts.
