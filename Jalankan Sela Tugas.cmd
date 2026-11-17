@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js diperlukan. Pasang Node.js 24 LTS lalu buka lagi file ini.
  pause
  exit /b 1
)
title Sela Tugas - Pengingat aktif
node --env-file-if-exists=.env.local server.mjs --open
if errorlevel 1 pause
