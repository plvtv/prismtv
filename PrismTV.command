#!/usr/bin/env bash
# Double-click to start PrismTV for this Mac AND phones/TVs on the home Wi-Fi.
# Opened at login by the Login Item that install-autostart.command adds.
# If the server ever stops, it starts again after 5 seconds. Close this window to stop it.
cd "$(dirname "$0")"
printf '\033]0;PrismTV server\007'          # window title

# Tuck the Terminal window away (Dock) so it does not sit on screen after login.
osascript -e 'tell application "Terminal" to set miniaturized of (every window whose name contains "PrismTV server") to true' >/dev/null 2>&1 &

if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "PrismTV is already running on port 8080 - nothing to do."
  echo "This window can be closed."
  exit 0
fi

while true; do
  ./serve.sh --lan
  echo
  echo "PrismTV stopped ($(date '+%H:%M:%S')). Restarting in 5 seconds - close this window to stop for good."
  sleep 5
done
