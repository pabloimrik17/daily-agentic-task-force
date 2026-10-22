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

shas=
while read -r _local_ref local_sha _remote_ref _remote_sha; do
    # Deleting a remote ref pushes no commits.
    if [ -n "$local_sha" ] && [ "$local_sha" != "$zeros" ]; then
        shas="${shas:+$shas }$local_sha"
    fi
done <<EOF_REFS
$refs
EOF_REFS
[ -n "$shas" ] || exit 0

# The pushed commits no remote-tracking ref of this remote has, new and updated branches alike.
mise x -- gitleaks git --redact -v --no-banner --log-opts="--diff-merges=first-parent $shas --not --remotes=$remote"

# osv-scanner reads the lockfiles of the pushed commits, not the working tree: extract each
# one (and the osv-scanner.toml files beside them) from every pushed sha, one -L per file.
set -- scan source
lockfiles=0
for sha in $(printf '%s' "$shas" | tr ' ' '\n' | sort -u); do
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
    mise x -- osv-scanner "$@"
fi

# Repo-specific checks: sibling repos swap these three for their own.
# They test the working tree, the usual pre-push trade-off; CI runs them on the pushed commit.
bun run lint:knip
bun run typecheck
bun run test
