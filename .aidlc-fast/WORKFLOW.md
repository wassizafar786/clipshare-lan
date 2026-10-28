# aidlc-fast workflow

```mermaid
flowchart TD
  start["/aidlc-fast + intent"] --> understand[Understanding]
  understand --> plan[Plan check]
  plan --> build[Building]
  build --> ship[Ship check]
  ship --> doneNode[Done]
```

| Who | What |
|-----|------|
| Human | `/aidlc-fast`, checkbox replies |
| Agent | Runs CLI (`start` / `complete` / `rework` / `approve --human-reply`) |

Scopes: `bugfix` · `feature` · `refactor` · `mvp` · `security-patch` · `express`
