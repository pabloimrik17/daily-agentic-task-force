# Tasks

## 1. The flag

- [x] 1.1 Add `stopLoop` to `RunArgs` and the `--stop-loop` flag in
      `plugins/autonomous/src/args.ts`, with the rule "`--stop-loop` cannot be
      combined with other flags" and one usage line; make `--loop`, `--notices` and
      the modes that accept only some flags reject it. Verify with new cases in
      `args.test.ts`: `--stop-loop` alone parses, and `--stop-loop --apply`,
      `--stop-loop --json`, `--stop-loop --loop` and `--stop-loop --notices 0` are
      usage errors with exit code 1.

## 2. The stop mode

- [x] 2.1 Export from `plugins/autonomous/src/attempts/lock.ts` a read of the loop
      lock that tells apart: no lock, a live owner with its pid, an owner whose
      process is gone, and a lock with no readable owner. It never writes. Verify
      with tests in the lock's test file for the four cases.
- [x] 2.2 Create `plugins/autonomous/src/loop/stop.ts` with the mode of design D5 to
      D7: one SIGTERM through an injected `signal(pid)`, then a poll of `loopIsAlive`
      every 250 ms for at most 10 seconds through the injected `wait`. Verify with
      `stop.test.ts`, one test per row of the table in design D6 plus: the loop ends
      within the wait (`loop stopped`, exit 0), the loop is still alive after 10
      seconds (`loop stopping: the iteration in progress ends first`, exit 0),
      exactly one signal is sent in every case, and a stale lock is still on disk
      afterwards.
- [x] 2.3 Dispatch `args.stopLoop` in `plugins/autonomous/src/run.ts`, with the real
      `signal` being `process.kill(pid, "SIGTERM")`, no configuration loaded and no
      lock taken. Verify with a case in `run.test.ts` that `--stop-loop` on an empty
      state directory prints `loop stopped: not running` and returns 2 without
      reading the configuration.
- [x] 2.4 Verify the whole path against a real loop process: in a temporary
      `AUTONOMOUS_STATE`, start a process that takes the loop lock and stops on
      signals as the loop does, run `--stop-loop`, and check that it prints
      `loop stopped`, exits with 0, that `loop.notices` ends with
      `loop stopped: received SIGTERM` and that `loop.lock` is gone. Land it as a
      test if it runs reliably under vitest; otherwise record the manual run in the
      change's evidence.

## 3. The command and the documentation

- [x] 3.1 Create `plugins/autonomous/commands/loop-stop.md` as in design D8: no
      arguments, `allowed-tools: Bash(bun:*)`, one foreground run of
      `bun "${CLAUDE_PLUGIN_ROOT}/src/run.ts" --stop-loop`, output and exit code
      relayed verbatim in a code block, and the rule to add no text and never run it
      twice. Verify that the plugin validation of the repository passes and that
      the command appears in a session with the plugin loaded.
- [x] 3.2 In `plugins/autonomous/commands/loop.md`, replace the rule "There is no
      stop command. To stop the loop, stop its background task." with one that
      names `/autonomous:loop-stop`. Verify that the file no longer says there is no
      stop command.
- [x] 3.3 In `plugins/autonomous/README.md`: rewrite "Stopping it" around the
      command, with the table of outputs and exit codes, the note that launched
      sessions stay open, the warning not to repeat the command while the loop is
      stopping, and the signals kept as the mechanism underneath; point the
      paragraph "The loop outlives the session" to the command; add the command and
      the flag to the command and flag tables. Verify with `bun run lint:markdown`
      and by reading that every statement matches the spec delta.

## 4. Integration

- [x] 4.1 Run the repository's checks: type check, lint, the full test suite and the
      fallow audit. Verify that all pass and that no function exceeds the
      complexity budget.
- [x] 4.2 Run `openspec validate add-loop-stop --strict` and verify it passes.

## Workflow follow-up

- Archive the change after the pull request is merged.
