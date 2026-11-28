# Design

## Context

See proposal.md for the motivation. What exists today:

- The loop holds `loop.lock` in the state directory for its whole life. The file holds
  the loop's pid and start time (`src/attempts/lock.ts`).
- `stopOnSignals` (`src/loop/signals.ts`) turns the first SIGINT or SIGTERM into a stop
  request. The request ends the wait at once; during an iteration it is seen when the
  iteration ends. The loop then writes `loop stopped: received <signal>` to
  `loop.notices` and releases the lock. A second identical signal kills the process.
- `loopIsAlive` tells whether a live process holds the loop lock, without writing.
- `--notices` (`src/loop/wait-notices.ts`) is the model for a mode that reads only the
  loop's files: no configuration, no lock, an injected `wait` and `now` for tests.
- The plugin's functions are held to a cyclomatic complexity of 9 by the fallow audit.

## Goals / Non-Goals

**Goals:**

- Stop the loop with one command from any session or shell.
- Reuse the stop the loop already implements; add no second way for a loop to end.
- Tell the person whether the loop has ended or is still finishing an iteration.

**Non-Goals:**

- No change to the loop's process, its files or its notices.
- No forced stop, and no change to sessions or attempts.

## Decisions

### D1. The stop is one SIGTERM to the pid in `loop.lock`

The mode reads the lock's owner and sends it SIGTERM. The loop needs no change: it
already stops cleanly on that signal and names it in its stop notice.

Alternative: a stop file that the loop checks. Rejected: it needs a change in the loop,
a new file in the state directory, and it would not end the wait at once unless the
loop polled for it.

Alternative: SIGINT. Rejected: both behave the same; SIGTERM is the usual signal for a
request from another process, and the stop notice then says so.

### D2. Only one signal is ever sent

A second identical signal kills the loop's process and can cut a launch. The mode sends
one and never repeats it, whatever the wait shows. A person who runs the command twice
during a long iteration does send a second signal; see Risks.

### D3. A separate command and a separate flag

`/autonomous:loop-stop` is its own command file, backed by `--stop-loop`. The
alternative, `/autonomous:loop --stop`, was rejected: `commands/loop.md` already has two
long branches with strict rules, and a third would sit next to the one that starts a
loop.

The flag is named `--stop-loop`, a verb and its object, like `--bootstrap-labels`.

### D4. No `--apply`

Everywhere else `--apply` lets a step write, and without it the run is dry. A stop has
no useful dry form, and the person has already said what they want by naming the mode.
`--notices` sets the precedent of a loop mode that combines with nothing.

### D5. A bounded wait of 10 seconds, polled

After the signal the mode polls `loopIsAlive` until it is false or 10 seconds have
passed. The loop is asleep between iterations most of the time, so the usual answer is
`loop stopped` within one poll. An iteration can last minutes, so the mode does not
wait for it: it says the loop is stopping and returns. The wait is a constant, like the
grace period of `--notices`; no flag or configuration sets it.

The poll interval is shorter than the 2 seconds of `--notices`, 250 ms, so the usual
case answers quickly.

### D6. The lock is read once, and each case has one outcome

| What the mode finds                            | Outcome                                   |
| ---------------------------------------------- | ----------------------------------------- |
| No lock file                                   | `loop stopped: not running`, exit 2       |
| Owner whose process is gone                    | `loop stopped: not running`, exit 2       |
| The process disappears before the signal       | `loop stopped: not running`, exit 2       |
| Owner alive, signal sent                       | the wait of D5, exit 0                    |
| Owner alive, signal refused (no permission)    | error on standard error, exit 1           |
| Lock with no readable owner                    | error on standard error, exit 1           |

A lock with no readable owner is a loop that is still writing its lock, or a damaged
file. The mode cannot know which pid to signal, so it says so and the person runs the
command again.

A stale lock is left in place. Removing it is the job of the next loop, which already
does it under the rules of `acquireLockAt`.

### D7. Where the code goes

- `src/attempts/lock.ts` exports a read of the loop lock's owner, next to
  `loopIsAlive`, so the lock's file name and format stay in one module.
- `src/loop/stop.ts` holds the mode. Like `waitForNotices` it takes an io object:
  `state`, `now`, `wait`, `stdout`, `stderr`, and a `signal(pid)` function that tests
  replace. The real `signal` is `process.kill(pid, "SIGTERM")`.
- `src/run.ts` dispatches `args.stopLoop` before the loop and after `--notices`.
- `src/args.ts` gains the flag, the rule "`--stop-loop` cannot be combined with other
  flags" and one usage line.

The outcomes of D6 are small functions, one per case, to stay inside the complexity
budget.

### D8. The command file relays and does nothing else

`commands/loop-stop.md` has no `argument-hint`, allows only `Bash(bun:*)`, runs the
script once in the foreground and shows stdout, stderr and the exit code in a code
block. It is the pattern of the branch without `--apply` in `commands/loop.md`.

## Risks / Trade-offs

- [The pid in a stale lock was reused by another process] → The mode would send SIGTERM
  to a process that is not the loop. The lock has always judged liveness by pid alone,
  so the same assumption already decides whether a loop may start. The window is a loop
  killed without releasing its lock, and its pid reused by a process of the same user.
  Accepted; not mitigated in this change.
- [The command is run twice during a long iteration] → The second SIGTERM kills the
  loop and can cut a launch. The line `loop stopping: the iteration in progress ends
  first` tells the person that nothing more is needed, and the README says not to
  repeat the command.
- [`loop stopping` gives no later confirmation] → The stop notice in `loop.notices`
  is the confirmation, and an agent that waits for notices shows it. A second
  `/autonomous:loop-stop` is not the way to check.
- [Open attempts are not reconciled after the stop] → They stay open and keep their
  slots until the next `/autonomous:run` or loop. This is the agreed behaviour; the
  README states it.
