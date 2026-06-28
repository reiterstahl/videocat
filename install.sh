#!/usr/bin/env sh
set -eu

repo_raw_base="${VIDEOCAT_REPO_RAW_BASE:-https://raw.githubusercontent.com/reiterstahl/videocat/main}"
install_dir="${VIDEOCAT_INSTALL_DIR:-videocat}"
compose_file="docker-compose.hub.yml"

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi
  if [ -r /dev/urandom ]; then
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
    return
  fi
  echo "change-this-secret-$(date +%s)"
}

rand_pin() {
  if command -v shuf >/dev/null 2>&1; then
    shuf -i 1000-9999 -n 1
    return
  fi
  printf "%04d\n" "$((1000 + ($(date +%s) % 9000)))"
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker first, then run this script again." >&2
  exit 1
fi

mkdir -p "$install_dir"
cd "$install_dir"

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$repo_raw_base/$compose_file" -o "$compose_file"
elif command -v wget >/dev/null 2>&1; then
  wget -q "$repo_raw_base/$compose_file" -O "$compose_file"
else
  echo "curl or wget is required to download $compose_file." >&2
  exit 1
fi

if [ ! -f .env ]; then
  jwt_secret="$(rand_hex)"
  agent_token="$(rand_hex)"
  postgres_password="$(rand_hex)"
  admin_password="$(rand_hex)"
  protected_pin="$(rand_pin)"

  cat > .env <<EOF
POSTGRES_DB=videocat
POSTGRES_USER=videocat
POSTGRES_PASSWORD=$postgres_password
WEB_ORIGIN=http://localhost:8081
TRUST_PROXY=true
COOKIE_SECURE=false
WEB_BIND_ADDR=0.0.0.0
WEB_PUBLISHED_PORT=8081
SERVER_BIND_ADDR=127.0.0.1
SERVER_PUBLISHED_PORT=4001
JWT_SECRET=$jwt_secret
AGENT_TOKEN=$agent_token
PROTECTED_FOLDER_PIN=$protected_pin
PROTECTED_FOLDER_PATTERNS=Private,Protected
ADMIN_USER=admin
ADMIN_PASSWORD=$admin_password
VIDEOCAT_VERSION=0.1.0
EOF

  echo "Created .env with generated secrets."
  echo "Admin user: admin"
  echo "Admin password: $admin_password"
  echo "Protected folder PIN: $protected_pin"
  echo "Agent token: $agent_token"
  echo
  echo "Save these values now. They are also stored in $install_dir/.env."
else
  echo ".env already exists; keeping existing configuration."
fi

docker compose -f "$compose_file" pull
docker compose -f "$compose_file" up -d

echo
echo "VideoCAT is starting."
echo "Open: http://localhost:8081"
