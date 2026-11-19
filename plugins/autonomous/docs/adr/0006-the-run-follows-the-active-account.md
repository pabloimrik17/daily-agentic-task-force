# The run follows the active account

The quota gate evaluates the active account: the one Claude Code is logged in
as when the gate runs. The run never chooses a Claude account, never changes
the active one, and never uses another. The user cannot name an account for a
run: there is no `--account` flag. When the active account's quota is
exhausted, the run waits, even if another account has capacity.

Choosing the account belongs to whatever switches the login outside the run.
The run reads the result of that choice from Claude Code itself, so it needs
no account switcher to know which account is active.

## Considered Options

- **Choose the best account in the run.** Rejected: the quota source reports
  every account, so the run could rank them, but that would duplicate a policy
  that already exists outside the run, and the two could disagree.
- **Also evaluate the account the login would switch to next.** Rejected: the
  run cannot use that account without changing the login, which is the choice
  it leaves to others. The quota gate stops only at an exhausted window, and a
  switch normally happens well before that, so the case is rare. It is not
  impossible: whatever switches the login can act late, for example when it
  cannot refresh its own usage data. The run then waits until the login
  changes or the window resets, and its report names the accounts that have
  capacity.
- **Ask the account switcher which account is active.** Rejected: it would
  make a switcher a requirement for every run, including on a machine with one
  account.
- **Keep `--account` to choose which account's quota is evaluated.** Rejected:
  the sessions run on the active account whatever the flag says, so the gate
  would check one account and the work would spend another.
- **Make `--account` keep the launched sessions on the named account.**
  Rejected for now. The only way found was `cswap run`, which starts Claude
  Code with a separate configuration directory for each account. In November
  2026 (cswap 0.29) that directory shares the settings, skills, commands and
  rules of the user, but not the installed plugins and not the folders the
  user has trusted. A session there stops at the trust question and has none
  of the plugins the stages need. Copying that state for every launch would
  make the run maintain a replica of how Claude Code stores its configuration.
- **Make `--account` switch the login of the machine.** Rejected: it changes
  the account of every session on the machine, and the switcher moves the
  login back under its own policy.

## Consequences

- With several accounts, the run no longer asks the user to name one.
- A user who wants a run on a given account switches the login first.
- The active account can change between the quota gate and the launch. The
  run does not check again: the gate stops only at an exhausted window, and a
  login is not moved to an exhausted account.
- A late switch costs time, never a wrong launch: the run waits on an
  exhausted active account even when another account has capacity.
- A launched session moves with the login. It can end on a different account
  from the one the gate evaluated.
- The loop reads the active account again in every iteration.
- The decision to have no named account is open to review. It can return when
  a session can be kept on an account with the user's plugins and trusted
  folders: through a later cswap release, or through another tool for several
  accounts. It would enter behind its own contract, as the quota source does,
  so that the run does not depend on the tool that provides it.
