#!/usr/bin/env bash
# Runs once when the Codespace container is created.
# Installs: project deps, Claude Code CLI, gstack, and all Claude plugins.
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

step()  { echo -e "\n${BLUE}==>${NC} $1"; }
ok()    { echo -e "${GREEN}  ✓${NC} $1"; }
warn()  { echo -e "${YELLOW}  !${NC} $1"; }

# ── 1. Project dependencies ───────────────────────────────────────────────────
step "Installing npm dependencies..."
npm install
ok "npm install done"

# ── 2. Claude Code CLI ────────────────────────────────────────────────────────
step "Installing Claude Code CLI..."
npm install -g @anthropic-ai/claude-code
ok "Claude Code $(claude --version) installed"

# ── 3. bun (required by gstack to build the browser binary) ──────────────────
step "Installing bun..."
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  # Make bun available for the rest of this script
  export PATH="$HOME/.bun/bin:$PATH"
  # Persist for future shell sessions
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

# Builds the Chromium browser binary — takes ~30 s on first run
~/.claude/skills/gstack/setup
ok "gstack setup complete"

# ── 5. Plugin marketplaces ────────────────────────────────────────────────────
step "Registering Claude Code plugin marketplaces..."

# anthropics/claude-plugins-official  →  frontend-design, code-review, security-guidance
claude plugins marketplace add anthropics/claude-plugins-official --scope user 2>/dev/null \
  && ok "claude-plugins-official added" \
  || ok "claude-plugins-official already registered"

# obra/superpowers-marketplace  →  superpowers
claude plugins marketplace add obra/superpowers-marketplace --scope user 2>/dev/null \
  && ok "superpowers-marketplace added" \
  || ok "superpowers-marketplace already registered"

# thedotmack/claude-mem  →  claude-mem
claude plugins marketplace add thedotmack/claude-mem --scope user 2>/dev/null \
  && ok "thedotmack (claude-mem) marketplace added" \
  || ok "thedotmack marketplace already registered"

# ── 6. Plugins ────────────────────────────────────────────────────────────────
step "Installing Claude Code plugins..."

install_plugin() {
  local spec="$1"
  claude plugins install "$spec" --scope user 2>/dev/null \
    && ok "$spec installed" \
    || ok "$spec already installed"
}

install_plugin "superpowers@superpowers-marketplace"
install_plugin "frontend-design@claude-plugins-official"
install_plugin "code-review@claude-plugins-official"
install_plugin "security-guidance@claude-plugins-official"
install_plugin "claude-mem@thedotmack"

# ── Done ──────────────────────────────────────────────────────────────────────
echo -e "\n${GREEN}✓ Codespace setup complete.${NC}"
echo ""
echo "The Next.js dev server will start automatically on port 3000."
echo ""
echo -e "${YELLOW}Required Codespace secrets${NC} (add at github.com → Settings → Codespaces):"
echo "  ANTHROPIC_API_KEY   — Claude API key (required)"
echo "  E2B_API_KEY         — Code execution sandbox (optional)"
echo "  NETLIFY_TOKEN       — Deploy to Netlify (optional)"
echo "  REDIS_URL           — Persistent AI memory (optional)"
echo ""
echo "After adding secrets, rebuild the Codespace for them to take effect."
