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
  }
}
EOF

# A stand-in for `openusage claude`: one Claude account with plenty of capacity,
# so the quota gate advances and the run reaches label-triage.
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
        schema: "openusage.limits.v1",
        generatedAt: iso(0),
        providers: {
            claude: {
                displayName: "Claude: Eval",
                plan: "Pro",
                fetchedAt: iso(-60),
                expiresAt: iso(240),
                stale: false,
                resources: {
                    session: window(5, 7200, 18000),
                    weekly: window(5, 259200, 604800),
                },
            },
        },
        errors: [],
    }),
);
EOF
chmod +x "$HOME/bin/openusage"

# The eval agent's Bash tool starts from the shell profile of $HOME; put the
# stand-in ahead of the real `openusage` on PATH.
for file in .zshenv .zshrc .zprofile .bashrc .bash_profile .profile; do
    printf 'export PATH="$HOME/bin:$PATH"\n' > "$HOME/$file"
done
