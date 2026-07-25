@echo off
chcp 65001 >nul
cd /d "%~dp0"
node "%~dp0apply-v3-task-center.js"
echo.
pause
