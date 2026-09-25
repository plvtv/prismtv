#!/usr/bin/env bash
# Double-click once: PrismTV will start by itself every time you log in to this Mac.
cd "$(dirname "$0")"
chmod +x PrismTV.command serve.sh serve.py
APP="$(pwd)/PrismTV.command"
osascript <<OSA
tell application "System Events"
  if exists login item "PrismTV.command" then delete login item "PrismTV.command"
  make login item at end with properties {path:"$APP", hidden:true}
end tell
OSA
if [ $? -eq 0 ]; then
  echo "Done. PrismTV will start automatically when you log in."
  echo "You can see or remove it in System Settings > General > Login Items."
  echo
  echo "Starting it now..."
  open "$APP"
else
  echo "macOS did not allow adding the Login Item."
  echo "Add it by hand: System Settings > General > Login Items > + > choose PrismTV.command"
fi
echo
read -n 1 -s -r -p "Press any key to close this window."
