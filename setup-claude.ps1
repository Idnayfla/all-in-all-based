# Claude CLI Setup Script for Windows
# Run this in PowerShell as needed

Write-Host "Setting up Claude CLI..." -ForegroundColor Cyan

# Step 1: Fix execution policy
Write-Host "`n[1/3] Setting execution policy..." -ForegroundColor Yellow
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
Write-Host "Done." -ForegroundColor Green

# Step 2: Install Claude CLI globally
Write-Host "`n[2/3] Installing Claude CLI..." -ForegroundColor Yellow
npm install -g @anthropic-ai/claude-code
Write-Host "Done." -ForegroundColor Green

# Step 3: Add npm global bin to PATH permanently
Write-Host "`n[3/3] Adding npm global path to PATH..." -ForegroundColor Yellow
$npmPrefix = npm config get prefix
$currentPath = [System.Environment]::GetEnvironmentVariable("Path", "User")

if ($currentPath -notlike "*$npmPrefix*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$currentPath;$npmPrefix", "User")
    Write-Host "Path added: $npmPrefix" -ForegroundColor Green
} else {
    Write-Host "Path already exists, skipping." -ForegroundColor Gray
}

# Refresh PATH in current session
$env:PATH += ";$npmPrefix"

Write-Host "`nAll done! Try running: claude" -ForegroundColor Cyan
