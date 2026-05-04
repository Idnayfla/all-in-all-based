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

# ── 3. bun (required by gstack to build the browser binary) ──────────────────
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
~/.claude/skills/gstack/setup
ok "gstack setup complete"

# ── 5. Claude Code plugins (direct filesystem install) ───────────────────────
# The `claude plugins` CLI requires an interactive terminal for first-run setup,
# which is not available during postCreateCommand. We replicate what it would do
# by cloning the actual plugin repos and writing the manifest files Claude Code reads.

step "Installing Claude Code plugins..."

PLUGINS_DIR="$HOME/.claude/plugins"
mkdir -p "$PLUGINS_DIR/marketplaces"
mkdir -p "$PLUGINS_DIR/cache"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

clone_repo() {
  local repo="$1" dest="$2"
  if [ ! -d "$dest/.git" ]; then
    git clone --depth 1 "https://github.com/$repo.git" "$dest"
    ok "Cloned $repo"
  else
    ok "$repo already cloned"
  fi
}

# Clone marketplace index repos (needed for known_marketplaces.json)
clone_repo "anthropics/claude-plugins-official" "$PLUGINS_DIR/marketplaces/claude-plugins-official"
clone_repo "obra/superpowers-marketplace"       "$PLUGINS_DIR/marketplaces/superpowers-marketplace"
clone_repo "thedotmack/claude-mem"              "$PLUGINS_DIR/marketplaces/thedotmack"

# Clone actual superpowers plugin (marketplace is just a listing; plugin is a separate repo)
clone_repo "obra/superpowers" "$PLUGINS_DIR/marketplaces/superpowers-plugin"

# ── Install official plugins ──────────────────────────────────────────────────
# Plugin files live in plugins/<name>/ inside the claude-plugins-official repo
install_official() {
  local plugin="$1"
  local src="$PLUGINS_DIR/marketplaces/claude-plugins-official/plugins/$plugin"
  local dest="$PLUGINS_DIR/cache/claude-plugins-official/$plugin/unknown"
  if [ -d "$src" ]; then
    mkdir -p "$dest"
    cp -r "$src/." "$dest/"
    ok "$plugin@claude-plugins-official"
  else
    warn "Could not find plugins/$plugin in claude-plugins-official — skipping"
  fi
}

install_official "frontend-design"
install_official "code-review"
install_official "security-guidance"

# ── Install superpowers (versioned) ───────────────────────────────────────────
SP_SRC="$PLUGINS_DIR/marketplaces/superpowers-plugin"
SP_VER=$(node -e "try{const p=require('$SP_SRC/package.json');console.log(p.version||'unknown')}catch(e){console.log('unknown')}" 2>/dev/null || echo "unknown")
SP_SHA=$(cd "$SP_SRC" && git rev-parse HEAD 2>/dev/null || echo "")
SP_DEST="$PLUGINS_DIR/cache/superpowers-marketplace/superpowers/$SP_VER"
mkdir -p "$SP_DEST"
cp -r "$SP_SRC/." "$SP_DEST/"
ok "superpowers@superpowers-marketplace ($SP_VER)"

# ── Install claude-mem (versioned) ────────────────────────────────────────────
MEM_SRC="$PLUGINS_DIR/marketplaces/thedotmack"
MEM_VER=$(node -e "try{const p=require('$MEM_SRC/package.json');console.log(p.version||'unknown')}catch(e){console.log('unknown')}" 2>/dev/null || echo "unknown")
MEM_SHA=$(cd "$MEM_SRC" && git rev-parse HEAD 2>/dev/null || echo "")
MEM_DEST="$PLUGINS_DIR/cache/thedotmack/claude-mem/$MEM_VER"
mkdir -p "$MEM_DEST"
cp -r "$MEM_SRC/." "$MEM_DEST/"
ok "claude-mem@thedotmack ($MEM_VER)"

# ── Write registry files that Claude Code reads at startup ────────────────────
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

ok "Plugin manifests written to $PLUGINS_DIR"

# ── Done ──────────────────────────────────────────────────────────────────────
echo -e "\n${GREEN}✓ Codespace setup complete.${NC}"
echo "The Next.js dev server will start automatically on port 3000."
