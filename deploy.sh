#!/usr/bin/env bash
set -euo pipefail

# Deploy miguelito-ts to the phone (192.168.1.29).
# Build, rsync files, install deps, restart daemon.

HOST="192.168.1.29"
REMOTE_DIR="$HOME/miguelito-ts"

echo "==> Building TypeScript..."
npm run build

echo "==> Syncing files to $HOST..."
rsync -avz --exclude='node_modules' --exclude='.git' --exclude='data' --exclude='dist' ./ "$HOST:$REMOTE_DIR/"

echo "==> Installing dependencies on remote..."
ssh "$HOST" "cd $REMOTE_DIR && npm install --production"

echo "==> Restarting miguelito on phone..."
ssh "$HOST" "pkill -f 'node dist/index.js' 2>/dev/null || true; sleep 1; cd $REMOTE_DIR && nohup node dist/index.js > miguelito.log 2>&1 &"
sleep 2
ssh "$HOST" "pgrep -f 'node dist/index.js' >/dev/null && echo 'Daemon started OK' || echo 'WARNING: daemon did not start'"

echo "Deployed."
