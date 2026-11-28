## MODIFIED Requirements

### Requirement: Next stage of a task

The next stage of a task SHALL be the stage label it carries: `grill-me`, `proposal`, `implement`, `verify`, `code-review`, `qa`, `external-review`, `wrap-up` or `ready-to-merge`. A task without a stage label has no next stage and is excluded under classification. The supported stages SHALL be `grill-me`, `proposal`, `implement`, `verify`, `code-review` and `external-review`; a task whose next stage is any other is excluded as an unsupported stage.

#### Scenario: grill-me task

- **WHEN** a task carries `personal` and `grill-me`
- **THEN** its next stage is `grill-me` and it is supported

#### Scenario: AFK task

- **WHEN** a task carries `personal`, `AFK` and `proposal`
- **THEN** its next stage is `proposal`, which is supported

#### Scenario: Task ready to implement

- **WHEN** a task carries `personal`, `AFK` and `implement`
- **THEN** its next stage is `implement`, which is supported

#### Scenario: Task ready to verify

- **WHEN** a task carries `personal`, `AFK` and `verify`
- **THEN** its next stage is `verify`, which is supported

#### Scenario: Task ready for code review

- **WHEN** a task carries `personal`, `AFK` and `code-review`
- **THEN** its next stage is `code-review`, which is supported

#### Scenario: Task waiting for external review

- **WHEN** a task carries `personal`, `HITL` and `external-review`
- **THEN** its next stage is `external-review`, which is supported

#### Scenario: Task in a stage declared later

- **WHEN** a task carries `personal`, `AFK` and one of `qa`, `wrap-up` or `ready-to-merge`
- **THEN** its next stage is that label, which is not supported

### Requirement: Most advanced stage first

Before the choice, the step SHALL keep only the candidates whose next stage is the most advanced among the candidates, in the order of the stage labels of the label contract: `grill-me`, then `proposal`, then `implement`, then `verify`, then `code-review`, then `external-review`. The other candidates SHALL be set aside for this run and reported as such. The rule SHALL apply whatever the scope of the candidates, in a run and in an iteration.

#### Scenario: Proposal over grill

- **WHEN** one candidate is in `grill-me` and one in `proposal`, and both stages are supported
- **THEN** only the `proposal` candidate is kept, and the `grill-me` candidate is set aside

#### Scenario: Other scope at a later stage

- **WHEN** the machine scope is `work`, a `personal` candidate is in `proposal` and a `work` candidate is in `grill-me`, and both stages are supported
- **THEN** the `personal` candidate is kept and selected as a machine-scope exception

#### Scenario: Same stage

- **WHEN** every candidate is in `grill-me`
- **THEN** every candidate is kept and none is set aside

#### Scenario: Implementation before proposal

- **WHEN** one candidate is in `proposal` and one in `implement`, and both stages are supported
- **THEN** only the `implement` candidate is kept, and the `proposal` candidate is set aside

#### Scenario: Verification before implementation

- **WHEN** one candidate is in `implement` and one in `verify`, and both stages are supported
- **THEN** only the `verify` candidate is kept, and the `implement` candidate is set aside

#### Scenario: Code review before verification

- **WHEN** one candidate is in `verify` and one in `code-review`, and both stages are supported
- **THEN** only the `code-review` candidate is kept, and the `verify` candidate is set aside

#### Scenario: External review before code review

- **WHEN** one candidate is in `code-review` and one in `external-review`
- **THEN** only the `external-review` candidate is kept, and the `code-review` candidate is set aside

#### Scenario: Waiting task does not hold the others back

- **WHEN** a task in `external-review` is excluded as waiting for its review bots and a candidate is in `implement`
- **THEN** the `implement` candidate is kept

### Requirement: Candidates and exclusions

A task SHALL be a candidate, whatever its scope, unless an exclusion applies. Each excluded task SHALL be reported once, under the first that applies, in this order:

1. **classification**: a scope, autonomy or stage group missing or in conflict, by present contract labels only; autonomy is not missing while the stage is `grill-me`;
2. **taken**: it carries `taken`;
3. **labelled this run**: `label-triage` labelled it, or tried to, this run;
4. **unsupported stage**: its next stage is not supported;
5. **blocked**: an open blocker;
6. **split**: an open child, or, for a task whose next stage is `proposal`, any child, open or closed;
7. **waiting for review bots**: its next stage is `external-review` and its pull request is not settled, or cannot be read, as the review bots define. This exclusion SHALL NOT apply to a task supplied with `--task`.

#### Scenario: Small task that unblocks others

- **WHEN** a `grill-me` task has no open blocker and blocks two other tasks
- **THEN** it is a candidate and the tasks it blocks are part of what the comparison sees

#### Scenario: Taken grill-me task

- **WHEN** a task carries `personal`, `grill-me` and `taken`
- **THEN** it is excluded as taken

#### Scenario: AFK task already taken

- **WHEN** a task carries `personal`, `AFK`, `proposal` and `taken`
- **THEN** it is excluded as taken

#### Scenario: Task ready to implement

- **WHEN** a task carries `personal`, `AFK` and `implement`, and nothing else excludes it
- **THEN** it is not excluded as unsupported stage

#### Scenario: Task ready to verify

- **WHEN** a task carries `personal`, `AFK` and `verify`, and nothing else excludes it
- **THEN** it is not excluded as unsupported stage

#### Scenario: Task ready for code review

- **WHEN** a task carries `personal`, `AFK` and `code-review`, and nothing else excludes it
- **THEN** it is not excluded as unsupported stage

#### Scenario: Labelled by triage in this run

- **WHEN** `label-triage` applied `grill-me` to a task in this run
- **THEN** the task is excluded as labelled this run, and a later run may select it

#### Scenario: Write failed during triage

- **WHEN** a `label-triage` write to a task fails in this run after adding `grill-me`
- **THEN** the task is excluded as labelled this run, because a write was attempted and some labels may have landed

#### Scenario: Only proposed by triage

- **WHEN** `label-triage` only proposed or asked about a label for a task in this run
- **THEN** the task is not excluded as labelled this run

#### Scenario: Parent split into subtasks

- **WHEN** a `grill-me` task in Linear has an open child
- **THEN** it is excluded as split

#### Scenario: Split parent whose subtasks are closed

- **WHEN** a task carrying `personal`, `AFK` and `proposal` has two children, both closed
- **THEN** it is excluded as split

#### Scenario: Grill of a task whose subtasks are closed

- **WHEN** a task carrying `personal` and `grill-me` has one child, closed
- **THEN** it is not excluded as split

#### Scenario: Missing scope

- **WHEN** a task carries `grill-me` and no scope label, even with an alias for `work`
- **THEN** it is excluded under classification

#### Scenario: Missing stage

- **WHEN** a task carries `personal` and `AFK` and no stage label
- **THEN** it is excluded under classification

#### Scenario: Grill without autonomy

- **WHEN** a task carries `work` and `grill-me` and nothing else excludes it
- **THEN** it is a candidate

#### Scenario: Review bot still reviewing

- **WHEN** a task carries `personal`, `AFK` and `external-review`, nothing earlier excludes it, and a review bot is reviewing its pull request's head commit
- **THEN** it is excluded as waiting for review bots

#### Scenario: Settled pull request

- **WHEN** the same task's pull request is settled
- **THEN** it is a candidate

#### Scenario: Taken task in external-review

- **WHEN** a task carries `external-review` and `taken`
- **THEN** it is excluded as taken, and its pull request is not read
