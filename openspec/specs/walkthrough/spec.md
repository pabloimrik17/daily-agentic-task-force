# walkthrough Specification

## Purpose

The walkthrough of a task's pull request, the explanation for the human who reviews it: the review team's draft brought up to the final diff by code, with each published finding at its place, saved in Plannotator for the pull request and rendered for the logbook entry.

## Requirements

### Requirement: The walkthrough follows the final diff

Publish mode SHALL bring the review team's walkthrough draft up to the pull request's diff as it is when the mode runs. A file the draft does not place SHALL go to a trailing section titled "Code review fixes"; every other section, overview and summary of the draft SHALL stay as the walkthrough wrote it. The result SHALL be validated against the final diff's patch.

#### Scenario: Fix added a test file

- **WHEN** a fix added a regression test file that the draft does not place
- **THEN** the walkthrough holds the draft's sections and a trailing section "Code review fixes" that places the test file

#### Scenario: Nothing added

- **WHEN** the fixes changed only files the draft already places
- **THEN** the walkthrough has no "Code review fixes" section

### Requirement: Each published finding is a note

Each finding publish mode published SHALL appear in the walkthrough: as a note on its hunk when the final diff holds its line in one hunk, and otherwise as a line of the overview of the section that places its file, or of the first section for a finding on the whole change. A note SHALL name the finding's label, statement, state and thread URL.

#### Scenario: Finding on a line

- **WHEN** a published finding is anchored to a line that one hunk of the final diff holds
- **THEN** the walkthrough has a note on that hunk naming the finding's state and thread URL

#### Scenario: Finding on a file

- **WHEN** a published finding is anchored to a file at file level
- **THEN** the overview of the section that places that file names the finding

### Requirement: No walkthrough without a draft or Plannotator

When the review team wrote no walkthrough draft, or Plannotator is not available, or the walkthrough fails validation, publish mode SHALL write no walkthrough, publish the threads as usual, and report why. The reason SHALL reach the logbook entry.

#### Scenario: Plannotator missing

- **WHEN** publish mode runs and the `plannotator` command is not found
- **THEN** the threads are published, no walkthrough is written, and the report says Plannotator is not available

### Requirement: The walkthrough is saved for the pull request

Publish mode SHALL save the walkthrough in Plannotator for the task's pull request, so that a later Plannotator review of that pull request lists it. It SHALL save it again only when it changed since the last save of the attempt.

#### Scenario: Saved once

- **WHEN** publish mode runs twice in an attempt and nothing changed between the runs
- **THEN** Plannotator holds one walkthrough of the attempt for the pull request

#### Scenario: Changed by a human round

- **WHEN** a human round adds a fix and publish mode runs again
- **THEN** Plannotator saves the new walkthrough for the pull request

### Requirement: The walkthrough files for the session and the logbook

Publish mode SHALL leave in the attempt's directory the walkthrough, the patch it was validated against, and a short markdown rendering: its title, its intent and the title of each section with the count of findings in it. The agent sends the first two to an `HITL` human and puts the rendering in the logbook entry.

#### Scenario: Rendering

- **WHEN** publish mode writes a walkthrough of three sections, one of them holding two findings
- **THEN** the rendering names the title, the intent and the three section titles, with the count `2` on the one with findings
