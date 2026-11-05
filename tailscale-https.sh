#!/bin/sh
# Pubblica il Cantiere in HTTPS sulla tua rete Tailscale, usando il Tailscale
# già installato per la Dispensa: https://nas-dispensa.<tua-rete>.ts.net:8443
# Basta lanciarlo una volta: l'impostazione resta salvata anche dopo i riavvii.
TSDIR="$HOME/Dispensa/dispensa-server/tailscale"
cd "$TSDIR" || { echo "Non trovo $TSDIR"; exit 1; }
./tailscale --socket=./state/tailscaled.sock serve --bg --https=8443 http://127.0.0.1:8766
./tailscale --socket=./state/tailscaled.sock serve status
