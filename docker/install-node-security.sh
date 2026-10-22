#!/bin/sh
# Official Node.js security releases, with pinned SHA-256 checksums.
# The exact Docker release tags currently have no platform manifests.
set -eu

node_security_version=${1:?Pass the Node.js security release version}
case "$node_security_version" in
  22.23.4|24.22.1) ;;
  *) echo "Unsupported Node.js security release: $node_security_version" >&2; exit 1 ;;
esac

# Base images that already carry this exact release skip the download: installing it again
# only adds a second copy of Node to the image (about 80 MB).
if command -v node >/dev/null 2>&1 && [ "$(node --version)" = "v${node_security_version}" ]; then
  echo "Node.js ${node_security_version} is already installed."
  exit 0
fi

case "$(uname -m)" in
  x86_64) node_security_arch=x64 ;;
  aarch64|arm64) node_security_arch=arm64 ;;
  *) echo "Unsupported Node.js architecture: $(uname -m)" >&2; exit 1 ;;
esac

node_security_source=false
if [ -f /etc/alpine-release ]; then
  apk add --no-cache ca-certificates
  apk add --no-cache --virtual .node-security-download curl xz
  node_security_platform=linux-${node_security_arch}-musl
  # The official distribution provides a musl binary for x64. Build the same
  # verified release from source for Alpine arm64 rather than using glibc there.
  if [ "$node_security_arch" = arm64 ]; then
    node_security_source=true
    apk add --no-cache --virtual .node-security-compile g++ make python3 linux-headers
  fi
else
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl xz-utils
  rm -rf /var/lib/apt/lists/*
  node_security_platform=linux-${node_security_arch}
fi

if [ "$node_security_source" = true ]; then
  node_security_archive=node-v${node_security_version}.tar.xz
  node_security_platform=source
else
  node_security_archive=node-v${node_security_version}-${node_security_platform}.tar.xz
fi

case "${node_security_version}:${node_security_platform}" in
  22.23.4:linux-x64) node_security_sha=1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce ;;
  22.23.4:linux-arm64) node_security_sha=6287aa46b6c375d816e63ae66d024fbbfd70404825aabdfdf898a970871d2f4b ;;
  22.23.4:linux-x64-musl) node_security_sha=38355b952f0392b91703d38a0d9af84eb0ff77d69828ca4bc8cc3bc3af80a720 ;;
  22.23.4:source) node_security_sha=7b9adc82d612d0a2a863d96c46de2292552e250cee51956ebbe0146c42aacae9 ;;
  24.22.1:linux-x64) node_security_sha=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6 ;;
  24.22.1:linux-arm64) node_security_sha=dbabf7a1cbf947e6059ffad2c27b80041db97dea1e553b62afdee7f13fca336e ;;
  24.22.1:linux-x64-musl) node_security_sha=b83b6d679e4bf1128c8e9e982f3e64cd8badaddf1e38613aa36f93186395f9fa ;;
  24.22.1:source) node_security_sha=4f5379796280cdaeb0c2f358fd04b6a16cc4fb7dfa83b5a8c91a9d963b435231 ;;
  *) echo "No checksum for this Node.js platform" >&2; exit 1 ;;
esac

node_security_tmp=$(mktemp -d /tmp/node-security.XXXXXX)
trap 'rm -rf "$node_security_tmp"' EXIT
curl --fail --show-error --silent --location --retry 3 \
  "https://nodejs.org/dist/v${node_security_version}/${node_security_archive}" \
  --output "$node_security_tmp/node.tar.xz"
echo "$node_security_sha  $node_security_tmp/node.tar.xz" | sha256sum -c -

if [ "$node_security_source" = true ]; then
  tar -xJf "$node_security_tmp/node.tar.xz" -C "$node_security_tmp"
  (cd "$node_security_tmp/node-v${node_security_version}" \
    && ./configure --prefix=/usr/local \
    && make -j2 \
    && make install)
  apk del .node-security-compile
else
  # Remove old bundled package-manager files before extracting the new release.
  rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack
  tar -xJf "$node_security_tmp/node.tar.xz" -C /usr/local --strip-components=1 --no-same-owner
fi

if [ -f /etc/alpine-release ]; then
  apk del .node-security-download
fi
test "$(node --version)" = "v${node_security_version}"
