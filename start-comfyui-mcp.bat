@echo off
title ComfyUI MCP Server
color 0A

echo.
echo ========================================
echo    ComfyUI MCP Server Launcher
echo ========================================
echo.

REM Change to the ComfyUI MCP directory
cd /d "C:\Users\RAIIN Studios\Documents\MCP\ComfyUI_MCP"

REM Check if the build directory exists
if not exist "build\index.js" (
    echo ERROR: Build files not found!
    echo Please run 'npm run build' first.
    echo.
    pause
    exit /b 1
)

REM Check if Node.js is available
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found!
    echo Please install Node.js and add it to your PATH.
    echo.
    pause
    exit /b 1
)

echo Starting ComfyUI MCP Server...
echo Server will run on stdio transport
echo Press Ctrl+C to stop the server
echo.

REM Start the server
node build\index.js

echo.
echo Server stopped.
pause
