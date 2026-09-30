# Interactive handoff evidence

## Eval case (task 8.2)

Case `plugins/autonomous/evals/run-nobody-to-ask` covers the scenario "Nobody to
ask": the report carries a handoff and the session cannot ask the user.

The obstacle was `quota-gate`, which runs `openusage claude` from `PATH`. A probe
case (deleted afterwards) ran `echo "$PATH"; echo "$HOME"; pwd; command -v
openusage bun bd` in the eval sandbox:

- `HOME` is the sandbox (`<temp>/home`), the working directory is `<temp>/home/cwd`.
- `PATH` is inherited from the caller unchanged, so the real `/usr/local/bin/openusage`
  resolves, and a scaffold cannot put anything ahead of it through `PATH` alone.
- The Bash tool of the eval agent does read shell start-up files from the sandbox
  `HOME`. A second probe whose scaffold wrote `export PATH="$HOME/bin:$PATH"` to
  `.zshenv`, `.zshrc`, `.zprofile`, `.bashrc`, `.bash_profile` and `.profile` resolved
  `openusage` to `<temp>/home/bin/openusage`.

So the scaffold installs a fake `openusage` (one `claude` account at 5% of both
windows, so the gate advances), a Beads task labelled `nazaries` and `AFK`, and a
config with only Beads enabled, `scope: "personal"` and `aliases: { work:
["nazaries"] }`. The scope evidence conflicts and becomes a question.

Run (`--model claude-sonnet-5 --runs 1 --max-cost-usd 3 --trust-plugin --no-publish`,
default with/without ablation): with plugin score 1.00 (both graders pass), without
plugin 0.50, cost USD 0.21. The trace shows the report ending in a `handoff:` line
with question `label-triage:beads:eval-pes:scope`; the agent looked for
AskUserQuestion, found none, showed the report and ended without any `--answer` call.
