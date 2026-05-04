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
ok "gstack setup complete (browser/Playwright skipped — unavailable in Codespaces)"

# ── 5. Claude Code plugins ────────────────────────────────────────────────────
# ANTHROPIC_API_KEY is available as a Codespace secret, which allows
# claude plugins install to run non-interactively.
step "Installing Claude Code plugins..."

claude plugins install superpowers@superpowers-marketplace
ok "superpowers installed"

claude plugins install frontend-design@claude-plugins-official
ok "frontend-design installed"

claude plugins install code-review@claude-plugins-official
ok "code-review installed"

claude plugins install security-guidance@claude-plugins-official
ok "security-guidance installed"

claude plugins install claude-mem@thedotmack
ok "claude-mem installed"

# ── Done ──────────────────────────────────────────────────────────────────────
echo -e "\n${GREEN}✓ Codespace setup complete.${NC}"
echo "The Next.js dev server will start automatically on port 3000."
