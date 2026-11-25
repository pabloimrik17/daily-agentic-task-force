## MODIFIED Requirements

### Requirement: Next stage of a task

The next stage of a task SHALL be the stage label it carries: `grill-me`, `proposal`, `implement`, `verify`, `code-review` or `external-review`. A task without a stage label has no next stage and is excluded under classification. The supported stages SHALL be `grill-me`, `proposal`, `implement`, `verify` and `code-review`.

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
- **THEN** its next stage is `external-review`, which is not supported

### Requirement: Most advanced stage first

Before the choice, the step SHALL keep only the candidates whose next stage is the most advanced among the candidates, in the order of the stage labels of the label contract: `grill-me`, then `proposal`, then `implement`, then `verify`, then `code-review`. The other candidates SHALL be set aside for this run and reported as such. The rule SHALL apply whatever the scope of the candidates, in a run and in an iteration.

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
