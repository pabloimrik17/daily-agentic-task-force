## MODIFIED Requirements

### Requirement: Transition mode

With `--transition <source>:<task>`, the run SHALL run no step: it reads the task and acts by the stage label it carries. For `grill-me` it emits a handoff with the transition question and exits 0. For `proposal`, `implement`, `verify` or `code-review` with `HITL` it emits a handoff with the approval question and exits 0. For `proposal`, `implement`, `verify` or `code-review` with `AFK` it applies the transition to the next stage, `implement`, `verify`, `code-review` or `external-review`, itself, reads it back, emits no handoff and exits 0 when applied and 3 otherwise. The mode SHALL require `--apply` and MAY be combined with `--from` and `--json` only. Any other combination, or a value without `:` or with an unknown source, is a usage error. `--from <stage>` names the stage the caller expects the task to leave, `grill-me`, `proposal`, `implement`, `verify` or `code-review`: a task in another stage SHALL be reported with its labels, with no handoff and nothing written, and exit code 3. `--from` without `--transition`, with any other value, or given twice is a usage error. A task in none of these stages, a task in `proposal`, `implement`, `verify` or `code-review` whose autonomy is missing or in conflict, a task from a disabled source, or one that cannot be read SHALL be reported with the reason, with no handoff, and exit code 3.

#### Scenario: Task in grill-me

- **WHEN** the run is invoked with `--apply --transition linear:DOT-110` and DOT-110 carries `personal` and `grill-me`
- **THEN** no step runs, the report carries a handoff with one question, and the process exits with code 0

#### Scenario: HITL task in proposal

- **WHEN** the run is invoked with `--apply --transition linear:DOT-121` and DOT-121 carries `personal`, `HITL` and `proposal`
- **THEN** no step runs, the report carries a handoff with the approval question, nothing is written, and the process exits with code 0

#### Scenario: AFK task in proposal

- **WHEN** the run is invoked with `--apply --transition linear:DOT-110` and DOT-110 carries `personal`, `AFK` and `proposal`
- **THEN** DOT-110 carries `personal`, `AFK` and `implement`, the report says the transition was applied and carries no handoff, and the process exits with code 0

#### Scenario: AFK task in implement

- **WHEN** the run is invoked with `--apply --transition linear:DOT-121`, DOT-121 carries `personal`, `AFK` and `implement`, and its work is finished
- **THEN** DOT-121 carries `personal`, `AFK` and `verify`, the report says the transition was applied and carries no handoff, and the process exits with code 0

#### Scenario: HITL task in implement

- **WHEN** the run is invoked with `--apply --transition linear:DOT-121`, DOT-121 carries `personal`, `HITL` and `implement`, and its work is finished
- **THEN** no step runs, the report carries a handoff with the approval question, nothing is written, and the process exits with code 0

#### Scenario: AFK task in verify

- **WHEN** the run is invoked with `--apply --transition linear:DOT-121`, DOT-121 carries `personal`, `AFK` and `verify`, and its work is finished
- **THEN** DOT-121 carries `personal`, `AFK` and `code-review`, the report says the transition was applied and carries no handoff, and the process exits with code 0

#### Scenario: HITL task in verify

- **WHEN** the run is invoked with `--apply --transition linear:DOT-121`, DOT-121 carries `personal`, `HITL` and `verify`, and its work is finished
- **THEN** no step runs, the report carries a handoff with the approval question, nothing is written, and the process exits with code 0

#### Scenario: AFK task in code-review

- **WHEN** the run is invoked with `--apply --transition linear:DOT-164`, DOT-164 carries `personal`, `AFK` and `code-review`, and its work is finished
- **THEN** DOT-164 carries `personal`, `AFK` and `external-review`, the report says the transition was applied and carries no handoff, and the process exits with code 0

#### Scenario: HITL task in code-review

- **WHEN** the run is invoked with `--apply --transition linear:DOT-164`, DOT-164 carries `personal`, `HITL` and `code-review`, and its work is finished
- **THEN** no step runs, the report carries a handoff with the approval question, nothing is written, and the process exits with code 0

#### Scenario: Task not in grill-me

- **WHEN** the run is invoked with `--apply --transition linear:DOT-110` and DOT-110 carries `personal`, `AFK` and `external-review`
- **THEN** the report says DOT-110 is in none of `grill-me`, `proposal`, `implement`, `verify` and `code-review`, carries no handoff, and the process exits with code 3

#### Scenario: Second run after a lost read-back

- **WHEN** the run is invoked with `--apply --transition linear:DOT-121 --from implement` and DOT-121 carries `personal`, `AFK` and `verify`
- **THEN** nothing is written, the report says DOT-121 is in `verify`, not `implement`, with its labels, carries no handoff, and the process exits with code 3

#### Scenario: From names the stage the task is in

- **WHEN** the run is invoked with `--apply --transition linear:DOT-121 --from verify`, DOT-121 carries `personal`, `AFK` and `verify`, and its work is finished
- **THEN** DOT-121 carries `personal`, `AFK` and `code-review`, as without `--from`, and the process exits with code 0

#### Scenario: From without transition

- **WHEN** the run is invoked with `--apply --from verify` and without `--transition`
- **THEN** the run prints a usage message and exits with code 1

#### Scenario: implement not bootstrapped

- **WHEN** the mode would apply the transition of an `AFK` task whose tracker has no `implement` label
- **THEN** nothing is written, the report names `--bootstrap-labels`, and the process exits with code 3

#### Scenario: verify not bootstrapped

- **WHEN** the mode would apply the transition of an `AFK` task in `implement` whose tracker has no `verify` label
- **THEN** nothing is written, the report names `--bootstrap-labels`, and the process exits with code 3

#### Scenario: code-review not bootstrapped

- **WHEN** the mode would apply the transition of an `AFK` task in `verify` whose tracker has no `code-review` label
- **THEN** nothing is written, the report names `--bootstrap-labels`, and the process exits with code 3

#### Scenario: external-review not bootstrapped

- **WHEN** the mode would apply the transition of an `AFK` task in `code-review` whose tracker has no `external-review` label
- **THEN** nothing is written, the report names `--bootstrap-labels`, and the process exits with code 3

#### Scenario: Transition without apply

- **WHEN** the run is invoked with `--transition linear:DOT-110` and without `--apply`
- **THEN** the run prints a usage message and exits with code 1

### Requirement: Transition answers

Answer mode SHALL route an answer whose id names the transition to it, and SHALL read the task again to know which transition it answers. For a task in `grill-me`, only a single `AFK` or `HITL` is valid. For a task in `proposal`, only a single `implement` is valid. For a task in `implement`, only a single `verify` is valid. For a task in `verify`, only a single `code-review` is valid. For a task in `code-review`, only a single `external-review` is valid. Any other value, a malformed id or a disabled source is `rejected`. A task that carries none of these stages, or no longer the one the value answers, is `skipped`. A tracker lacking a label the transition adds makes the answer `failed`, naming `--bootstrap-labels`, before any write. Otherwise the transition is applied and read back; a failed write or read-back is `failed`.

#### Scenario: Transition applied

- **WHEN** the answer `AFK` arrives for a Linear task carrying `work`, `HITL` and `grill-me`
- **THEN** the task carries `work`, `AFK` and `proposal`, and the answer is `applied`

#### Scenario: Proposal approved

- **WHEN** the answer `implement` arrives for a task carrying `personal`, `HITL` and `proposal`
- **THEN** the task carries `personal`, `HITL` and `implement`, and the answer is `applied`

#### Scenario: Implementation approved

- **WHEN** the answer `verify` arrives for a task carrying `personal`, `HITL` and `implement` whose work is finished
- **THEN** the task carries `personal`, `HITL` and `verify`, and the answer is `applied`

#### Scenario: Verification approved

- **WHEN** the answer `code-review` arrives for a task carrying `personal`, `HITL` and `verify` whose work is finished
- **THEN** the task carries `personal`, `HITL` and `code-review`, and the answer is `applied`

#### Scenario: Code review approved

- **WHEN** the answer `external-review` arrives for a task carrying `personal`, `HITL` and `code-review` whose work is finished
- **THEN** the task carries `personal`, `HITL` and `external-review`, and the answer is `applied`

#### Scenario: Already moved on

- **WHEN** the answer `AFK` arrives for a task that no longer carries `grill-me`
- **THEN** the answer is `skipped` and nothing is written

#### Scenario: proposal not bootstrapped

- **WHEN** the answer `HITL` arrives for a GitHub task whose repository has no `proposal` label
- **THEN** the answer is `failed`, naming `--bootstrap-labels`, and the task's labels are unchanged

#### Scenario: Value outside the options

- **WHEN** the answer to the transition question is `grill-me`
- **THEN** it is `rejected` and nothing is written

#### Scenario: Autonomy answered for a task in proposal

- **WHEN** the answer `AFK` arrives for a task carrying `HITL` and `proposal`
- **THEN** it is `skipped` and nothing is written

### Requirement: Persist mode

With `--persist <attempt-id>`, the run SHALL run no step and SHALL persist what that attempt's stage defines: for `grill-me`, the definition and the stage summary; for `proposal`, `implement`, `verify` and `code-review`, the stage summary only. It SHALL require `--apply` and MAY be combined with `--json` only; any other flag with it, or a malformed attempt id, is a usage error. It SHALL exit 0 when the receipt is written and 3 otherwise. It takes no run lock.

#### Scenario: Persisted

- **WHEN** the run is invoked with `--apply --persist linear:DOT-121:grill-me:1` for a started attempt whose directory holds `definition.md` and `stage-summary.md`
- **THEN** no step runs, the definition and the comment are written and read back, the receipt is written and the process exits with code 0

#### Scenario: Proposal attempt persisted

- **WHEN** the run is invoked with `--apply --persist linear:DOT-121:proposal:1` for a started attempt whose directory holds `stage-summary.md`
- **THEN** the comment is written and read back, the task's description is unchanged, the receipt is written and the process exits with code 0

#### Scenario: Implementation attempt persisted

- **WHEN** the run is invoked with `--apply --persist linear:DOT-121:implement:1` for a started attempt whose directory holds `stage-summary.md`
- **THEN** the comment is written and read back, the task's description is unchanged, the receipt is written and the process exits with code 0

#### Scenario: Verification attempt persisted

- **WHEN** the run is invoked with `--apply --persist linear:DOT-121:verify:1` for a started attempt whose directory holds `stage-summary.md`
- **THEN** the comment is written and read back, the task's description is unchanged, the receipt is written and the process exits with code 0

#### Scenario: Code review attempt persisted

- **WHEN** the run is invoked with `--apply --persist linear:DOT-164:code-review:1` for a started attempt whose directory holds `stage-summary.md`
- **THEN** the comment is written and read back, the task's description is unchanged, the receipt is written and the process exits with code 0

#### Scenario: Persist without apply

- **WHEN** the run is invoked with `--persist linear:DOT-121:grill-me:1` and without `--apply`
- **THEN** the run prints a usage message and exits with code 1

### Requirement: Persist preconditions

Persist mode SHALL write nothing when the attempt is unknown, is not open, or belongs to a stage other than `grill-me`, `proposal`, `implement`, `verify` and `code-review`, or when its directory lacks a file its stage persists, or that file is empty: `definition.md` and `stage-summary.md` for `grill-me`, `stage-summary.md` for `proposal`, `implement`, `verify` and `code-review`. It SHALL report the reason and exit 3.

#### Scenario: Missing stage summary

- **WHEN** the attempt directory holds `definition.md` but no `stage-summary.md`
- **THEN** nothing is written to the tracker, the report names the missing file and the process exits with code 3

#### Scenario: Attempt already completed

- **WHEN** the attempt named is `completed`
- **THEN** nothing is written and the process exits with code 3

#### Scenario: Proposal attempt without a definition file

- **WHEN** a `proposal` attempt's directory holds `stage-summary.md` and no `definition.md`
- **THEN** persist mode does not report the definition as missing

#### Scenario: Test stage

- **WHEN** the attempt named belongs to the `test` stage
- **THEN** nothing is written and the process exits with code 3

#### Scenario: Verification attempt without a stage summary

- **WHEN** a `verify` attempt's directory holds no `stage-summary.md`
- **THEN** nothing is written, the report names the missing file and the process exits with code 3

#### Scenario: Code review attempt without a stage summary

- **WHEN** a `code-review` attempt's directory holds no `stage-summary.md`
- **THEN** nothing is written, the report names the missing file and the process exits with code 3

### Requirement: The transition waits for the persistence receipt

Transition mode and a transition answer SHALL refuse a task that has an open attempt of the stage it is leaving, `grill-me`, `proposal`, `implement`, `verify` or `code-review`, whose directory holds no persistence receipt. Transition mode reports it with no handoff and exit code 3, and applies nothing. The answer is `rejected`, naming the attempt. A task with no open attempt of that stage SHALL be transitioned as before.

#### Scenario: Definition not persisted

- **WHEN** `--apply --transition linear:DOT-121` runs while attempt `linear:DOT-121:grill-me:1` is started and has no receipt
- **THEN** the report names the attempt and the missing receipt, carries no handoff, and the process exits with code 3

#### Scenario: Definition persisted

- **WHEN** the same attempt holds a receipt
- **THEN** transition mode emits its question as before

#### Scenario: Stage summary not persisted

- **WHEN** `--apply --transition linear:DOT-121` runs for an `AFK` task in `proposal` while attempt `linear:DOT-121:proposal:1` is started and has no receipt
- **THEN** nothing is written, the report names the attempt and the missing receipt, and the process exits with code 3

#### Scenario: Manual transition

- **WHEN** a task in `grill-me` has no open attempt
- **THEN** transition mode emits its question without checking any receipt

#### Scenario: Implementation summary not persisted

- **WHEN** `--apply --transition linear:DOT-121` runs for an `AFK` task in `implement` while attempt `linear:DOT-121:implement:1` is started and has no receipt
- **THEN** the report names the attempt and the missing receipt, nothing is written, and the process exits with code 3

#### Scenario: Verification summary not persisted

- **WHEN** `--apply --transition linear:DOT-121` runs for an `AFK` task in `verify` while attempt `linear:DOT-121:verify:1` is started and has no receipt
- **THEN** the report names the attempt and the missing receipt, nothing is written, and the process exits with code 3

#### Scenario: Code review summary not persisted

- **WHEN** `--apply --transition linear:DOT-164` runs for an `AFK` task in `code-review` while attempt `linear:DOT-164:code-review:1` is started and has no receipt
- **THEN** the report names the attempt and the missing receipt, nothing is written, and the process exits with code 3

### Requirement: Approval question

The question for an `HITL` task in `proposal`, `implement`, `verify` or `code-review` SHALL have the same id shape and step as the transition question, and the same header rule with `approval` in place of `autonomy`. Its text names the source, task id, title and labels, and says that the proposal is ready, for a task in `proposal`, that the implementation is ready, for a task in `implement`, that the verification is ready, for a task in `verify`, or that the code review is ready, for a task in `code-review`. Its options SHALL be `Approve`, with the value of the next stage, `implement`, `verify`, `code-review` or `external-review`, and `Later`, with a null value, and it SHALL accept a single choice. It SHALL NOT ask for autonomy or scope.

#### Scenario: Options

- **WHEN** the approval question is composed for a task carrying `personal`, `HITL` and `proposal`
- **THEN** it offers `Approve` and `Later` only

#### Scenario: Later

- **WHEN** the human answers `Later`
- **THEN** no answer is applied and the task keeps `proposal`

#### Scenario: Implementation ready

- **WHEN** the approval question is composed for a task carrying `personal`, `HITL` and `implement`
- **THEN** it says the implementation is ready, and `Approve` carries the value `verify`

#### Scenario: Verification ready

- **WHEN** the approval question is composed for a task carrying `personal`, `HITL` and `verify`
- **THEN** it says the verification is ready, and `Approve` carries the value `code-review`

#### Scenario: Code review ready

- **WHEN** the approval question is composed for a task carrying `personal`, `HITL` and `code-review`
- **THEN** it says the code review is ready, and `Approve` carries the value `external-review`

## ADDED Requirements

### Requirement: Leaving code-review needs the work finished

Transition mode and a transition answer SHALL refuse a task in `code-review` on the same guards as a task in `implement`: an unchecked task of the change, uncommitted changes in the working tree, or commits the remote branch lacks, with the change found as the stage's prerequisites find it. Every reason that holds SHALL be reported, and nothing SHALL be written.

#### Scenario: Uncommitted fix

- **WHEN** `--apply --transition linear:DOT-121` runs for an `AFK` task in `code-review` whose workspace has an uncommitted change
- **THEN** the report names the uncommitted changes, nothing is written, and the process exits with code 3

#### Scenario: Unpushed fix

- **WHEN** the answer `external-review` arrives for a task in `code-review` whose branch has a commit its remote branch lacks
- **THEN** the answer is `rejected`, naming the unpushed commit, and the task keeps `code-review`

#### Scenario: Work finished

- **WHEN** every task of the change is checked, the working tree is clean and the branch is pushed
- **THEN** the guards pass and the transition proceeds by the task's autonomy

### Requirement: Publish mode

With `--publish <attempt-id>`, the run SHALL run no step and SHALL publish the finding threads that the attempt's `threads.json` lists on the task's pull request. It posts one review, with the event COMMENT, holding the new threads. It resolves those marked resolved, and answers and resolves the earlier threads the file names. It SHALL require `--apply` and MAY be combined with `--json` only. It SHALL exit 0 when every thread is read back as written and 3 otherwise.

#### Scenario: Threads published

- **WHEN** the run is invoked with `--apply --publish linear:DOT-164:code-review:1` and `threads.json` lists one fixed finding and one finding passed on to QA
- **THEN** the pull request holds one new review with two threads, the first resolved and the second open, and the process exits with code 0

#### Scenario: Published twice

- **WHEN** the same invocation runs a second time
- **THEN** no thread or review is added, because their markers are already on the pull request, and the process exits with code 0

#### Scenario: Missing threads file

- **WHEN** the attempt's directory holds no `threads.json`
- **THEN** nothing is written, the report names the missing file and the process exits with code 3

#### Scenario: Publish without apply

- **WHEN** the run is invoked with `--publish linear:DOT-164:code-review:1` and without `--apply`
- **THEN** the run prints a usage message and exits with code 1

### Requirement: Publish mode imports the walkthrough

When the attempt's directory holds the walkthrough guide and its patch, publish mode SHALL import the guide for the task's pull request with Plannotator. When Plannotator is not available, or the import fails, the report SHALL say so, and the threads SHALL still be published.

#### Scenario: Plannotator not installed

- **WHEN** publish mode runs with a guide in the attempt's directory and no `plannotator` command
- **THEN** the threads are published, the report says the walkthrough was not imported and why, and the process exits with code 0
