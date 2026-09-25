#!/usr/bin/env bash
# Publishes PrismTV as a public website (GitHub Pages) - or updates it, if already published.
# Double-click it. The first time it signs you in to GitHub in your browser and creates the repo.
set -e
cd "$(dirname "$0")"
REPO_NAME="${1:-prismtv}"
pause() { echo; read -n 1 -s -r -p "Press any key to close this window."; echo; }
trap 'echo; echo "Something went wrong (see above)."; pause' ERR

echo "== PrismTV -> public website =="

# 1. GitHub's command-line tool
if ! command -v gh >/dev/null 2>&1; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is needed to install GitHub's tool: https://brew.sh"; pause; exit 1
  fi
  echo "Installing GitHub CLI (gh)..."
  brew install gh
fi

# 2. Sign in (opens the browser the first time)
if ! gh auth status >/dev/null 2>&1; then
  echo "Signing in to GitHub - a browser window will open. Use the code shown here."
  gh auth login --web --git-protocol https --hostname github.com
fi
gh auth setup-git >/dev/null 2>&1 || true
OWNER="$(gh api user --jq .login)"
ID="$(gh api user --jq .id)"

# 3. Local git repository
if [ ! -d .git ]; then
  git init -q -b main
fi
git config user.name  >/dev/null 2>&1 || git config user.name  "$OWNER"
git config user.email >/dev/null 2>&1 || git config user.email "${ID}+${OWNER}@users.noreply.github.com"
git add -A
git commit -q -m "Update PrismTV ($(date '+%Y-%m-%d %H:%M'))" || echo "(no changes to commit)"

# 4. GitHub repository: create once, then just push
if ! git remote get-url origin >/dev/null 2>&1; then
  if gh repo view "$OWNER/$REPO_NAME" >/dev/null 2>&1; then
    git remote add origin "https://github.com/$OWNER/$REPO_NAME.git"
  else
    echo "Creating public repository $OWNER/$REPO_NAME ..."
    gh repo create "$REPO_NAME" --public --source . --remote origin --description "PrismTV - free TV, films and English lessons"
  fi
fi
git push -u origin main

# 5. Turn on GitHub Pages (built by .github/workflows/pages.yml)
REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
gh api -X POST "repos/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 \
  || gh api -X PUT "repos/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 || true
gh workflow run pages.yml >/dev/null 2>&1 || true

URL="https://${OWNER}.github.io/${REPO#*/}/"
echo
echo "Published. In 1-2 minutes your site will be live at:"
echo
echo "    $URL"
echo
echo "Progress: https://github.com/$REPO/actions"
echo "Run this script again any time to publish your latest changes."
echo "The site also refreshes its playlists by itself every day."
pause
