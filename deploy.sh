#!/usr/bin/env bash
set -euo pipefail

# Deploy miguelito-ts to the phone (192.168.1.29).
# Build, rsync files, install deps, restart daemon.

HOST="192.168.1.29"
REMOTE_DIR="/data/data/com.termux/files/home/miguelito-ts"

echo "==> Building TypeScript..."
npm run build

echo "==> Syncing files to $HOST..."
tar czf /tmp/miguelito-ts.tar.gz \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='data' \
  --exclude='.env' \
  --exclude='*.tar.gz' \
  .
ssh "$HOST" "mkdir -p $REMOTE_DIR"
cat /tmp/miguelito-ts.tar.gz | ssh "$HOST" "tar xzf - -C $REMOTE_DIR"
rm /tmp/miguelito-ts.tar.gz

echo "==> Installing dependencies on remote..."
ssh "$HOST" "cd $REMOTE_DIR && npm install --production"

echo "==> Restarting miguelito on phone..."
ssh "$HOST" "~/.termux/boot/start-miguelito.sh"
sleep 12
ssh "$HOST" "pgrep -f 'node dist/index.js' >/dev/null && echo 'Daemon started OK' || echo 'WARNING: daemon did not start'"

echo "Deployed."
