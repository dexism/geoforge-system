# deploy.ps1
# GeoForge System Deployment Script (PR Workflow)

param (
    [string]$CommitMessage = "Auto-update"
)

# 1. Generate Branch Name
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$branchName = "feature/deploy-$timestamp"

Write-Host "Starting deployment workflow..." -ForegroundColor Cyan
Write-Host "Target Branch: $branchName" -ForegroundColor Yellow

# 2. Create and Switch to New Branch
# Check if we contain uncommitted changes or unpushed commits on main
git checkout -b $branchName

# 3. Add & Commit
$gitStatus = git status --porcelain
if ($gitStatus) {
    Write-Host "Changes detected. Committing..." -ForegroundColor Cyan
    git add .
    git commit -m "$CommitMessage ($timestamp)"
}
else {
    Write-Host "No new changes to commit. Proceeding with existing commits..." -ForegroundColor Yellow
}

# 4. Push to Remote
Write-Host "Pushing to origin/$branchName..." -ForegroundColor Cyan
git push -u origin $branchName

if ($LASTEXITCODE -eq 0) {
    Write-Host "Push successful!" -ForegroundColor Green
    
    # 5. Guide to PR
    $prUrl = "https://github.com/dexism/geoforge-system/compare/main...$branchName?expand=1"
    Write-Host "`n==========================================" -ForegroundColor White
    Write-Host "Create Pull Request at:" -ForegroundColor Cyan
    Write-Host $prUrl -ForegroundColor Blue
    Write-Host "==========================================`n"
    
    # Option to open browser
    $open = Read-Host "Open PR page in browser? (Y/n)"
    if ($open -ne 'n') {
        Start-Process $prUrl
    }
}
else {
    Write-Host "Push failed." -ForegroundColor Red
}
