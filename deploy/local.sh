#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Home Planner — run it on your own Mac (or Linux computer)
#
#  One command in Terminal:
#    curl -fsSL https://raw.githubusercontent.com/CrazyMan28/keely-home-shit/main/deploy/local.sh | bash
#
#  • No admin password, no Homebrew, nothing installed system-wide.
#  • Everything lives in ~/HomePlanner (delete that folder to remove it).
#  • When it's ready it prints  http://localhost:8787  and opens it in the browser.
#  • Later, double-click ~/HomePlanner/Start Home Planner.command to start it again.
#  • Run the same command again any time to update.
#
#  Options: BRANCH=main  PORT=8787  INSTALL_DIR=~/HomePlanner  NO_OPEN=1  NO_START=1
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="${REPO:-CrazyMan28/keely-home-shit}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-8787}"
DIR="${INSTALL_DIR:-$HOME/HomePlanner}"
NODE_VERSION="${NODE_VERSION:-22.12.0}"

step() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die() {
  printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin) OS="darwin" ;;
  Linux) OS="linux" ;;
  *) die "This script is for macOS or Linux." ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) ARCH="arm64" ;;
  x86_64 | amd64) ARCH="x64" ;;
  *) die "Unsupported processor: $(uname -m)" ;;
esac
command -v curl >/dev/null || die "curl is required."
command -v tar >/dev/null || die "tar is required."

printf '\033[1mHome Planner — local install into %s\033[0m\n' "$DIR"
mkdir -p "$DIR"

# ── Node.js (private copy inside the folder) ────────────────────────────────
step "Node.js"
NODE_HOME="$DIR/node"
if [ ! -x "$NODE_HOME/bin/node" ] || [ "$("$NODE_HOME/bin/node" -v)" != "v$NODE_VERSION" ]; then
  tmp="$(mktemp -d)"
  ext="tar.gz"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${OS}-${ARCH}.${ext}" -o "$tmp/node.$ext" ||
    die "Couldn't download Node.js. Check the internet connection and try again."
  rm -rf "$NODE_HOME" && mkdir -p "$NODE_HOME"
  tar -xzf "$tmp/node.$ext" -C "$NODE_HOME" --strip-components=1
  rm -rf "$tmp"
fi
export PATH="$NODE_HOME/bin:$PATH"
ok "node $(node -v)"

# ── App source ───────────────────────────────────────────────────────────────
step "Downloading the app"
SRC="$DIR/app"
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; fi
rm -rf "$SRC.new" && mkdir -p "$SRC.new"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../package.json" ]; then
  # Run from a checkout: use it as-is.
  tar -C "$SCRIPT_DIR/.." --exclude=node_modules --exclude=dist --exclude=.git -cf - . | tar -C "$SRC.new" -xf -
  ok "using the local copy in $(cd "$SCRIPT_DIR/.." && pwd)"
else
  curl -fsSL "https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}" | tar -xz -C "$SRC.new" --strip-components=1 ||
    die "Couldn't download ${REPO} (${BRANCH})."
  ok "downloaded ${REPO}@${BRANCH}"
fi
# Keep installed dependencies between updates to make re-runs fast.
[ -d "$SRC/node_modules" ] && mv "$SRC/node_modules" "$SRC.new/node_modules"
rm -rf "$SRC" && mv "$SRC.new" "$SRC"

# ── Build ────────────────────────────────────────────────────────────────────
step "Building (about a minute the first time)"
cd "$SRC"
npm ci --no-audit --no-fund --loglevel=error >/dev/null
npm run build --silent >/dev/null
ok "built"

# ── Launcher you can double-click later ─────────────────────────────────────
LAUNCHER="$DIR/Start Home Planner.command"
cat >"$LAUNCHER" <<EOF
#!/bin/bash
# Double-click to start Home Planner, then use it at http://localhost:${PORT}
cd "$SRC" && AUTO_PORT=1 OPEN=1 PORT=${PORT} SITE_DIR="$SRC/dist" exec "$NODE_HOME/bin/node" "$SRC/deploy/serve.mjs"
EOF
chmod +x "$LAUNCHER"
ok "launcher: $LAUNCHER"

cat <<EOF

  ✅ Installed.  Home Planner runs at:  http://localhost:${PORT}

  • To start it again later: double-click "Start Home Planner.command" in ${DIR}
    (or run: "${LAUNCHER}")
  • Always use the same address (http://localhost:${PORT}): your projects are saved
    in the browser for that address.
  • Back up or move a project with Export → Project file.
EOF

[ -n "${NO_START:-}" ] && exit 0
step "Starting"
open_flag=1
[ -n "${NO_OPEN:-}" ] && open_flag=0
cd "$SRC"
AUTO_PORT=1 OPEN=$open_flag PORT="$PORT" SITE_DIR="$SRC/dist" exec node "$SRC/deploy/serve.mjs"
