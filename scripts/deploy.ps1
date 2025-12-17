# deploy.ps1
# GeoForge System Deployment Script

# 1. Check for changes
$gitStatus = git status --porcelain
if (-not $gitStatus) {
    Write-Host "No changes to deploy." -ForegroundColor Yellow
    exit
}

# 2. Add all changes
git add .

# 3. Create commit message with timestamp
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$commitMessage = "Deploy: $timestamp (Auto-Update)"

# 4. Commit
git commit -m "$commitMessage"

# 5. Push to remote
Write-Host "Pushing to remote..." -ForegroundColor Cyan
git push

if ($LASTEXITCODE -eq 0) {
    Write-Host "Deployment successful!" -ForegroundColor Green
}
else {
    Write-Host "Deployment failed." -ForegroundColor Red
}
