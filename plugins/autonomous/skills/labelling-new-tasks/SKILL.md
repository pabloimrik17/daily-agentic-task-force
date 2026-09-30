---
name: labelling-new-tasks
description: Use when about to create or file one or more new issues, tasks, tickets, or bugs in Linear, Beads, or GitHub, including through bd create, gh issue create, linear issue create, or a Linear MCP create.
allowed-tools: Bash(bun ${CLAUDE_PLUGIN_ROOT}/src/label-at-creation/cli.ts *)
---

# Label new tasks

For each task being created, keep its intended tracker, title, description,
parent, and other fields. Decide its contract labels before the create call.
This skill applies to task creation, not comments, edits, relabelling, closure,
or pull requests.

1. Collect every label the task will carry: labels the user names and other
   planned labels. For `bd create --parent <id>` without
   `--no-inherit-labels`, read the parent's labels with `bd show <id>` and
   include them. Write each contract label in its exact spelling, `work`,
   `personal`, `AFK`, `HITL` or `grill-me`, so `afk` becomes `AFK` and
   `Grill Me` becomes `grill-me`. Pass and create only the corrected form,
   never the variant as well.
2. Run `prepare`, adding `--repo` only for GitHub and one `--label` per
   collected label:

    ```bash
    bun ${CLAUDE_PLUGIN_ROOT}/src/label-at-creation/cli.ts prepare --source <linear|beads|github> [--repo <owner/name>] [--label <name>]...
    ```

    Read the printed criteria and each group's `present`, `derived`,
    `conflict`, or `judge` line.

3. Judge every `judge` group, and a `derived` group only when the conversation
   contradicts its evidence. Judge from the whole conversation and the intended
   title and description, with labels from that group and an honest confidence
   written as a decimal such as `0.9`. **Always run `decide`**, including when
   `prepare` reports a conflict or no group needs judgement. Pass the same
   source, repo, and labels, plus one `--judged` per judged group:

    ```bash
    bun ${CLAUDE_PLUGIN_ROOT}/src/label-at-creation/cli.ts decide --source <linear|beads|github> [--repo <owner/name>] [--label <name>]... [--judged <group>=<label>[,<label>]@<confidence>]...
    ```

    Only `decide` determines which labels to apply or ask about.

4. For each `ask` line, use the `AskUserQuestion` tool when it is available:
   ask one question before creation with that group's listed options and
   reason. Run `decide` again with that group's `--label` values replaced by
   the answer and its `--judged` removed. When that tool is absent, do not ask
   in plain text or wait for a reply: create now with the returned `apply` labels (`none`
   means no contract label), then name each omitted group and its reason in the
   reply for later `/autonomous:run --apply` triage. If a group is still asked
   about after the second `decide`, take that same path.
5. Create the task with all non-contract labels originally intended plus the
   helper's `apply` labels in the create call itself, using the session's
   tracker tool. With `bd create --parent`, also pass `--no-inherit-labels`:
   the parent's non-contract labels are already in that list, and Beads would
   otherwise copy the parent's contract labels back beside `apply`. Decide and
   create each task separately.

| Tool                  | Label input at creation                            |
| --------------------- | -------------------------------------------------- |
| `bd create`           | `--labels name1,name2`                             |
| `gh issue create`     | repeat `--label name`                              |
| `linear issue create` | repeat `--label name`                              |
| Linear MCP create     | `labels` field, resolving names to IDs if required |
| Any other create tool | its labels field                                   |

If the tracker rejects a missing label and created nothing, retry once,
dropping just the rejected labels. Report their names and point to
`/autonomous:run --bootstrap-labels`; for GitHub, first add the repository to
the user configuration. Never create a tracker label from this skill. In the
reply, name every contract label applied and every group left for triage.
