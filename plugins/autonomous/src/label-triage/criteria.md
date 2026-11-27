Every task carries one label from each of three groups: scope, autonomy and
stage. Scope and autonomy are properties of the task, kept for its whole
life. The stage says where the task is, and it follows from the autonomy.

The scope group holds `work` and `personal`. Exactly one of the two applies
to a task; a task carrying both is in conflict.

The autonomy group holds `AFK` and `HITL`. Exactly one of the two applies to
a task; a task carrying both is in conflict.

The stage group holds `grill-me`, `proposal`, `implement`, `verify`, `code-review`,
`qa`, `external-review`, `wrap-up` and `ready-to-merge`. Exactly one of the nine
applies to a task; a task carrying two is in conflict.

`work` is Nazaries work.

`personal` is the user's own work.

`AFK` means an agent may advance the task without a human.

`HITL` means an agent may advance the task, but a human intervenes during or
at the end of each stage.

`grill-me` means the task must be refined with a human in a grill before
anyone works on it.

`proposal` means the task is ready for proposal preparation, its autonomy
decided and any grill it needed over.

`implement` means the task has a proposal and is ready to implement.

`verify` means the task is implemented and ready to verify against its
proposal.

`code-review` means the task is verified and ready for code review.

`qa` means the task has passed code review and is ready for QA.

`external-review` means the task has passed every review stage and is ready for
external review.

`wrap-up` means the task has passed external review and is ready for wrap-up.

`ready-to-merge` means the task is wrapped up and waits for a person to merge
its pull request.

Two things are decided for a task: its scope and its autonomy. The stage is
never decided on its own; it follows the autonomy decision.

The autonomy decision is `AFK`, `HITL` or `grill-me`. Choosing `grill-me`
means "decide the autonomy in a grill": choose it when the task needs
refining with a human before its autonomy can be told. A task decided
`grill-me` gets `grill-me` as its stage and no autonomy label until the grill
decides it. A task with no stage label that is decided `AFK` or `HITL` gets
`proposal` as its stage.

`grill-me` is an option only when the task has no stage label. A task that
already carries any stage label is decided `AFK` or `HITL`.

Constraints: exactly one scope label applies to a task. Exactly one of `AFK`
and `HITL` applies to a task, except that a task whose stage is `grill-me`
may lack both: the grill decides its autonomy. When a task in `grill-me`
already carries `AFK` or `HITL`, the grill confirms it. `AFK` and `HITL`
never apply together. Exactly one stage label applies to a task.

When unsure which label applies, say so and give a low confidence rather than
guessing: state briefly why the task's title, description or labels do not
make the answer clear.
