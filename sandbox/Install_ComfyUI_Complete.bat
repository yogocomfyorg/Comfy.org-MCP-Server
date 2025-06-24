@echo off
title ComfyUI Complete Installation Script
color 0A

echo.
echo ========================================
echo    ComfyUI Complete Installation Script
echo ========================================
echo.
echo This script will install ComfyUI with customizable options:
echo - Choose your CUDA version
echo - Optional Triton and SageAttention installation
echo - Automatic build tools setup if needed
echo.

REM Get user preferences
echo Please configure your installation:
echo.

REM CUDA Version Selection
echo Available CUDA versions:
echo 1 - CUDA 11.8 (Stable, widely compatible)
echo 2 - CUDA 12.1 (Good balance)
echo 3 - CUDA 12.4 (Recent, good performance)
echo 4 - CUDA 12.6 (Latest, best performance)
echo 5 - CPU Only (No CUDA)
echo.
set /p CUDA_CHOICE=Enter your CUDA version choice (1-5): 

REM Validate CUDA choice
if "%CUDA_CHOICE%"=="1" (
    set CUDA_VERSION=cu118
    set CUDA_NAME=CUDA 11.8
    set PYTORCH_INDEX=https://download.pytorch.org/whl/cu118
)
if "%CUDA_CHOICE%"=="2" (
    set CUDA_VERSION=cu121
    set CUDA_NAME=CUDA 12.1
    set PYTORCH_INDEX=https://download.pytorch.org/whl/cu121
)
if "%CUDA_CHOICE%"=="3" (
    set CUDA_VERSION=cu124
    set CUDA_NAME=CUDA 12.4
    set PYTORCH_INDEX=https://download.pytorch.org/whl/cu124
)
if "%CUDA_CHOICE%"=="4" (
    set CUDA_VERSION=cu126
    set CUDA_NAME=CUDA 12.6
    set PYTORCH_INDEX=https://download.pytorch.org/whl/cu126
)
if "%CUDA_CHOICE%"=="5" (
    set CUDA_VERSION=cpu
    set CUDA_NAME=CPU Only
    set PYTORCH_INDEX=https://download.pytorch.org/whl/cpu
)

if not defined CUDA_VERSION (
    echo Invalid choice. Exiting.
    pause
    exit /b 1
)

echo.
echo Selected: %CUDA_NAME%
echo.

REM Triton and SageAttention options
if not "%CUDA_CHOICE%"=="5" (
    echo Do you want to install Triton and SageAttention for enhanced performance?
    echo This requires build tools and may take longer to install.
    echo.
    echo 1 - Yes, install Triton and SageAttention (Recommended for performance)
    echo 2 - No, basic installation only
    echo.
    set /p TRITON_CHOICE=Enter your choice (1-2): 
    
    if "%TRITON_CHOICE%"=="1" (
        set INSTALL_TRITON=true
        echo.
        echo Triton and SageAttention will be installed.
    ) else (
        set INSTALL_TRITON=false
        echo.
        echo Basic installation selected.
    )
) else (
    set INSTALL_TRITON=false
    echo CPU-only installation - Triton/SageAttention not available.
)

echo.
echo Installation Summary:
echo - CUDA Version: %CUDA_NAME%
echo - Triton/SageAttention: %INSTALL_TRITON%
echo.
set /p CONFIRM=Continue with installation? (Y/N): 
if /i not "%CONFIRM%"=="Y" (
    echo Installation cancelled.
    pause
    exit /b 0
)

echo.
echo ========================================
echo    Starting Installation...
echo ========================================
echo.

REM Create installation directory
set INSTALL_DIR=%~dp0ComfyUI_%CUDA_VERSION%
echo Creating installation directory: %INSTALL_DIR%
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
cd /d "%INSTALL_DIR%"

REM Check for Python
echo Checking Python installation...
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH.
    echo Please install Python 3.10+ and add it to your PATH.
    echo Download from: https://www.python.org/downloads/
    pause
    exit /b 1
)

REM Get Python version
for /f "tokens=2 delims= " %%i in ('python --version') do set PY_VERSION=%%i
echo Found Python %PY_VERSION%

REM Check if build tools are needed and available
if "%INSTALL_TRITON%"=="true" (
    echo.
    echo Checking for build tools (required for Triton/SageAttention)...
    
    REM Check for Visual Studio Build Tools
    where cl >nul 2>&1
    if errorlevel 1 (
        echo.
        echo WARNING: Visual Studio Build Tools not found in PATH.
        echo Triton and SageAttention require C++ build tools.
        echo.
        echo Please install one of the following:
        echo 1. Visual Studio 2019/2022 with C++ workload
        echo 2. Visual Studio Build Tools 2019/2022
        echo 3. Windows SDK with MSVC compiler
        echo.
        echo Download from: https://visualstudio.microsoft.com/downloads/
        echo.
        set /p BUILD_CONTINUE=Continue anyway? Build may fail. (Y/N): 
        if /i not "%BUILD_CONTINUE%"=="Y" (
            echo Installation cancelled. Please install build tools first.
            pause
            exit /b 1
        )
    ) else (
        echo Build tools found - ready for compilation.
    )
)

echo.
echo Cloning ComfyUI repository...
git clone https://github.com/comfyanonymous/ComfyUI.git
if errorlevel 1 (
    echo Failed to clone ComfyUI repository.
    echo Please check your internet connection and git installation.
    pause
    exit /b 1
)

cd ComfyUI

echo.
echo Creating virtual environment...
python -m venv venv
if errorlevel 1 (
    echo Failed to create virtual environment.
    pause
    exit /b 1
)

echo Activating virtual environment...
call venv\Scripts\activate.bat
if errorlevel 1 (
    echo Failed to activate virtual environment.
    pause
    exit /b 1
)

echo.
echo Installing PyTorch with %CUDA_NAME%...
if "%CUDA_CHOICE%"=="5" (
    pip install torch torchvision torchaudio
) else (
    pip install torch torchvision torchaudio --index-url %PYTORCH_INDEX%
)
if errorlevel 1 (
    echo Failed to install PyTorch.
    pause
    exit /b 1
)

echo.
echo Installing ComfyUI requirements...
pip install -r requirements.txt
if errorlevel 1 (
    echo Failed to install ComfyUI requirements.
    pause
    exit /b 1
)

REM Install additional useful packages
echo.
echo Installing additional packages...
pip install pillow opencv-python requests tqdm

echo.
echo ========================================
echo    Basic ComfyUI Installation Complete!
echo ========================================
echo.

REM Install Triton and SageAttention if requested
if "%INSTALL_TRITON%"=="true" (
    echo.
    echo ========================================
    echo    Installing Triton and SageAttention
    echo ========================================
    echo.

    REM Get Python version for Triton wheel selection
    for /f "tokens=1,2 delims=." %%a in ("%PY_VERSION%") do (
        set PY_MAJOR=%%a
        set PY_MINOR=%%b
    )

    REM Get PyTorch version
    for /f "delims=" %%A in ('python -c "import torch; print(torch.__version__)" 2^>nul') do set PYTORCH_VER=%%A
    for /f "tokens=1,2 delims=." %%B in ("%PYTORCH_VER%") do (
        set PT_MAJOR=%%B
        set PT_MINOR=%%C
    )

    echo Detected Python %PY_MAJOR%.%PY_MINOR% and PyTorch %PT_MAJOR%.%PT_MINOR%

    REM Determine compatible Triton version
    set TRITON_URL=
    if "%PT_MAJOR%"=="2" (
        if %PT_MINOR% GEQ 6 (
            echo PyTorch 2.6+ detected - using Triton 3.2.0
            if "%PY_MAJOR%.%PY_MINOR%"=="3.10" set TRITON_URL=https://github.com/woct0rdho/triton-windows/releases/download/v3.2.0-windows.post10/triton-3.2.0-cp310-cp310-win_amd64.whl
            if "%PY_MAJOR%.%PY_MINOR%"=="3.11" set TRITON_URL=https://github.com/woct0rdho/triton-windows/releases/download/v3.2.0-windows.post10/triton-3.2.0-cp311-cp311-win_amd64.whl
            if "%PY_MAJOR%.%PY_MINOR%"=="3.12" set TRITON_URL=https://github.com/woct0rdho/triton-windows/releases/download/v3.2.0-windows.post10/triton-3.2.0-cp312-cp312-win_amd64.whl
        ) else if %PT_MINOR% GEQ 4 (
            echo PyTorch 2.4-2.5 detected - using Triton 3.1.0
            if "%PY_MAJOR%.%PY_MINOR%"=="3.10" set TRITON_URL=https://github.com/woct0rdho/triton-windows/releases/download/v3.1.0-windows.post9/triton-3.1.0-cp310-cp310-win_amd64.whl
            if "%PY_MAJOR%.%PY_MINOR%"=="3.11" set TRITON_URL=https://github.com/woct0rdho/triton-windows/releases/download/v3.1.0-windows.post9/triton-3.1.0-cp311-cp311-win_amd64.whl
            if "%PY_MAJOR%.%PY_MINOR%"=="3.12" set TRITON_URL=https://github.com/woct0rdho/triton-windows/releases/download/v3.1.0-windows.post9/triton-3.1.0-cp312-cp312-win_amd64.whl
        ) else (
            echo WARNING: PyTorch version too old for optimal Triton support
            if "%PY_MAJOR%.%PY_MINOR%"=="3.10" set TRITON_URL=https://github.com/woct0rdho/triton-windows/releases/download/v3.1.0-windows.post9/triton-3.0.0-cp310-cp310-win_amd64.whl
            if "%PY_MAJOR%.%PY_MINOR%"=="3.11" set TRITON_URL=https://github.com/woct0rdho/triton-windows/releases/download/v3.1.0-windows.post9/triton-3.0.0-cp311-cp311-win_amd64.whl
            if "%PY_MAJOR%.%PY_MINOR%"=="3.12" set TRITON_URL=https://github.com/woct0rdho/triton-windows/releases/download/v3.1.0-windows.post9/triton-3.0.0-cp312-cp312-win_amd64.whl
        )
    )

    if defined TRITON_URL (
        echo Installing Triton...
        pip install %TRITON_URL%
        if errorlevel 1 (
            echo WARNING: Triton installation failed. Continuing without Triton.
        ) else (
            echo Triton installed successfully.

            REM Clear Triton cache
            set TRITON_CACHE=%USERPROFILE%\.triton\cache
            set TORCH_CACHE=%TEMP%\torchinductor_%USERNAME%\triton

            if exist "%TRITON_CACHE%" (
                echo Clearing Triton cache...
                rmdir /s /q "%TRITON_CACHE%" 2>nul
                mkdir "%TRITON_CACHE%" 2>nul
            )
            if exist "%TORCH_CACHE%" (
                echo Clearing TorchInductor cache...
                rmdir /s /q "%TORCH_CACHE%" 2>nul
                mkdir "%TORCH_CACHE%" 2>nul
            )
        )
    ) else (
        echo No compatible Triton wheel found for Python %PY_MAJOR%.%PY_MINOR%
    )

    REM Install SageAttention
    echo.
    echo Installing SageAttention...
    echo This may take several minutes and show compilation warnings - this is normal.
    echo.

    cd venv
    git clone https://github.com/thu-ml/SageAttention
    if errorlevel 1 (
        echo Failed to clone SageAttention repository.
        cd ..
    ) else (
        cd SageAttention
        set MAX_JOBS=4
        python -m pip install .
        if errorlevel 1 (
            echo WARNING: SageAttention installation failed.
        ) else (
            echo SageAttention installed successfully.
        )
        cd ..
        rmdir /s /q SageAttention 2>nul
        cd ..
    )
)

echo.
echo ========================================
echo    Creating Launcher Scripts
echo ========================================
echo.

REM Create launcher script
set LAUNCHER_NAME=Launch_ComfyUI_%CUDA_VERSION%.bat
echo Creating launcher: %LAUNCHER_NAME%

(
echo @echo off
echo title ComfyUI %CUDA_NAME% Launcher
echo color 0A
echo.
echo ========================================
echo    ComfyUI %CUDA_NAME% Launcher
echo ========================================
echo.
echo.
echo Changing to ComfyUI directory...
echo cd /d "%INSTALL_DIR%\ComfyUI"
echo.
echo Activating virtual environment...
echo call venv\Scripts\activate.bat
echo.
echo if errorlevel 1 ^(
echo     echo Failed to activate virtual environment.
echo     pause
echo     exit /b 1
echo ^)
echo.
echo echo Starting ComfyUI with %CUDA_NAME%...
echo echo Server will be available at: http://127.0.0.1:8188
echo echo Press Ctrl+C to stop the server
echo echo.
echo.
if "%INSTALL_TRITON%"=="true" (
echo REM Start with optimizations
echo python main.py --fast --windows-standalone-build --use-sage-attention
) else (
echo REM Start basic version
echo python main.py --fast --windows-standalone-build
)
echo.
echo echo.
echo echo ComfyUI stopped.
echo pause
) > "%LAUNCHER_NAME%"

echo Launcher created: %LAUNCHER_NAME%

REM Create ComfyUI Manager installation script
echo.
echo Installing ComfyUI Manager...
cd ComfyUI
if not exist "custom_nodes" mkdir custom_nodes
cd custom_nodes
git clone https://github.com/ltdrdata/ComfyUI-Manager.git
if errorlevel 1 (
    echo WARNING: Failed to install ComfyUI Manager.
) else (
    echo ComfyUI Manager installed successfully.
)
cd ..\..

echo.
echo ========================================
echo    Installation Complete!
echo ========================================
echo.
echo Installation Summary:
echo - Location: %INSTALL_DIR%
echo - CUDA Version: %CUDA_NAME%
echo - Triton/SageAttention: %INSTALL_TRITON%
echo - ComfyUI Manager: Installed
echo.
echo To start ComfyUI:
echo 1. Run: %LAUNCHER_NAME%
echo 2. Open browser to: http://127.0.0.1:8188
echo.
echo Additional Notes:
if "%INSTALL_TRITON%"=="true" (
    echo - First run may take longer due to compilation
    echo - Triton cache has been cleared for clean start
    echo - SageAttention provides memory and speed improvements
)
echo - ComfyUI Manager allows easy custom node installation
echo - Check the ComfyUI documentation for usage guides
echo.
echo Installation log saved to: %INSTALL_DIR%\installation.log
echo.

REM Create installation info file
(
echo ComfyUI Installation Information
echo ================================
echo Installation Date: %DATE% %TIME%
echo Installation Directory: %INSTALL_DIR%
echo CUDA Version: %CUDA_NAME%
echo Python Version: %PY_VERSION%
if defined PYTORCH_VER echo PyTorch Version: %PYTORCH_VER%
echo Triton/SageAttention: %INSTALL_TRITON%
echo.
echo Launcher Script: %LAUNCHER_NAME%
echo ComfyUI Manager: Installed
echo.
echo To start ComfyUI, run: %LAUNCHER_NAME%
echo Web interface: http://127.0.0.1:8188
) > "%INSTALL_DIR%\installation.log"

echo.
echo Press any key to exit...
pause >nul
