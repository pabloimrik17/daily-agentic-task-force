# Claude Code `auth status` evidence

Evidence for `evaluate-active-account`, design D1. Probes of the installed CLI on
2026-11-16, read-only. `claude --version` prints `2.1.325 (Claude Code)`.

The email address, the organization name and id are redacted. No probe logged
in, logged out or changed the machine's login.

## Logged in

Command: `claude auth status; echo "exit=$?"`.

- Exit code: 0.
- The JSON is on stdout. stderr is empty.

```json
{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "projectsDirectory": "<redacted>/.claude/projects",
  "configDirectory": "<redacted>/.claude",
  "loginExpiresAt": "2026-12-01T11:02:59.089Z",
  "consoleProfileSignInOffered": true,
  "email": "ana@example.com",
  "orgId": "<redacted>",
  "orgName": "<redacted>",
  "subscriptionType": "pro",
  "storedClaudeAiLogin": true,
  "planTier": "pro"
}
```

## No login

Command: `d=$(mktemp -d); CLAUDE_CONFIG_DIR="$d" claude auth status; echo "exit=$?"`.
The directory was empty and was removed afterwards. No logout was run.

- Exit code: 1.
- The JSON is on stdout. stderr is empty.
- The probe reported no login, so the macOS keychain did not leak a login into
  the empty config directory.

```json
{
  "loggedIn": false,
  "authMethod": "none",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "projectsDirectory": "<tmpdir>/projects",
  "configDirectory": "<tmpdir>",
  "loginExpiresAt": null,
  "consoleProfileSignInOffered": true
}
```

There is no `email`, `orgId`, `orgName`, `subscriptionType`,
`storedClaudeAiLogin` or `planTier` key.

## What the gate reads

Design D1 reads these, and the observation matches the design's table:

| Field or exit     | Logged in                  | No login                     |
| ----------------- | -------------------------- | ---------------------------- |
| exit code         | 0                          | 1                            |
| `loggedIn`        | `true` (boolean)           | `false` (boolean)            |
| `email`           | present, non-empty string  | absent                       |
| JSON on           | stdout                     | stdout                       |

- The gate must read stdout on exit 1 as well as on exit 0. The CLI still
  prints the JSON on exit 1.
- Every other field is ignored, as the design says.
- `CLAUDE_CONFIG_DIR` changes the answer: the empty directory gave no login
  where the default directory gave one.
