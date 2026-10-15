# Start-Up Script for Climate Hazard Trend Analyzer (Backend + Frontend)
$ErrorActionPreference = "Stop"
$env:PATH = "C:\Program Files\nodejs;$env:PATH"

Write-Host "Starting FastAPI Backend on http://127.0.0.1:8000 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot'; .\.venv\Scripts\uvicorn.exe backend.main:app --host 127.0.0.1 --port 8000 --reload"

Write-Host "Starting React (Vite) Frontend on http://localhost:5173 ..." -ForegroundColor Amber
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\frontend'; `$env:PATH='C:\Program Files\nodejs;' + `$env:PATH; npm run dev"

