@echo off
echo Starting UseSteady web UI...
echo.
echo [1/2] Starting API server on port 3001...
start "UseSteady API" cmd /k "cd /d %~dp0.. && npx tsx server.ts"

timeout /t 2 /nobreak > nul

echo [2/2] Starting React dev server on port 5173...
start "UseSteady UI" cmd /k "cd /d %~dp0 && npm run dev"

timeout /t 3 /nobreak > nul
echo.
echo UseSteady UI -> http://localhost:5173
echo API server   -> http://localhost:3001
