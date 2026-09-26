Every task carries at least one label from each of two groups: scope and
entry.

The scope group holds `work` and `personal`. Exactly one of the two applies
to a task; a task carrying both is in conflict.

The entry group holds `AFK`, `HITL` and `grill-me`. At least one applies to a
task; `AFK` and `HITL` never apply together, but `grill-me` may accompany
either one.

`work` is Nazaries work, and has priority over personal work.

`personal` is the user's own work.

`AFK` means an agent may advance the task without a human.

`HITL` means an agent may advance the task, but a human intervenes during or
at the end of each stage.

`grill-me` means the task must be refined with a human before anyone works on
it, and it takes precedence over `AFK` and `HITL` when combined.

Constraints: exactly one scope label applies to a task. `AFK` and `HITL`
never apply together. `grill-me` may accompany either `AFK` or `HITL`.

When unsure which label applies, say so and give a low confidence rather than
guessing: state briefly why the task's title, description or labels do not
make the answer clear.
