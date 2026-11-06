#!/bin/sh
# Avvia (o riavvia) il Cantiere in background.
# ROOT = cartella dentro cui Claude può lavorare (sottocartelle comprese).
PORT=8766
ROOT="$HOME"

cd "$(dirname "$0")" || exit 1
# all'avvio da crontab (@reboot) non viene letto ~/.profile: senza queste righe le chat non trovano git
export PATH="$HOME/.local/bin:$HOME/.local/git/usr/bin:$PATH"
[ -d "$HOME/.local/git/usr/lib/git-core" ] && export GIT_EXEC_PATH="$HOME/.local/git/usr/lib/git-core"
[ -d "$HOME/.local/git/usr/share/git-core/templates" ] && export GIT_TEMPLATE_DIR="$HOME/.local/git/usr/share/git-core/templates"
[ -f server.pid ] && kill "$(cat server.pid)" 2>/dev/null && sleep 1
nohup python3 server.py --port "$PORT" --root "$ROOT" >> server.log 2>&1 &
echo $! > server.pid
echo "Cantiere avviato sulla porta $PORT (log: $(pwd)/server.log)"
