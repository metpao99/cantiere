#!/bin/sh
# Avvia (o riavvia) il Cantiere in background.
# ROOT = cartella dentro cui Claude può lavorare (sottocartelle comprese).
PORT=8766
ROOT="$HOME"

cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:$PATH"
[ -f server.pid ] && kill "$(cat server.pid)" 2>/dev/null && sleep 1
nohup python3 server.py --port "$PORT" --root "$ROOT" >> server.log 2>&1 &
echo $! > server.pid
echo "Cantiere avviato sulla porta $PORT (log: $(pwd)/server.log)"
