#!/bin/sh
# Runs a mise-managed tool for the git hooks: sh scripts/hooks/mise-tool.sh <bin> [args...]
# Refuses to auto-install (a commit must not hit the network) and refuses to fall back to a
# same-named binary on PATH (`mise x` does that when auto-install is off), so every
# contributor runs the version pinned in mise.toml or gets an install hint.

bin=$1
if [ -z "$bin" ]; then
    echo "usage: mise-tool.sh <bin> [args...]" >&2
    exit 2
fi
shift

if ! command -v mise >/dev/null 2>&1; then
    echo "mise is not installed: run brew install mise && mise install" >&2
    exit 1
fi

# Also fails while mise.toml is untrusted, as in every new worktree; mise install trusts it.
if ! mise which "$bin" >/dev/null 2>&1; then
    echo "$bin is not installed: run mise trust && mise install" >&2
    exit 1
fi

MISE_EXEC_AUTO_INSTALL=false exec mise x -- "$bin" "$@"
