# Spec Delta

## MODIFIED Requirements

### Requirement: Next stage of a task

The next stage of a task SHALL be the stage label it carries: `grill-me`, `proposal`, `implement`, `verify`, `code-review`, `qa`, `external-review`, `wrap-up` or `ready-to-merge`. A task without a stage label has no next stage and is excluded under classification. The supported stages SHALL be `grill-me`, `proposal`, `implement` and `verify`; a task whose next stage is any other is excluded as an unsupported stage.

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
- **THEN** its next stage is `code-review`, which is not supported

#### Scenario: Task in a stage declared later

- **WHEN** a task carries `personal`, `AFK` and one of `qa`, `external-review`, `wrap-up` or `ready-to-merge`
- **THEN** its next stage is that label, which is not supported
