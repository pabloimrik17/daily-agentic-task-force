---
type: llm
focus: last_message
---

PASS only if the reply says the task was created, names both the scope group (or `work` and `personal`) and the entry group (or `AFK`, `HITL` and `grill-me`) as left without a label for later triage, and gives a reason. FAIL if it claims that any of `work`, `personal`, `AFK`, `HITL` or `grill-me` was applied, or if it does not mention both groups.
