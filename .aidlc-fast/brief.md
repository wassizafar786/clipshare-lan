# Brief

## Intent
Fix ship feedback: show device types (PC/Mac/iPhone/Mobile) on radar with correct circle layout, full default scroll in UI, and Cancel on enter-code must not trigger validation.

## Scope
bugfix

## Acceptance criteria
- [x] Radar blips and peer list show a clear device type label (PC, Mac, Linux, Mobile, iPhone, or Device) from discovery metadata, not only a colored dot.
- [x] Radar is a true circular disc: concentric rings centered, sweep clipped to the circle, blips evenly on the ring without clipped/offset labels.
- [x] App window content scrolls fully by default (always-visible vertical scrollbar / page scrolls the whole UI).
- [x] Cancel on “Enter pairing code” closes the dialog without HTML5 required-field validation or error messaging.
- [x] Existing pairing / sync protocol still works (hello gains optional `kind`; older peers without kind still appear as Device).

## Approach
- Extend hello wire + PeerInfo with `kind`; advertise local `process.platform` mapped to kind.
- Redesign radar DOM/CSS (disk vs peers layer) and blip content with type icon + label.
- CSS: `html/body` overflow-y scroll; window tall enough; no nested clip that traps scroll.
- Pair dialog: Cancel `type="button"` + close; Connect submits; drop `required` or use `formnovalidate` on Cancel.

## Files to touch
- `electron/types.ts`, `electron/net.ts`
- `ui/index.html`, `ui/styles.css`, `ui/app.js`
- `e2e/harness-server.mjs` (mock kind)
- `electron/main.ts` only if window size tweak

## E2E scenarios
- [x] Harness: Start pairing still shows code; Cancel on enter-code closes without validation prompt.
- [x] Harness: Peer blips show type labels (e.g. Mac / PC / Mobile).
- [x] `npm test` smoke still passes.

## Notes
- True iPhone/Mobile kinds reserved for future clients; desktop Electron maps win→PC, darwin→Mac, linux→Linux.
