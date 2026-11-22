#!/bin/sh
set -eu
# On macOS, /usr/bin/git is an xcrun shim that cannot write its cache inside the
# eval sandbox, so every git call fails and the session spends its turns on it.
# Put the git binary the shim dispatches to ahead of it on PATH. The agent's
# shell finds `git` through the shim even with PATH set, so a `git` function
# in the start-up files calls the binary directly. Elsewhere, git is left as
# it is.
real=$(xcrun --find git 2>/dev/null) || exit 0
mkdir -p "$HOME/bin"
ln -s "$real" "$HOME/bin/git"
for file in .zshenv .zshrc .zprofile .bashrc .bash_profile .profile; do
    printf 'export PATH="$HOME/bin:$PATH"\ngit() { "$HOME/bin/git" "$@"; }\n' > "$HOME/$file"
done
