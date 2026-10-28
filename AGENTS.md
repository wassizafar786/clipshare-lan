<!-- aidlc-fast:start -->
# aidlc-fast — agent instructions

Humans only know **`/aidlc-fast`** and answering **checkboxes in chat**. You run the CLI under the hood. Never show them shell commands, stage ids, or AIDLC jargon.

## Human UX (required)

1. Start from `/aidlc-fast <intent>` (or continue with `/aidlc-fast`).
2. Questions: one checkbox group → **wait** for their reply.
3. **Plan check** / **Ship check**: checkboxes → wait → then silently:
   - `aidlc-fast approve --human-reply "<their exact words>"`
   - or `aidlc-fast reject --human-reply "<their exact words>"`
4. **Forbidden to show humans:** `npx`, `APPROVE`, `complete`, `rework`, `gate-plan`, CLI dumps.
5. **Forbidden:** inventing `--human-reply`, or CI bypass flags outside automated tests.

### Checkbox templates

Plan check:
```markdown
## Plan check

**Goal:** …
**Scope:** …

- [ ] Approve this plan
- [ ] Change the plan: _…_
- [ ] Different idea: _…_

Reply with one choice.
```

Ship check:
```markdown
## Ship check

**Done:** … · **Checks:** … · **E2E:** …

- [ ] Ship it
- [ ] Not yet: _…_

Reply with one choice.
```

## Agent loop (hidden from human)

1. CLI decides the stage (`next` / `status`). Obey Steps.
2. After work: `complete`. On quality fail: `rework … --reason "…"`.
3. Read `.aidlc-fast/knowledge/project-summary.md` and `project.md`.
4. Brief is the contract only after Plan check approval.
5. E2E: prefer Playwright; else browser tools + starter spec. Don’t claim pass without evidence.
6. Sensors are advisory. Never overwrite `knowledge/` wholesale.

## Scopes

bugfix · feature · refactor · mvp · security-patch · express (skips Plan check / review / learn).
<!-- aidlc-fast:end -->
