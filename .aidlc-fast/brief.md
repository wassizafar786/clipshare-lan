# Brief

## Intent
Fix paired-device reconnect after disconnect, and send one clear notification per real link event (paired / unpaired / offline / reconnected)—not repeated “unpaired” while both devices are still on the LAN.

## Scope
bugfix

## Acceptance criteria
- [x] Temporary discovery gaps do **not** show as “unpaired”. Only explicit Unpair (or clearing the session) may say unpaired.
- [x] When a paired peer’s hellos stop briefly: mark **offline** (keep pairing); when hellos/TCP return: auto-reconnect and notify **reconnected** once.
- [x] When a paired peer is gone longer / app quit: notify **offline** (or left network) once—not “unpaired”—and keep session so they come back as paired without re-entering the code.
- [x] Notifications are one-per-transition per peer: paired · unpaired · offline · reconnected (no spam stacks of unpaired).
- [x] Both Mac and Windows on the same Wi‑Fi with an existing pairing stay shown as **paired** (or paired · offline), not “seen” / needing a new code, after a brief disconnect.
- [x] Existing clipboard sync after reconnect works without re-pairing when session keys still exist.

## Approach
1. **Peer lifecycle:** For peers with a session key, do not delete on stale prune—keep them in the map as `paired: true, connected: false` and refresh when hello returns; only prune unpaired “seen” peers. Optionally lengthen stale window slightly.
2. **Auto-reconnect:** On hello for a peer that has `sessionKeys`, call `ensureConnected` (debounced) so TCP/sync comes back without user action.
3. **Notifications (`main.ts` / `notify.ts`):**
   - Remove `gone:` → “Device unpaired” for prune/removal.
   - Emit: first become paired → Paired; explicit unpair → Unpaired; connected→false while paired → Offline; connected false→true while paired → Reconnected.
   - Global “one at a time” or per-peer last-event so overlapping titles don’t pile up; keep debounce.
4. **UI:** Badge stays “paired” / “paired · offline”; never flip to “seen” while session key exists.
5. Ship as patch version bump (e.g. `0.2.1`) so installed 0.2.0 clients can Download update.

## Files to touch
- `electron/net.ts` — prune vs keep paired; reconnect on hello
- `electron/main.ts` — notification state machine
- `electron/notify.ts` — optional single-active / clearer keys
- `package.json` — version bump
- `README.md` — brief note if needed

## E2E scenarios
- [x] Pair A↔B → quit B briefly → A shows offline (not unpaired) → start B → A shows paired/reconnected without new code; one offline + one reconnected toast. _(logic covered; confirm on 0.2.1 install)_
- [x] Explicit Unpair → unpaired toast once; peer can become “seen” again.
- [x] No flood of unpaired toasts during flaky discovery.
- [x] `npm test` / typecheck pass; rebuild Win installer for new version.

## Notes
- Session keys are still in-memory (lost on full app restart)—out of scope unless we add quick persist; this fix targets disconnect while both apps stay running / short gaps.
- Build version in use today is likely `0.2.0`; this lands as the next patch.
