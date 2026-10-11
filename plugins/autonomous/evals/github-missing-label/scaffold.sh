#!/bin/sh
set -eu
# A stand-in gh on PATH: the repository has only GitHub's default labels, and,
# like gh, a create names one missing label per failure.
mkdir -p "$HOME/bin"
cat > "$HOME/bin/gh" <<'STUB'
#!/bin/sh
known="bug documentation duplicate enhancement help-wanted invalid question wontfix"
case "$*" in
    *--help*)
        echo "Usage: gh issue create [flags]"
        echo "  -b, --body string    Supply a body"
        echo "  -l, --label name     Add labels by name"
        echo "  -R, --repo string    Select another repository"
        echo "  -t, --title string   Supply a title"
        exit 0
        ;;
esac
case "${1:-} ${2:-}" in
    "auth status") echo "github.com: Logged in to github.com account eval-user"; exit 0 ;;
    "repo view") echo "pabloimrik17/daily-agentic-task-force"; exit 0 ;;
    "label list") for label in $known; do echo "$label"; done; exit 0 ;;
    "label create") echo "Label \"${3:-}\" created"; exit 0 ;;
    "issue view") echo "Tidy my dotfiles #101"; exit 0 ;;
    "issue create") ;;
    *) echo "gh: not available in this sandbox: $*" >&2; exit 1 ;;
esac
shift 2
labels=""
while [ $# -gt 0 ]; do
    case "$1" in
        --label | -l) labels="$labels,${2:-}"; shift 2 ;;
        --label=*) labels="$labels,${1#--label=}"; shift ;;
        *) shift ;;
    esac
done
for label in $(echo "$labels" | tr ',' ' '); do
    case " $known " in
        *" $label "*) ;;
        *) echo "could not add label: '$label' not found" >&2; exit 1 ;;
    esac
done
echo "https://github.com/pabloimrik17/daily-agentic-task-force/issues/101"
STUB
chmod +x "$HOME/bin/gh"
for rc in .zshenv .zshrc .bashrc .bash_profile .profile; do
    printf 'export PATH="$HOME/bin:$PATH"\n' >> "$HOME/$rc"
done
mkdir -p "$HOME/.config/autonomous"
cat > "$HOME/.config/autonomous/config.json" <<'CONFIG'
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
CONFIG
