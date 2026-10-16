#!/bin/bash
# Xcode Cloud does not include Node. Install it, then copy the website into the app.
set -euo pipefail

echo "Family Planner Xcode Cloud post-clone"

NODE_VERSION="22.21.0"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) NODE_ARCH="arm64" ;;
  x86_64) NODE_ARCH="x64" ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac

curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz" -o /tmp/node.tar.gz
mkdir -p /tmp/node
tar -xzf /tmp/node.tar.gz -C /tmp/node --strip-components=1
export PATH="/tmp/node/bin:${PATH}"

node -v
npm -v

cd "${CI_PRIMARY_REPOSITORY_PATH}"
npm ci
npm run cap:sync

echo "Web assets synced"
