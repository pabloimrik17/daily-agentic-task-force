#!/bin/sh
set -eu
mkdir -p "$HOME/.config/autonomous"
cat > "$HOME/.config/autonomous/config.json" <<'EOF'
{
  "schema": "autonomous.config.v1",
  "sources": {
    "linear": { "enabled": true, "scope": "personal" },
    "beads": { "enabled": true, "directory": "/tmp" },
    "github": { "enabled": true, "repos": [] }
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
