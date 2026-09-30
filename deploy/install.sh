#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Home Planner — one-command server install with Tailscale
#
#  Installs (or updates) the app on a Linux server and publishes it over HTTPS
#  with Tailscale, so it opens on iPhone / iPad / Mac in Safari.
#
#  One command (public repo):
#    curl -fsSL https://raw.githubusercontent.com/CrazyMan28/keely-home-shit/main/deploy/install.sh | sudo bash
#
#  From a checkout (works for private repos too):
#    sudo bash deploy/install.sh
#
#  Options (environment variables):
#    MODE=public    Tailscale Funnel: a normal https:// link anyone you send it to can open,
#                   no Tailscale app needed on her devices.            (default)
#    MODE=private   Only devices on your tailnet (share the machine with her Tailscale account).
#    TS_AUTHKEY=…   Tailscale auth key for unattended login (otherwise a login link is printed).
#    BRANCH=main    Git branch to deploy.        REPO_URL=…  Git URL to deploy from.
#    PORT=8787      Local port for the app server (only reachable through Tailscale).
#
#  Re-run the same command any time to update to the latest version.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

MODE="${MODE:-public}"
BRANCH="${BRANCH:-main}"
REPO_URL="${REPO_URL:-https://github.com/CrazyMan28/keely-home-shit.git}"
PORT="${PORT:-8787}"
APP_NAME="home-planner"
APP_DIR="/opt/${APP_NAME}"
SRC_DIR="${APP_DIR}/src"
SITE_DIR="${APP_DIR}/site"
NODE_DIR="${APP_DIR}/node"
NODE_VERSION="${NODE_VERSION:-22.12.0}"
SERVICE_USER="homeplanner"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() {
  printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2
  exit 1
}

# ── Preflight ────────────────────────────────────────────────────────────────
[ "$(uname -s)" = "Linux" ] || die "This installer is for a Linux server. (On a Mac, run the app with 'npm run build && node deploy/serve.mjs' and use 'tailscale serve'.)"
[ "$(id -u)" -eq 0 ] || die "Please run with sudo:  sudo bash $0"
case "$MODE" in public | private) ;; *) die "MODE must be 'public' or 'private'" ;; esac
command -v systemctl >/dev/null 2>&1 || die "systemd is required (standard on Ubuntu, Debian, Fedora, Raspberry Pi OS)."

bold "Home Planner installer  ·  mode: ${MODE}  ·  branch: ${BRANCH}"

need_pkg() {
  local missing=()
  for c in "$@"; do command -v "$c" >/dev/null 2>&1 || missing+=("$c"); done
  [ ${#missing[@]} -eq 0 ] && return 0
  step "Installing ${missing[*]}"
  if command -v apt-get >/dev/null; then
    local pkgs=("${missing[@]/#xz/xz-utils}")
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${pkgs[@]}" ca-certificates >/dev/null
  elif command -v dnf >/dev/null; then
    dnf install -y -q "${missing[@]}"
  elif command -v yum >/dev/null; then
    yum install -y -q "${missing[@]}"
  elif command -v pacman >/dev/null; then
    pacman -Sy --noconfirm "${missing[@]}" >/dev/null
  elif command -v apk >/dev/null; then
    apk add --no-cache "${missing[@]}" >/dev/null
  else
    die "Please install: ${missing[*]}"
  fi
  ok "installed ${missing[*]}"
}
need_pkg curl git tar xz

# ── Node.js (private copy under /opt, doesn't touch the system) ─────────────
step "Node.js ${NODE_VERSION}"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64 | amd64) NODE_ARCH="x64" ;;
  aarch64 | arm64) NODE_ARCH="arm64" ;;
  armv7l) NODE_ARCH="armv7l" ;;
  *) die "Unsupported CPU architecture: $ARCH" ;;
esac
mkdir -p "$APP_DIR"
if [ ! -x "${NODE_DIR}/bin/node" ] || [ "$("${NODE_DIR}/bin/node" -v)" != "v${NODE_VERSION}" ]; then
  tmp="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -o "${tmp}/node.tar.xz"
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xJf "${tmp}/node.tar.xz" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmp"
fi
export PATH="${NODE_DIR}/bin:${PATH}"
ok "node $(node -v), npm $(npm -v)"

# ── Source code ──────────────────────────────────────────────────────────────
step "Getting the app"
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; fi
if [ -n "$SCRIPT_DIR" ] && [ -f "${SCRIPT_DIR}/../package.json" ] && [ "$(cd "${SCRIPT_DIR}/.." && pwd)" != "$SRC_DIR" ]; then
  # Running from a checkout: deploy exactly that checkout.
  LOCAL_SRC="$(cd "${SCRIPT_DIR}/.." && pwd)"
  mkdir -p "$SRC_DIR"
  tar -C "$LOCAL_SRC" --exclude=node_modules --exclude=dist --exclude=.git -cf - . | tar -C "$SRC_DIR" -xf -
  ok "copied from ${LOCAL_SRC}"
elif [ -d "${SRC_DIR}/.git" ]; then
  git -C "$SRC_DIR" fetch --quiet origin "$BRANCH"
  git -C "$SRC_DIR" checkout --quiet -B "$BRANCH" "origin/${BRANCH}"
  ok "updated to $(git -C "$SRC_DIR" rev-parse --short HEAD)"
else
  rm -rf "$SRC_DIR"
  git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$SRC_DIR" ||
    die "Couldn't clone ${REPO_URL} (${BRANCH}). If the repo is private, clone it yourself and run: sudo bash deploy/install.sh"
  ok "cloned $(git -C "$SRC_DIR" rev-parse --short HEAD)"
fi

# ── Build ────────────────────────────────────────────────────────────────────
step "Building (about a minute)"
cd "$SRC_DIR"
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent
rm -rf "${SITE_DIR}.new" && cp -r dist "${SITE_DIR}.new"
cp deploy/serve.mjs "${APP_DIR}/serve.mjs"
rm -rf "${SITE_DIR}.old"
[ -d "$SITE_DIR" ] && mv "$SITE_DIR" "${SITE_DIR}.old"
mv "${SITE_DIR}.new" "$SITE_DIR"
rm -rf "${SITE_DIR}.old"
ok "built into ${SITE_DIR}"

# ── App service (localhost only) ─────────────────────────────────────────────
step "App service"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
chown -R root:root "$APP_DIR" && chmod -R a+rX "$APP_DIR"
cat >/etc/systemd/system/${APP_NAME}.service <<EOF
[Unit]
Description=Home Planner (static app, proxied by Tailscale)
After=network.target

[Service]
User=${SERVICE_USER}
Environment=HOST=127.0.0.1 PORT=${PORT} SITE_DIR=${SITE_DIR}
ExecStart=${NODE_DIR}/bin/node ${APP_DIR}/serve.mjs
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --quiet ${APP_NAME}
systemctl restart ${APP_NAME}
for _ in $(seq 1 20); do curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1 && break || sleep 0.5; done
curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null || die "The app service didn't start. See: journalctl -u ${APP_NAME} -n 50"
ok "running on 127.0.0.1:${PORT}"

# ── Tailscale ────────────────────────────────────────────────────────────────
step "Tailscale"
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
systemctl enable --now tailscaled >/dev/null 2>&1 || true
if ! tailscale status >/dev/null 2>&1; then
  if [ -n "${TS_AUTHKEY:-}" ]; then
    tailscale up --authkey="$TS_AUTHKEY" --hostname="${TS_HOSTNAME:-home-planner}"
  else
    bold "  Log this server into Tailscale — open the link below on your phone or computer:"
    tailscale up --hostname="${TS_HOSTNAME:-home-planner}"
  fi
fi
ok "connected as $(tailscale status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log((j.Self&&j.Self.DNSName||"").replace(/\.$/,""))})')"

step "Publishing over HTTPS (${MODE})"
tailscale serve reset >/dev/null 2>&1 || true
tailscale funnel reset >/dev/null 2>&1 || true
publish_ok=1
if [ "$MODE" = "public" ]; then
  if ! tailscale funnel --bg "http://127.0.0.1:${PORT}"; then
    publish_ok=0
    warn "Funnel isn't enabled for this tailnet yet."
    warn "Open https://login.tailscale.com/admin/acls and allow Funnel + HTTPS for this machine"
    warn "(Tailscale usually prints a one-click link above), then re-run this installer."
  fi
else
  tailscale serve --bg "http://127.0.0.1:${PORT}" || publish_ok=0
fi

DNS="$(tailscale status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log((j.Self&&j.Self.DNSName||"").replace(/\.$/,""))})')"
URL="https://${DNS}"

# ── Done ─────────────────────────────────────────────────────────────────────
echo
if [ "$publish_ok" -eq 1 ]; then
  bold "✅ Home Planner is live:  ${URL}"
else
  bold "⚠️  App installed, but HTTPS publishing needs the step above. Then re-run."
fi
cat <<EOF

  For your sister's Apple devices
  ───────────────────────────────
  iPhone / iPad:  open the link in Safari → Share button → "Add to Home Screen".
  Mac:            open the link in Safari → File → "Add to Dock"  (or just bookmark it).

  Adding it to the Home Screen / Dock keeps her projects safe: Safari may clear data
  for websites that aren't used for a while, but not for installed web apps.
  Projects are saved on each device. To move one between iPhone and Mac, use
  Export → Project file, AirDrop it, then "Open a project file" on the other device.
EOF
if [ "$MODE" = "private" ]; then
  cat <<EOF

  Private mode: her devices need the Tailscale app (App Store) and access to this
  machine. Share it from https://login.tailscale.com/admin/machines → "${DNS%%.*}" → Share.
EOF
fi
cat <<EOF

  Update later:  re-run this same command.
  Logs:          journalctl -u ${APP_NAME} -f
  Stop sharing:  sudo tailscale funnel reset && sudo tailscale serve reset

EOF
