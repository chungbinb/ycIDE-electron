@echo off
rem ============================================================
rem  ycIDE - one-click launcher (dev mode)
rem
rem  Double-click this file to open the IDE.
rem  No packaging / no binary required: it runs the TypeScript
rem  sources directly through electron-vite dev.
rem
rem  NOTE: messages are intentionally ASCII-only. cmd.exe parses
rem  .bat files with the local OEM code page, so UTF-8 Chinese
rem  text inside a .bat would be garbled.
rem ============================================================
setlocal
title ycIDE Launcher
cd /d "%~dp0"

echo ============================================================
echo  ycIDE - Launcher
echo ============================================================
echo  Folder: %CD%
echo.

rem ---------- 1/4 Node.js ----------
where node >nul 2>nul
if errorlevel 1 goto no_node
for /f "delims=" %%v in ('node -v') do set "NODEVER=%%v"
echo [1/4] Node.js %NODEVER%
echo %NODEVER% | findstr /r "^v2[2-9]\." >nul
if errorlevel 1 (
  echo       WARNING: Node.js 22 or newer is required by package.json.
)

rem ---------- 2/4 dependencies ----------
if not exist "node_modules" goto do_install
if not exist "node_modules\electron\dist\electron.exe" goto do_install
if not exist "node_modules\node-pty\prebuilds\win32-x64\pty.node" goto do_install
echo [2/4] Dependencies OK
goto deps_ready

:do_install
echo [2/4] Installing dependencies ^(first run: several minutes, needs network^)...
call npm install --no-audit --no-fund
if errorlevel 1 goto install_failed

rem Electron's binary is fetched by its own postinstall. When GitHub is not
rem reachable that step silently fails, so verify and retry via a mirror.
if exist "node_modules\electron\dist\electron.exe" goto deps_ready
echo       Electron binary missing - retrying via npmmirror.com ...
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
call node "node_modules\electron\install.js"
if errorlevel 1 goto install_failed

:deps_ready
if not exist "node_modules\electron\dist\electron.exe" goto install_failed
echo       Electron runtime OK
echo.

rem ---------- 3/4 start ----------
echo [3/4] Starting ycIDE in dev mode...
echo       Close the IDE window to return to this console.
echo.
call npm run dev
set "CODE=%errorlevel%"

rem ---------- 4/4 exit ----------
echo.
if not "%CODE%"=="0" goto run_failed
echo [4/4] ycIDE closed normally.
exit /b 0

:run_failed
echo [ERROR] ycIDE exited with code %CODE%.
echo         Scroll up for the error output.
echo.
pause
exit /b %CODE%

:install_failed
echo.
echo [ERROR] Dependency installation failed.
echo         If the Electron download is blocked, set a mirror and retry:
echo             set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
echo             npm install
echo.
pause
exit /b 1

:no_node
echo [ERROR] Node.js was not found on PATH.
echo         Install Node.js 22 or newer: https://nodejs.org/
echo.
pause
exit /b 1
