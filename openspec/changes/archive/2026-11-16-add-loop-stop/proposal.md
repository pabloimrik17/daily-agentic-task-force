# Proposal

## Why

A loop started from an agent session keeps running after that session is closed, and
there is no command to stop it: the person must read the pid in `loop.lock` and send it
a signal by hand. Stopping the loop should be one command.

## What Changes

- New command `/autonomous:loop-stop`. It takes no arguments, asks nothing, runs the
  step runner once with `--stop-loop` and shows its output verbatim with its exit code.
- New mode `--stop-loop` of the step runner. It asks the live loop of the state
  directory to stop with one termination signal, which is the clean stop the loop
  already honours: the wait between iterations ends at once, and an iteration in
  progress ends first, so a launch is never cut.
- After the request the mode waits up to 10 seconds for the loop to end and says which
  of the two happened: `loop stopped`, or
  `loop stopping: the iteration in progress ends first`. Both exit with code 0.
- With no live loop it prints `loop stopped: not running` and exits with code 2, the
  line and code `--notices` already uses. A lock left by a dead process is not touched.
- When the request cannot be sent it reports the error on standard error and exits
  with code 1.
- `--stop-loop` combines with no other flag and does not need `--apply`.
- The sessions the loop launched are not touched: their attempts stay open and keep
  their slots.
- Documentation: the README's "Stopping it" section, its paragraph on the loop
  outliving the session, the usage text, and the rule "There is no stop command" in
  `commands/loop.md` point to the new command.

Not breaking: nothing that works today changes. Signals sent by hand keep working.

Out of scope:

- A forced stop that cuts an iteration in progress.
- Stopping or discarding the sessions the loop launched.
- Stopping the loop automatically when the session that started it ends. The loop
  still outlives the session.
- Making writes the default and replacing `--apply` with a dry-run flag. It is a
  separate task.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `autonomous-loop`: adds the stop mode of the step runner and the
  `/autonomous:loop-stop` command, and adds `--stop-loop` to the flag combination
  rules.

## Impact

- `plugins/autonomous/src/args.ts`: the `--stop-loop` flag, its combination rule and
  the usage text.
- `plugins/autonomous/src/run.ts`: dispatch of the new mode.
- `plugins/autonomous/src/loop/`: a new module for the stop mode, with its tests.
- `plugins/autonomous/src/attempts/lock.ts`: a read of the loop lock's owner.
- `plugins/autonomous/commands/loop-stop.md`: the new command.
- `plugins/autonomous/commands/loop.md` and `plugins/autonomous/README.md`: wording.
- No new dependency, no configuration, no change to the state directory's files.
- Release: `feat(autonomous)`, a minor version.
