# All in All Based — Full Local Setup Script
# Runs automatically on VS Code folder open, or manually: .\setup-claude.ps1

Write-Host "`n  All in All Based — Local Setup" -ForegroundColor Cyan
Write-Host "  ================================`n" -ForegroundColor Cyan

# ── Step 1: Execution Policy ─────────────────────────────────────────────────
Write-Host "[1/5] Setting execution policy..." -ForegroundColor Yellow
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
Write-Host "      Done." -ForegroundColor Green

# ── Step 2: Node.js version check + auto-fix ─────────────────────────────────
Write-Host "`n[2/5] Checking Node.js version..." -ForegroundColor Yellow

$nodeOk = $false
try {
    $nodeVersion = node --version 2>$null
    $nodeMajor = [int]($nodeVersion -replace 'v(\d+).*', '$1')
    if ($nodeMajor -ge 20) {
        Write-Host "      Node $nodeVersion — OK" -ForegroundColor Green
        $nodeOk = $true
    } else {
        Write-Host "      Node $nodeVersion detected — need v20+." -ForegroundColor Red
    }
} catch {
    Write-Host "      Node not found." -ForegroundColor Red
}

if (-not $nodeOk) {
    # Try nvm first (fast, no restart needed)
    $nvmExists = Get-Command nvm -ErrorAction SilentlyContinue
    if ($nvmExists) {
        Write-Host "      nvm found — switching to Node 20..." -ForegroundColor Yellow
        nvm install 20 | Out-Null
        nvm use 20 | Out-Null
        $nodeVersion = node --version 2>$null
        Write-Host "      Now on Node $nodeVersion" -ForegroundColor Green
        $nodeOk = $true
    } else {
        # Fall back to winget
        Write-Host "      Installing Node 20 via winget..." -ForegroundColor Yellow
        winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
        Write-Host "      Node installed. Restart this terminal then run: .\setup-claude.ps1" -ForegroundColor Green
        exit 0
    }
}

# ── Step 3: Install npm dependencies ─────────────────────────────────────────
Write-Host "`n[3/5] Installing npm dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "      npm install failed. Check errors above." -ForegroundColor Red
    exit 1
}
Write-Host "      Done." -ForegroundColor Green

# ── Step 4: Install Claude CLI globally ──────────────────────────────────────
Write-Host "`n[4/5] Installing Claude CLI..." -ForegroundColor Yellow
npm install -g @anthropic-ai/claude-code
Write-Host "      Done." -ForegroundColor Green

# ── Step 5: Add npm global bin to PATH ───────────────────────────────────────
Write-Host "`n[5/5] Configuring PATH..." -ForegroundColor Yellow
$npmPrefix = npm config get prefix
$currentPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$npmPrefix*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$currentPath;$npmPrefix", "User")
    Write-Host "      Added: $npmPrefix" -ForegroundColor Green
} else {
    Write-Host "      PATH already configured." -ForegroundColor Gray
}
$env:PATH += ";$npmPrefix"

# ── Done ─────────────────────────────────────────────────────────────────────
Write-Host "`n  Setup complete! Run: npm run dev" -ForegroundColor Cyan
Write-Host "  Open: http://localhost:3000`n" -ForegroundColor White
