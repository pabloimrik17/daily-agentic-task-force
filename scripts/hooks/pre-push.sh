#!/bin/sh
# Pre-push gate: secrets in the pushed commits, vulnerable lockfiles, then the repo checks.
# $1 is the remote name or URL; stdin has one line per ref:
#   <local ref> <local sha> <remote ref> <remote sha>
set -eu

remote=$1
zeros=0000000000000000000000000000000000000000

# Read every ref before running anything that could consume stdin.
refs=$(cat)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' INT TERM

ranges=
shas=
while read -r _local_ref local_sha _remote_ref remote_sha; do
    [ -n "$local_sha" ] || continue
    # Deleting a remote ref pushes no commits.
    [ "$local_sha" != "$zeros" ] || continue
    shas="$shas$local_sha
"
    if [ "$remote_sha" = "$zeros" ] || ! git cat-file -e "${remote_sha}^{commit}" 2>/dev/null; then
        # New branch, or the remote tip is unknown here: scan what no ref of the remote has.
        range="$local_sha --not --remotes=$remote"
    else
        range="$remote_sha..$local_sha"
    fi
    ranges="$ranges$range
"
done <<EOF_REFS
$refs
EOF_REFS

# Every ref was a deletion (or nothing was pushed).
[ -n "$ranges" ] || exit 0

while IFS= read -r range; do
    [ -n "$range" ] || continue
    # </dev/null: the loop's stdin holds the remaining ranges.
    sh scripts/hooks/mise-tool.sh gitleaks git --redact -v --no-banner --log-opts="--diff-merges=first-parent $range" </dev/null
done <<EOF_RANGES
$ranges
EOF_RANGES

# osv-scanner reads the lockfiles of the pushed commits, not the working tree: extract each
# one (and the osv-scanner.toml files beside them) from every pushed sha, one -L per file.
set -- scan source
lockfiles=0
for sha in $(printf '%s' "$shas" | sort -u); do
    paths=$(git ls-tree -r --name-only "$sha")
    while IFS= read -r path; do
        case ${path##*/} in
            bun.lock | package-lock.json | npm-shrinkwrap.json | pnpm-lock.yaml | yarn.lock | deno.lock | osv-scanner.toml)
                mkdir -p "$tmp/$sha/$(dirname "$path")"
                git show "$sha:$path" >"$tmp/$sha/$path"
                if [ "${path##*/}" != osv-scanner.toml ]; then
                    set -- "$@" -L "$tmp/$sha/$path"
                    lockfiles=$((lockfiles + 1))
                fi
                ;;
        esac
    done <<EOF_PATHS
$paths
EOF_PATHS
done
if [ "$lockfiles" -gt 0 ]; then
    sh scripts/hooks/mise-tool.sh osv-scanner "$@"
fi

# Repo-specific checks: sibling repos swap these three for their own.
# They test the working tree, the usual pre-push trade-off; CI runs them on the pushed commit.
bun run lint:knip
bun run typecheck
bun run test
