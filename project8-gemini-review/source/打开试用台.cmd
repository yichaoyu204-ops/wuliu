@echo off
cd /d "%~dp0"
node scripts\preview.mjs --open
if errorlevel 1 pause
