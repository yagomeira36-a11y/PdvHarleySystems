@echo off
REM ============================================================
REM Inicia o servidor de desenvolvimento do PDV Hamburgueria
REM Usa o Node portátil incluído na pasta .nodejs
REM ============================================================
cd /d "%~dp0"
set "PATH=%~dp0.nodejs;%PATH%"
call npm.cmd run dev
pause
