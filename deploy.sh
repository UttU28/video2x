#!/usr/bin/env bash
#
# Video2X Studio — deploy engine + FastAPI (PM2) + React UI + nginx + Let's Encrypt
# (video.thatinsaneguy.com)
#
# Usage (from this directory):
#   ./deploy.sh                # engine build, venv, UI build, pm2 (no nginx unless root)
#   sudo ./deploy.sh           # full: + nginx vhost + certbot
#   sudo ./deploy.sh --build   # force rebuild of engine + UI
#
# Optional env:
#   VIDEO2X_API_PORT=9281        # must match nginx upstream in nginxVideo.conf
#   DOMAIN=video.thatinsaneguy.com
#   CERTBOT_EMAIL=you@example.com
#   SKIP_SSL=1                   # HTTP nginx only
#   SKIP_NGINX=1                 # app only (engine + venv + UI + pm2)
#   DEPLOY_USER=dedsec995        # user that owns PM2 / venv / node_modules (default: $SUDO_USER)
#
# One-time Arch prerequisites for the engine build:
#   sudo pacman -S --needed vulkan-headers boost cmake ninja ffmpeg
#
set -euo pipefail

appRoot="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../dktp/deployLib.sh
source "${appRoot}/../dktp/deployLib.sh"
backendDir="${appRoot}/backend"
frontendDir="${appRoot}/frontend"
nginxTemplate="${appRoot}/nginxVideo.conf"

domain="${DOMAIN:-video.thatinsaneguy.com}"
apiPort="${VIDEO2X_API_PORT:-9281}"
deployUser="${DEPLOY_USER:-${SUDO_USER:-$USER}}"
forceBuild=0
for arg in "$@"; do [[ "$arg" == "--build" ]] && forceBuild=1; done
if [[ "$forceBuild" -eq 1 ]]; then export DEPLOY_FORCE_BUILD=1; fi

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

step()   { echo -e "${BLUE}[video2x]${NC} $*"; }
info()   { echo -e "${GREEN}[video2x]${NC} $*"; }
warn()   { echo -e "${YELLOW}[video2x]${NC} $*" >&2; }
err()    { echo -e "${RED}[video2x]${NC} $*" >&2; }
banner() {
  echo ""
  echo -e "${CYAN}================================================================================${NC}"
  echo -e "${CYAN} $*${NC}"
  echo -e "${CYAN}================================================================================${NC}"
  echo ""
}

isRoot() { [[ "${EUID:-$(id -u)}" -eq 0 ]]; }

# PM2, venv, node_modules and the engine build stay owned by the normal user.
runAsDeployUser() {
  if isRoot && [[ "$deployUser" != "root" ]]; then
    sudo -u "$deployUser" -H bash -lc "$*"
  else
    bash -lc "$*"
  fi
}

# --- App part: engine, venv, UI, PM2 (always as the deploy user) ---------------------
appSteps() {
  banner "Engine (C++ / Vulkan)"
  local forceFlag=""
  [[ "${DEPLOY_FORCE_BUILD:-0}" == "1" ]] && forceFlag="--force"
  bash "${backendDir}/buildEngine.sh" ${forceFlag}

  banner "Python venv & dependencies"
  cd "${backendDir}"
  if ! venv/bin/python -c "import sys" >/dev/null 2>&1 \
     || ! grep -q "${backendDir}/venv" venv/bin/activate 2>/dev/null; then
    step "Creating venv…"
    rm -rf venv
    python3 -m venv venv
  fi
  venv/bin/python -m pip install -q --upgrade pip
  venv/bin/python -m pip install -q -r requirements.txt
  mkdir -p storage

  banner "Frontend build (change-aware)"
  npmBuildIfChanged video2x-ui "${frontendDir}" "${frontendDir}/dist/index.html"

  banner "PM2 (uvicorn :${apiPort})"
  if ! command -v pm2 &>/dev/null; then
    err "PM2 is not installed. Install: npm install -g pm2"
    return 1
  fi
  pm2 delete video2x >/dev/null 2>&1 || true
  for pid in $(lsof -t -i ":${apiPort}" -sTCP:LISTEN 2>/dev/null || true); do kill "$pid" 2>/dev/null || true; done
  VIDEO2X_API_PORT="${apiPort}" pm2 start "${backendDir}/ecosystem.config.cjs"
  pm2 save >/dev/null 2>&1 || true
}

startTs=$(date +%s)

if [[ "${VIDEO2X_APP_ONLY:-0}" == "1" ]]; then
  appSteps
  exit 0
fi

banner "Video2X Studio deploy (${domain})"
# Separate process (errexit stays active; under sudo it runs as the deploy user).
step "Engine / venv / UI / PM2 as ${deployUser}"
appOk=1
runAsDeployUser "cd '${appRoot}' && VIDEO2X_APP_ONLY=1 DEPLOY_FORCE_BUILD='${DEPLOY_FORCE_BUILD:-0}' VIDEO2X_API_PORT='${apiPort}' bash ./deploy.sh" || appOk=0
if [[ "$appOk" -ne 1 ]]; then
  err "App deploy failed (see above)."
  if [[ ! -f /usr/include/vulkan/vulkan.h || ! -f /usr/include/boost/program_options.hpp ]]; then
    err "Engine build prerequisites missing — run: sudo pacman -S --needed vulkan-headers boost"
  fi
  exit 1
fi

step "Waiting for API…"
httpCode=000
for _ in $(seq 1 20); do
  httpCode="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${apiPort}/api/health" 2>/dev/null || echo 000)"
  [[ "$httpCode" == "200" ]] && break
  sleep 1
done
if [[ "$httpCode" == "200" ]]; then
  info "Health check OK: http://127.0.0.1:${apiPort}/api/health"
else
  warn "Health check failed (HTTP ${httpCode}) — check: pm2 logs video2x"
fi

if [[ "${SKIP_NGINX:-0}" == "1" ]]; then
  banner "Deploy summary ($(( $(date +%s) - startTs ))s)"
  info "Done (SKIP_NGINX=1) — API: http://127.0.0.1:${apiPort}/api/health"
  exit 0
fi

# --- Nginx + TLS (root) -------------------------------------------------------------
banner "Nginx + TLS (${domain})"
if ! isRoot; then
  warn "Not root — skipping nginx/certbot. For the public site run:"
  echo "  sudo bash ${appRoot}/deploy.sh"
  exit 0
fi
if ! command -v nginx &>/dev/null; then
  err "nginx not installed (pacman -S nginx)"
  exit 1
fi

ensure_nginx_debian_layout
confTmp="$(mktemp)"
trap 'rm -f "$confTmp"' EXIT
sed -e "s#127.0.0.1:9281#127.0.0.1:${apiPort}#g" \
    -e "s#root /home/dedsec995/Desktop/video2x/frontend/dist;#root ${frontendDir}/dist;#" \
    -e "s#server_name video.thatinsaneguy.com;#server_name ${domain};#" \
    "$nginxTemplate" > "$confTmp"

siteConf="/etc/nginx/sites-available/${domain}"
# certbot adds the 443 block to the live file; keep it if our template is unchanged.
if le_nginx_has_ssl "$domain" && [[ -f "${siteConf}.template" ]] && cmp -s "$confTmp" "${siteConf}.template"; then
  info "nginx vhost unchanged (HTTPS already configured)"
else
  cp "$confTmp" "$siteConf"
  cp "$confTmp" "${siteConf}.template"
  chmod 644 "$siteConf" "${siteConf}.template"
  ln -sf "$siteConf" "/etc/nginx/sites-enabled/${domain}"
  info "Installed vhost: ${siteConf}"
fi

# nginx (user http) must be able to traverse into ~/Desktop/video2x/frontend/dist.
if ! sudo -u http test -r "${frontendDir}/dist/index.html" 2>/dev/null; then
  warn "nginx user cannot read ${frontendDir}/dist — granting traverse permission"
  chmod o+x "$(dirname "$(dirname "$appRoot")")" "$(dirname "$appRoot")" "$appRoot" "$frontendDir" 2>/dev/null || true
  chmod -R o+rX "${frontendDir}/dist"
fi

step "Testing nginx configuration…"
if nginx -t 2>/dev/null; then
  systemctl reload nginx 2>/dev/null || true
  info "nginx reloaded"
else
  nginx -t || true
  err "nginx -t failed"
  exit 1
fi

if [[ "${SKIP_SSL:-0}" == "1" ]]; then
  warn "SKIP_SSL=1 — HTTP only: http://${domain}/"
  exit 0
fi

if le_cert_exists "$domain"; then
  if le_nginx_has_ssl "$domain"; then
    info "Certificate exists for ${domain} — HTTPS vhost OK."
  else
    step "Applying existing certificate to nginx (${domain})…"
    le_install_nginx_ssl "$domain" || warn "Could not apply SSL — run: sudo certbot install --cert-name ${domain}"
  fi
else
  banner "Let's Encrypt (certbot)"
  if ! command -v certbot &>/dev/null; then
    err "certbot not installed (pacman -S certbot certbot-nginx)"
    exit 1
  fi
  certbotArgs=(--nginx -d "$domain" --agree-tos --non-interactive --redirect)
  if [[ -n "${CERTBOT_EMAIL:-}" ]]; then
    certbotArgs+=(--email "$CERTBOT_EMAIL")
  else
    certbotArgs+=(--register-unsafely-without-email)
  fi
  certbot "${certbotArgs[@]}" \
    || warn "certbot failed — make sure the DNS A record for ${domain} points here and port 80 is reachable"
fi
nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true

banner "Deploy summary ($(( $(date +%s) - startTs ))s)"
info "Deployment complete."
cat <<EOF

Live URLs:
  Video2X Studio:  https://${domain}/
  API health:      https://${domain}/api/health
  Local API:       http://127.0.0.1:${apiPort}/api/docs

Useful commands:
  pm2 status
  pm2 logs video2x
  pm2 restart video2x
  bash ${backendDir}/buildEngine.sh --force   # rebuild the C++ engine
EOF
