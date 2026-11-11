# label-contract Specification

## Purpose

The label vocabulary shared by every tracker the autonomous loop reads — which labels exist, what they mean, how they are spelled and coloured, which legacy labels count as evidence — the user configuration that carries its per-user parts, and the bootstrap that creates missing labels on a tracker.

## Requirements

### Requirement: Three label groups

Every task SHALL carry labels from three groups. The **scope** group is `work` and `personal`. The **autonomy** group is `AFK` and `HITL`. The **stage** group is `grill-me` and `proposal`. Each group SHALL hold exactly one label on a task: two labels of the same group are a conflict. A task without a label of a group is untagged for that group, except that a task whose stage is `grill-me` MAY lack autonomy. Missing groups and conflicts SHALL be detected and reported per group, and SHALL NOT be resolved by the system removing or replacing a label.

#### Scenario: Complete task

- **WHEN** a task carries `personal`, `AFK` and `proposal`
- **THEN** it is complete for all three groups

#### Scenario: Grill without autonomy

- **WHEN** a task carries `personal` and `grill-me`
- **THEN** it is complete, and its autonomy is not reported as missing

#### Scenario: Grill with a decided autonomy

- **WHEN** a task carries `work`, `HITL` and `grill-me`
- **THEN** it is complete for all three groups

#### Scenario: Missing entry group

- **WHEN** a task carries `work` and none of the former entry labels `AFK`, `HITL` and `grill-me`
- **THEN** it is reported as untagged for the autonomy group and for the stage group

#### Scenario: Missing stage

- **WHEN** a task carries `work` and `AFK`
- **THEN** it is reported as untagged for the stage group only

#### Scenario: Missing autonomy outside a grill

- **WHEN** a task carries `personal` and `proposal`
- **THEN** it is reported as untagged for the autonomy group only

#### Scenario: Both scopes

- **WHEN** a task carries `work` and `personal`
- **THEN** it is reported as a scope conflict and neither label is removed

#### Scenario: AFK with HITL

- **WHEN** a task carries `AFK` and `HITL`
- **THEN** it is reported as an autonomy conflict for a human to resolve

#### Scenario: Two stages

- **WHEN** a task carries `grill-me` and `proposal`
- **THEN** it is reported as a stage conflict for a human to resolve

### Requirement: Meaning of each label

The contract SHALL fix one meaning per label: `work` is Nazaries work; `personal` is the user's own work; `AFK` means an agent may advance the task without a human; `HITL` means an agent may advance the task but a human intervenes during or at the end of each stage; `grill-me` means the task must be refined with a human in a grill before anyone works on it; `proposal` means the task is ready for proposal preparation, its autonomy decided and any grill it needed over; `taken` means an agent or a person is advancing the task now. Scope and autonomy are properties, kept for the whole life of a task; the stage says where the task is and is replaced by each transition. While a task is in `grill-me`, its autonomy, when it has one, is provisional until the grill confirms it. No scope has priority over the other in the contract. What each label implies for selecting work, including the preference for the machine's scope, is defined by the capability that selects work, not by this contract.

#### Scenario: grill-me with AFK

- **WHEN** a task carries `AFK` and `grill-me`
- **THEN** the contract reads it as needing refinement before any agent works on it, with a provisional autonomy that the grill confirms

#### Scenario: proposal with HITL

- **WHEN** a task carries `HITL` and `proposal`
- **THEN** the contract reads it as ready for proposal preparation, with a human intervening in each stage

#### Scenario: Meaning of work in a triage question

- **WHEN** triage offers `work` as an option
- **THEN** its description says it is Nazaries work and does not claim priority over personal work

### Requirement: One spelling and one colour per label

Each label SHALL have exactly one spelling, used verbatim on every tracker: `work`, `personal`, `AFK`, `HITL`, `grill-me`, `proposal`, `taken`. Matching SHALL be exact and case-sensitive; a label that differs only in case or spacing (for example `Grill Me`) is not the contract label. Each label SHALL have one colour, applied on trackers that support colour: `AFK` `#5e6ad2`, `HITL` `#eb5757`, `grill-me` `#f2994a`, `proposal` `#bb87fc`, `work` `#2f80ed`, `personal` `#27ae60`, `taken` `#95a2b3`. A tracker without label colours carries the name only.

#### Scenario: Near-miss spelling

- **WHEN** a Linear task carries `Grill Me` and the configuration declares no alias for it
- **THEN** the task is untagged for the stage group

#### Scenario: Tracker without colours

- **WHEN** the contract is applied to Beads
- **THEN** labels are matched by name and no colour is involved

#### Scenario: Near-miss taken

- **WHEN** a task carries `Taken`
- **THEN** it is not taken

#### Scenario: Near-miss proposal

- **WHEN** a task carries `Proposal`
- **THEN** the task is untagged for the stage group

### Requirement: Aliases are evidence, never removed

The configuration MAY declare, per source, alias labels that count as evidence for one contract label (for example Beads `nazaries` for `work`, `human` for `HITL`). An alias SHALL NOT count as the contract label being present. The system SHALL NOT remove, rename or replace an alias or any other label outside the contract. Apart from a transition and the removal of `taken`, the only write the contract allows is adding a contract label.

#### Scenario: Alias present

- **WHEN** a Beads task carries `nazaries` and no scope label
- **THEN** it is untagged for the scope group, with `nazaries` recorded as evidence for `work`

#### Scenario: Alias kept by a transition

- **WHEN** a transition moves a Beads task carrying `nazaries`, `work` and `grill-me` to `proposal`
- **THEN** the task still carries `nazaries` and `work`

### Requirement: Structural rules

The configuration MAY declare that every task of a source has a given scope. A structural rule SHALL count as evidence for that scope for every task of that source.

#### Scenario: Whole source rule

- **WHEN** the configuration declares that every Linear task is `personal`
- **THEN** every Linear task without a scope label carries evidence for `personal`

### Requirement: User configuration file

The per-user parts of the contract SHALL live in one JSON file outside the plugin, at `~/.config/autonomous/config.json` unless the environment variable `AUTONOMOUS_CONFIG` names another path. It SHALL be identified by `schema: "autonomous.config.v1"` and SHALL hold: per source, whether it is enabled, its aliases and structural rules, the Beads directory and the GitHub repository list; the judgement settings — model, effort, confidence threshold, tasks judged per run, tasks per batch; the selection settings — model and effort; and the optional session, workspace and naming settings. It SHALL carry no credentials. The file SHALL be validated strictly: a missing file, a missing required field, a mistyped field or an unknown field is an error naming the path, never a corrected value; an optional block or key that is absent takes its shipped default, and the run reports it. The plugin SHALL ship the format, the defaults and an example, and the error for a missing file SHALL point to the example.

#### Scenario: Missing file

- **WHEN** no configuration file exists at the resolved path
- **THEN** any behaviour that needs the contract reports it as not evaluable, naming the path and the example

#### Scenario: Unknown field

- **WHEN** the file contains a field the schema does not define
- **THEN** it is rejected with the field's path

#### Scenario: Missing selection settings

- **WHEN** the file has no `selection` block
- **THEN** it is rejected with the path `selection`

#### Scenario: Missing sessions settings

- **WHEN** the file has no `sessions` block
- **THEN** it is accepted and the `sessions` keys take the shipped defaults

### Requirement: Optional configuration blocks with shipped defaults

The configuration file MAY omit the `sessions`, `workspace` and `naming` blocks or any key inside them. The plugin SHALL ship a defaults file for those blocks, and a key absent from the user's file SHALL take the shipped value, key by key. A key present in the user's file SHALL still be validated strictly, and an unknown key is still an error. Every run SHALL report the keys that took a shipped default.

#### Scenario: Block omitted

- **WHEN** the file has no `sessions` block
- **THEN** every `sessions` key takes the shipped default and the report lists them

#### Scenario: One key set

- **WHEN** the file sets `sessions.tool` only
- **THEN** that value is used and the other `sessions` keys take the shipped defaults

#### Scenario: Mistyped optional key

- **WHEN** the file sets `naming.effort` to `"fast"`
- **THEN** the configuration is rejected with the path `naming.effort`

### Requirement: Session, workspace and naming settings

The configuration SHALL hold, under `sessions`: `tool` (`claude` or `codex`), `profile` (the session manager's profile, or null for its default) and `binary` (the agent binary or wrapper to run, or null for the tool's own); under `workspace`: `root`, the directory whose git repositories are the launch targets; under `naming`: `model` and `effort` for the session name inference. The shipped defaults SHALL be `claude`, null, null, `~/WebstormProjects`, `haiku` and `low`.

#### Scenario: Shipped defaults

- **WHEN** the file carries none of the three blocks
- **THEN** sessions run `claude` on the session manager's default profile, repositories are looked up under `~/WebstormProjects`, and names are inferred with `haiku` at effort `low`

### Requirement: Label bootstrap

On request, the system SHALL make every contract label exist on every enabled source with the contract's colour. It lists the source's labels, creates each missing contract label with its colour where the tracker supports colour, and recolours each existing contract label whose colour differs, reporting it as recoloured. It SHALL never touch a label outside the contract, rename a label or delete one. On Linear, labels SHALL be created at workspace level, and a same-name label that already exists in a team SHALL count as present, so no workspace duplicate is created; a recolour applies to the label in each scope where it exists. On GitHub, it works per configured repository; on Beads, labels exist by use and nothing is created or recoloured. It SHALL report, per source, the labels created, recoloured, already present and any that could not be created or recoloured. A source whose CLI is missing, not authenticated or failing SHALL be reported as not evaluable with the command that failed, and the other sources SHALL still be processed.

#### Scenario: Label missing on Linear

- **WHEN** Linear lacks `proposal` and the bootstrap runs
- **THEN** `proposal` is created at workspace level with colour `#bb87fc` and reported as created

#### Scenario: Label present in a Linear team

- **WHEN** Linear has `AFK` only in team `DOT`, with the contract's colour, and the bootstrap runs
- **THEN** no workspace `AFK` is created and `AFK` is reported as present in team `DOT`

#### Scenario: Label present with another colour

- **WHEN** GitHub repository `dotfiles` has `AFK` in colour `#000000`
- **THEN** its colour is changed to `#5e6ad2` and it is reported as recoloured

#### Scenario: Team label with another colour

- **WHEN** Linear has `HITL` only in team `DOT`, in colour `#000000`
- **THEN** that team label is recoloured to `#eb5757` and no workspace `HITL` is created

#### Scenario: Recolour fails

- **WHEN** recolouring a Linear label fails
- **THEN** the label is reported as failed with the command that failed, and the other labels are still processed

#### Scenario: Label outside the contract

- **WHEN** GitHub repository `dotfiles` has a label `bug` in any colour
- **THEN** the bootstrap leaves it untouched and does not report it

#### Scenario: Beads

- **WHEN** the bootstrap processes Beads
- **THEN** it reports that Beads needs no label creation

#### Scenario: Unauthenticated CLI

- **WHEN** `linear` reports that no credentials are configured
- **THEN** Linear is reported as not evaluable, naming `linear auth login`, and GitHub and Beads are still processed

### Requirement: The taken label

The contract SHALL include a `taken` label that belongs to no group. It is never required, never missing and never in conflict, and label triage SHALL neither derive it nor ask about it. It SHALL mean that an agent or a person is advancing the task now and that it is not selected until the label is removed. It is the only evidence that a task is taken; a tracker status is not. The runner SHALL add it when it launches a managed session for the task and SHALL remove it only when the attempt is finalised and its session is gone, or when no session was created; a retained attempt keeps it. Removing `taken` this way is the second exception to the rule that the loop never removes a label.

#### Scenario: Task without taken

- **WHEN** a task carries `work`, `AFK` and `proposal` and no `taken`
- **THEN** it is complete for every group and nothing reports `taken` as missing

#### Scenario: Taken added at launch

- **WHEN** the runner launches a managed session for a task
- **THEN** the task carries `taken` before the session exists

#### Scenario: Taken kept while retained

- **WHEN** an attempt is retained after its session exited without completing
- **THEN** the task still carries `taken` until the attempt is discarded

#### Scenario: Taken removed at finalisation

- **WHEN** an attempt is finalised and its session removed
- **THEN** `taken` is removed from the task and nothing else is removed

### Requirement: Taken has no aliases and is bootstrapped

The configuration SHALL NOT declare aliases for `taken`. The label bootstrap SHALL create `taken` like every other contract label.

#### Scenario: Alias for taken

- **WHEN** the configuration declares a Beads alias for `taken`
- **THEN** the configuration is rejected with the alias's path

#### Scenario: Bootstrap on GitHub

- **WHEN** a configured GitHub repository lacks `taken` and the bootstrap runs
- **THEN** `taken` is created with colour `#95a2b3` and reported as created

### Requirement: A transition replaces the stage

A transition SHALL move a task out of its stage on a human's answer. It adds the answered autonomy and the next stage, then removes the stage it leaves and every other autonomy label, and reads the task back. Labels SHALL be added before any is removed. It is the first exception to the rule that the loop never removes a label, and it removes nothing else. The only transition SHALL be from `grill-me` to `proposal`.

#### Scenario: Grill ends with AFK

- **WHEN** a transition is applied with the answer `AFK` to a task carrying `work` and `grill-me`
- **THEN** the task carries `work`, `AFK` and `proposal`

#### Scenario: Autonomy replaced

- **WHEN** a transition is applied with the answer `AFK` to a task carrying `work`, `HITL` and `grill-me`
- **THEN** the task carries `work`, `AFK` and `proposal`, and `HITL` was removed

#### Scenario: Autonomy conflict resolved

- **WHEN** a transition is applied with the answer `HITL` to a task carrying `personal`, `AFK`, `HITL` and `grill-me`
- **THEN** the task carries `personal`, `HITL` and `proposal`

#### Scenario: Write cut short

- **WHEN** adding `proposal` fails after `AFK` was added to a task carrying `work` and `grill-me`
- **THEN** nothing is removed and the task still carries `grill-me`
