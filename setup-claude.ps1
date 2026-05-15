# All in All Based — Full Local Setup Script
# Run once on any new Windows machine: .\setup-claude.ps1

Write-Host "`n All in All Based — Local Setup" -ForegroundColor Cyan
Write-Host "================================`n" -ForegroundColor Cyan

# ── Step 1: Execution Policy ────────────────────────────────────────────────
Write-Host "[1/5] Setting execution policy..." -ForegroundColor Yellow
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
Write-Host "Done." -ForegroundColor Green

# ── Step 2: Node.js version check ───────────────────────────────────────────
Write-Host "`n[2/5] Checking Node.js version..." -ForegroundColor Yellow
$nodeVersion = $null
try { $nodeVersion = (node --version 2>$null) } catch {}

if (-not $nodeVersion) {
    Write-Host "Node.js not found. Installing via winget..." -ForegroundColor Red
    winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    Write-Host "Node.js installed. Please restart this terminal and re-run setup." -ForegroundColor Green
    exit 0
}

$nodeMajor = [int]($nodeVersion -replace 'v(\d+).*', '$1')
if ($nodeMajor -lt 20) {
    Write-Host "Node $nodeVersion detected — need v20+." -ForegroundColor Red
    Write-Host "Attempting upgrade via winget..." -ForegroundColor Yellow
    winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    Write-Host "Node upgraded. Please restart this terminal and re-run setup." -ForegroundColor Green
    exit 0
}

Write-Host "Node $nodeVersion — OK" -ForegroundColor Green

# ── Step 3: Install npm dependencies ────────────────────────────────────────
Write-Host "`n[3/5] Installing npm dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "npm install failed. Check errors above." -ForegroundColor Red
    exit 1
}
Write-Host "Dependencies installed." -ForegroundColor Green

# ── Step 4: Install Claude CLI globally ─────────────────────────────────────
Write-Host "`n[4/5] Installing Claude CLI..." -ForegroundColor Yellow
npm install -g @anthropic-ai/claude-code
Write-Host "Done." -ForegroundColor Green

# ── Step 5: Add npm global bin to PATH ──────────────────────────────────────
Write-Host "`n[5/5] Configuring PATH..." -ForegroundColor Yellow
$npmPrefix = npm config get prefix
$currentPath = [System.Environment]::GetEnvironmentVariable("Path", "User")

if ($currentPath -notlike "*$npmPrefix*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$currentPath;$npmPrefix", "User")
    Write-Host "Added to PATH: $npmPrefix" -ForegroundColor Green
} else {
    Write-Host "PATH already configured." -ForegroundColor Gray
}
$env:PATH += ";$npmPrefix"

# ── Done ─────────────────────────────────────────────────────────────────────
Write-Host "`n Setup complete!" -ForegroundColor Cyan
Write-Host "Run: npm run dev" -ForegroundColor White
Write-Host "Then open: http://localhost:3000`n" -ForegroundColor White
