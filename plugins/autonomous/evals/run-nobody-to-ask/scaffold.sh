#!/bin/sh
set -eu
bd init --non-interactive --skip-agents --skip-hooks --quiet --prefix eval
bd create "Add a retry when the Nazaries sync job times out" -t task -l nazaries,AFK >/dev/null

mkdir -p "$HOME/.config/autonomous" "$HOME/bin"
cat > "$HOME/.config/autonomous/config.json" <<EOF
{
  "schema": "autonomous.config.v1",
  "sources": {
    "linear": { "enabled": false, "scope": "personal" },
    "beads": { "enabled": true, "directory": "$PWD", "scope": "personal", "aliases": { "work": ["nazaries"] } },
    "github": { "enabled": false, "repos": [] }
  },
  "judgement": {
    "model": "claude-sonnet-5",
    "effort": "medium",
    "threshold": 0.95,
    "cap": 25,
    "batch": 20
  },
  "selection": {
    "model": "sonnet",
    "effort": "high"
  }
}
EOF

# A stand-in for `openusage claude` (OpenUsage 0.8, `openusage.limits.v2`): one
# Claude account, `claude@1a2b3c4d`, with plenty of capacity, so the quota gate
# advances and the run reaches label-triage. The gate matches the active account
# by email address, and OpenUsage has no email field, so the display name ends
# with the address, as OpenUsage writes it (`Claude · <email>`); the stand-in
# `claude` below reports the same address as the login.
cat > "$HOME/bin/openusage" <<'EOF'
#!/usr/bin/env bun
const now = Date.now();
const iso = (seconds) => new Date(now + seconds * 1000).toISOString();
const window = (used, elapsed, size) => ({
    kind: "consumption",
    unit: "percent",
    used,
    limit: 100,
    remaining: 100 - used,
    utilization: used / 100,
    resetsAt: iso(size - elapsed),
    windowSeconds: size,
});
console.log(
    JSON.stringify({
        schema: "openusage.limits.v2",
        generatedAt: iso(0),
        providers: {
            "claude@1a2b3c4d": {
                displayName: "Claude · eval@example.com",
                plan: "Pro",
                fetchedAt: iso(-60),
                expiresAt: iso(540),
                stale: false,
                resources: {
                    session: window(5, 7200, 18000),
                    weekly: window(5, 259200, 604800),
                },
            },
        },
    }),
);
EOF
chmod +x "$HOME/bin/openusage"

# A stand-in for `claude` that answers `claude auth status` (the quota gate reads
# the active account from it) and nothing else. Every other call, such as the
# `claude -p` judgement calls of the run, goes unchanged to the real `claude`:
# the first `claude` on PATH outside this directory, so the stand-in cannot call
# itself. It is `sh`, not `bun`: a pass-through pays no runtime start-up, and
# `exec` hands the real `claude` this process, its arguments and its stdio.
cat > "$HOME/bin/claude" <<'EOF'
#!/bin/sh
if [ "$#" -eq 2 ] && [ "$1" = auth ] && [ "$2" = status ]; then
    cat <<JSON
{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "projectsDirectory": "$HOME/.claude/projects",
  "configDirectory": "$HOME/.claude",
  "loginExpiresAt": "2099-01-01T00:00:00.000Z",
  "consoleProfileSignInOffered": true,
  "email": "eval@example.com",
  "subscriptionType": "pro",
  "storedClaudeAiLogin": true,
  "planTier": "pro"
}
JSON
    exit 0
fi
here=$(cd "$(dirname "$0")" && pwd -P)
set -f
IFS=:
for dir in $PATH; do
    [ -n "$dir" ] || continue
    resolved=$(cd "$dir" 2>/dev/null && pwd -P) || continue
    [ "$resolved" = "$here" ] && continue
    if [ -f "$resolved/claude" ] && [ -x "$resolved/claude" ]; then
        unset IFS
        exec "$resolved/claude" "$@"
    fi
done
echo "claude (eval stand-in): no real claude on PATH outside $here" >&2
exit 127
EOF
chmod +x "$HOME/bin/claude"

# A stand-in for `chezmoi data`: a personal machine, so the select step reads
# the trackers instead of stopping as not-evaluable.
cat > "$HOME/bin/chezmoi" <<'EOF'
#!/bin/sh
echo '{"machineType":"personal"}'
EOF
chmod +x "$HOME/bin/chezmoi"

# The eval agent's Bash tool starts from the shell profile of $HOME; put the
# stand-ins ahead of the real `openusage`, `claude` and `chezmoi` on PATH.
for file in .zshenv .zshrc .zprofile .bashrc .bash_profile .profile; do
    printf 'export PATH="$HOME/bin:$PATH"\n' > "$HOME/$file"
done
