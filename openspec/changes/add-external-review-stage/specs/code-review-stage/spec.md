## MODIFIED Requirements

### Requirement: The code review leaves the pull request a draft

The stage's session SHALL leave the task's pull request a draft: neither the prompt, nor publish, persist or log mode SHALL mark it ready for review. The transition the stage ends with marks it ready, as the transition into `external-review` defines.

#### Scenario: Before the transition

- **WHEN** a code review's orchestrator has run publish mode and persist mode and has not run the transition
- **THEN** the task's pull request is still a draft

#### Scenario: Code review complete

- **WHEN** an attempt of the code review stage completes on a machine that holds the task's workspace
- **THEN** the task carries `external-review` and its pull request is ready for review
