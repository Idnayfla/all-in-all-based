#!/usr/bin/env bash
# Runs once when the Codespace container is created.
# Installs: project deps, Claude Code CLI, gstack, and all Claude plugins.
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step()  { echo -e "\n${BLUE}==>${NC} $1"; }
ok()    { echo -e "${GREEN}  ✓${NC} $1"; }
warn()  { echo -e "${YELLOW}  !${NC} $1"; }
err()   { echo -e "${RED}  ✗${NC} $1"; }

# ── 1. Project dependencies ───────────────────────────────────────────────────
step "Installing npm dependencies..."
npm install
ok "npm install done"

# ── 2. Claude Code CLI ────────────────────────────────────────────────────────
step "Installing Claude Code CLI..."
npm install -g @anthropic-ai/claude-code

# npm global bin may not be on PATH yet in this shell — find it explicitly
CLAUDE_BIN="$(npm root -g)/../bin/claude"
export PATH="$(npm root -g)/../bin:$PATH"
echo "export PATH=\"$(npm root -g)/../bin:\$PATH\"" >> ~/.bashrc

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
  ok "gstack already present, skipping clone"
fi

~/.claude/skills/gstack/setup
ok "gstack setup complete"

# ── 5. Plugin marketplaces ────────────────────────────────────────────────────
step "Registering Claude Code plugin marketplaces..."

add_marketplace() {
  local source="$1"
  local label="$2"
  if claude plugins marketplace add "$source" --scope user; then
    ok "$label added"
  else
    warn "$label may already be registered (continuing)"
  fi
}

add_marketplace "anthropics/claude-plugins-official" "claude-plugins-official"
add_marketplace "obra/superpowers-marketplace"       "superpowers-marketplace"
add_marketplace "thedotmack/claude-mem"              "thedotmack (claude-mem)"

# ── 6. Plugins ────────────────────────────────────────────────────────────────
step "Installing Claude Code plugins..."

install_plugin() {
  local spec="$1"
  if claude plugins install "$spec" --scope user; then
    ok "$spec installed"
  else
    warn "$spec failed — you may need to install it manually: claude plugins install $spec"
  fi
}

install_plugin "superpowers@superpowers-marketplace"
install_plugin "frontend-design@claude-plugins-official"
install_plugin "code-review@claude-plugins-official"
install_plugin "security-guidance@claude-plugins-official"
install_plugin "claude-mem@thedotmack"

# ── Done ──────────────────────────────────────────────────────────────────────
echo -e "\n${GREEN}✓ Codespace setup complete.${NC}"
echo "The Next.js dev server will start automatically on port 3000."
