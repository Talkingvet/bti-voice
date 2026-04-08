@echo off
REM ============================================================
REM  BTI Voice – Windows Desktop Build Script
REM  Run from the bti-voice\electron folder
REM  Prerequisites: Node.js installed
REM ============================================================

echo.
echo  Building BTI Voice Desktop App for Windows...
echo.

REM Step 1: Install electron dependencies
echo [1/3] Installing Electron dependencies...
call npm install
if errorlevel 1 ( echo ERROR: npm install failed & pause & exit /b 1 )

REM Step 2: Create icons
echo [2/3] Generating icons...
call node create-icons.js
if errorlevel 1 ( echo WARNING: Icon creation failed - using placeholder icons )

REM Step 3: Build Windows installer
echo [3/3] Building Windows installer (.exe)...
call npm run build:win
if errorlevel 1 ( echo ERROR: Electron build failed & pause & exit /b 1 )

echo.
echo  Build complete!
echo  Installer is in: bti-voice\dist-electron\
echo.
pause
