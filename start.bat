@echo off
chcp 65001 >nul 2>&1
title Claude Code Session Viewer

echo ╔══════════════════════════════════════════════╗
echo ║   Claude Code 会话查看器                     ║
echo ╠══════════════════════════════════════════════╣
echo ║  启动中...                                   ║
echo ╚══════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: Open browser after a short delay (let server start first)
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8080"

:: Start Python server
python server.py

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] 启动失败，请确认 Python 已安装并添加到 PATH
    pause
)
