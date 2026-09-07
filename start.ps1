# EduNexus PowerShell Launcher
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  Starting Mouse Innovations EduNexus Lab Suite...  " -ForegroundColor Yellow
Write-Host "===================================================" -ForegroundColor Cyan

Set-Location -Path $PSScriptRoot
python run_all.py
