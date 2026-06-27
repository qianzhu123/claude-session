@echo off
title Claude Code Session Viewer

echo ==================================================
echo   Claude Code Session Viewer
echo ==================================================
echo   Starting local server...
echo   URL: http://localhost:8080
echo ==================================================
echo.

cd /d "%~dp0"

:: Open browser after a short delay (let server start first)
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8080"

:: Start Python server
python server.py

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to start. Please make sure Python is installed and added to PATH.
    pause
)
