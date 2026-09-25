#!/usr/bin/env bash
# Serve PrismTV over plain HTTP, with the local mpv bridge enabled.
#   ./serve.sh            only this Mac can open it (http://localhost:8080)
#   ./serve.sh --lan      phones, tablets and TVs on the same Wi-Fi can open it too
#   ./serve.sh 9000 --lan a different port
set -e
cd "$(dirname "$0")"
if [[ " $* " == *" --lan "* ]] && command -v caffeinate >/dev/null 2>&1; then
  # Keep the Mac from idle-sleeping while it is serving other devices (the display may still sleep).
  exec caffeinate -i python3 serve.py "$@"
fi
exec python3 serve.py "$@"
