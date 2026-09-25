#!/usr/bin/env bash
# Double-click to stop PrismTV from starting at login. (Stop a running server by closing its window.)
osascript -e 'tell application "System Events" to if exists login item "PrismTV.command" then delete login item "PrismTV.command"' \
  && echo "PrismTV will no longer start at login." \
  || echo "Could not change Login Items. Remove it in System Settings > General > Login Items."
read -n 1 -s -r -p "Press any key to close this window."
