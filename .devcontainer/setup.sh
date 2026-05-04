#!/usr/bin/env bash
# Runs once when the Codespace container is created.
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

step() { echo -e "\n${BLUE}==>${NC} $1"; }
ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
warn() { echo -e "${YELLOW}  !${NC} $1"; }

# ── 1. Project dependencies ───────────────────────────────────────────────────
step "Installing npm dependencies..."
npm install
ok "npm install done"

# ── 2. Claude Code CLI ────────────────────────────────────────────────────────
step "Installing Claude Code CLI..."
npm install -g @anthropic-ai/claude-code
NPM_BIN="$(npm root -g)/../bin"
export PATH="$NPM_BIN:$PATH"
echo "export PATH=\"$NPM_BIN:\$PATH\"" >> ~/.bashrc
ok "Claude Code $(claude --version) installed"

# ── 3. bun ────────────────────────────────────────────────────────────────────
step "Installing bun..."
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
  ok "bun $(bun --version) installed"
else
  ok "bun $(bun --version) already present"
fi

# ── 4. gstack ─────────────────────────────────────────────────────────────────
step "Installing gstack..."
mkdir -p ~/.claude/skills
if [ ! -d ~/.claude/skills/gstack ]; then
  git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
  ok "gstack cloned"
else
  ok "gstack already present"
fi
ok "gstack setup complete (browser/Playwright skipped — unavailable in Codespaces)"

# ── 5. Claude Code plugins (filesystem install) ───────────────────────────────
step "Installing Claude Code plugins..."

PLUGINS_DIR="$HOME/.claude/plugins"
mkdir -p "$PLUGINS_DIR/marketplaces"
mkdir -p "$PLUGINS_DIR/cache"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

clone_repo() {
  local repo="$1" dest="$2"
  if [ -d "$dest/.git" ]; then
    ok "$repo already cloned"
  else
    rm -rf "$dest"
    git clone --depth 1 "https://github.com/$repo.git" "$dest"
    ok "Cloned $repo"
  fi
}

# Clone marketplace index repos
clone_repo "anthropics/claude-plugins-official" "$PLUGINS_DIR/marketplaces/claude-plugins-official"
clone_repo "obra/superpowers-marketplace"       "$PLUGINS_DIR/marketplaces/superpowers-marketplace"
clone_repo "thedotmack/claude-mem"              "$PLUGINS_DIR/marketplaces/thedotmack"

# Clone actual superpowers plugin (the marketplace repo is just a listing)
clone_repo "obra/superpowers" "$PLUGINS_DIR/marketplaces/superpowers-plugin"

# Official plugins live in plugins/<name>/ inside the marketplace repo
install_official() {
  local plugin="$1"
  local src="$PLUGINS_DIR/marketplaces/claude-plugins-official/plugins/$plugin"
  local dest="$PLUGINS_DIR/cache/claude-plugins-official/$plugin/unknown"
  mkdir -p "$dest"
  cp -r "$src/." "$dest/"
  ok "$plugin@claude-plugins-official"
}

install_official "frontend-design"
install_official "code-review"
install_official "security-guidance"

# Superpowers — versioned folder
SP_SRC="$PLUGINS_DIR/marketplaces/superpowers-plugin"
SP_VER=$(node -e "try{const p=require('$SP_SRC/package.json');console.log(p.version||'unknown')}catch(e){console.log('unknown')}" 2>/dev/null || echo "unknown")
SP_SHA=$(cd "$SP_SRC" && git rev-parse HEAD 2>/dev/null || echo "")
SP_DEST="$PLUGINS_DIR/cache/superpowers-marketplace/superpowers/$SP_VER"
mkdir -p "$SP_DEST"
cp -r "$SP_SRC/." "$SP_DEST/"
ok "superpowers@superpowers-marketplace ($SP_VER)"

# claude-mem — versioned folder
MEM_SRC="$PLUGINS_DIR/marketplaces/thedotmack"
MEM_VER=$(node -e "try{const p=require('$MEM_SRC/package.json');console.log(p.version||'unknown')}catch(e){console.log('unknown')}" 2>/dev/null || echo "unknown")
MEM_SHA=$(cd "$MEM_SRC" && git rev-parse HEAD 2>/dev/null || echo "")
MEM_DEST="$PLUGINS_DIR/cache/thedotmack/claude-mem/$MEM_VER"
mkdir -p "$MEM_DEST"
cp -r "$MEM_SRC/." "$MEM_DEST/"
ok "claude-mem@thedotmack ($MEM_VER)"

# Write plugin registry files
cat > "$PLUGINS_DIR/known_marketplaces.json" << JSONEOF
{
  "claude-plugins-official": {
    "source": {"source": "github", "repo": "anthropics/claude-plugins-official"},
    "installLocation": "$PLUGINS_DIR/marketplaces/claude-plugins-official",
    "lastUpdated": "$NOW"
  },
  "superpowers-marketplace": {
    "source": {"source": "github", "repo": "obra/superpowers-marketplace"},
    "installLocation": "$PLUGINS_DIR/marketplaces/superpowers-marketplace",
    "lastUpdated": "$NOW"
  },
  "thedotmack": {
    "source": {"source": "github", "repo": "thedotmack/claude-mem"},
    "installLocation": "$PLUGINS_DIR/marketplaces/thedotmack",
    "lastUpdated": "$NOW"
  }
}
JSONEOF

cat > "$PLUGINS_DIR/installed_plugins.json" << JSONEOF
{
  "version": 2,
  "plugins": {
    "superpowers@superpowers-marketplace": [
      {
        "scope": "user",
        "installPath": "$SP_DEST",
        "version": "$SP_VER",
        "installedAt": "$NOW",
        "lastUpdated": "$NOW",
        "gitCommitSha": "$SP_SHA"
      }
    ],
    "frontend-design@claude-plugins-official": [
      {
        "scope": "user",
        "installPath": "$PLUGINS_DIR/cache/claude-plugins-official/frontend-design/unknown",
        "version": "unknown",
        "installedAt": "$NOW",
        "lastUpdated": "$NOW"
      }
    ],
    "code-review@claude-plugins-official": [
      {
        "scope": "user",
        "installPath": "$PLUGINS_DIR/cache/claude-plugins-official/code-review/unknown",
        "version": "unknown",
        "installedAt": "$NOW",
        "lastUpdated": "$NOW"
      }
    ],
    "security-guidance@claude-plugins-official": [
      {
        "scope": "user",
        "installPath": "$PLUGINS_DIR/cache/claude-plugins-official/security-guidance/unknown",
        "version": "unknown",
        "installedAt": "$NOW",
        "lastUpdated": "$NOW"
      }
    ],
    "claude-mem@thedotmack": [
      {
        "scope": "user",
        "installPath": "$MEM_DEST",
        "version": "$MEM_VER",
        "installedAt": "$NOW",
        "lastUpdated": "$NOW",
        "gitCommitSha": "$MEM_SHA"
      }
    ]
  }
}
JSONEOF

# Write settings.json — this is what Claude Code reads to know which plugins are enabled
mkdir -p "$HOME/.claude"
cat > "$HOME/.claude/settings.json" << 'SETTINGSEOF'
{
  "enabledPlugins": {
    "superpowers@superpowers-marketplace": true,
    "frontend-design@claude-plugins-official": true,
    "code-review@claude-plugins-official": true,
    "security-guidance@claude-plugins-official": true,
    "claude-mem@thedotmack": true
  },
  "extraKnownMarketplaces": {
    "superpowers-marketplace": {
      "source": {
        "source": "github",
        "repo": "obra/superpowers-marketplace"
      }
    },
    "thedotmack": {
      "source": {
        "source": "github",
        "repo": "thedotmack/claude-mem"
      }
    }
  }
}
SETTINGSEOF

ok "Claude Code settings and plugin manifests written"

# ── Done ──────────────────────────────────────────────────────────────────────
echo -e "\n${GREEN}✓ Codespace setup complete.${NC}"
echo "The Next.js dev server will start automatically on port 3000."
