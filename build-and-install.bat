@echo off
setlocal EnableExtensions

pushd "%~dp0"
if errorlevel 1 (
    echo [ERROR] Unable to open the project folder.
    exit /b 1
)

:menu
cls
echo ========================================
echo       Virtual Whip - Local management
echo ========================================
echo.
echo [C] Build the VSIX file and the installer
echo [I] Build and install the extension
echo [U] Uninstall the extension
echo [Q] Quit
echo.
choice /C CIUQ /N /M "Choice: "
if errorlevel 4 goto :success
if errorlevel 3 goto :uninstall
if errorlevel 2 goto :install
if errorlevel 1 goto :package

:package
call :build_vsix
if errorlevel 1 goto :error
echo.
echo VSIX built successfully:
echo %VSIX_PATH%
goto :done

:install
call :build_vsix
if errorlevel 1 goto :error
echo.
echo Installing the extension into VS Code...
call code --install-extension "%VSIX_PATH%" --force
if errorlevel 1 goto :error
echo.
echo Extension installed. Restart VS Code if needed.
goto :done

:uninstall
echo.
echo Uninstalling the extension local.virtual-whip...
call code --uninstall-extension local.virtual-whip
if errorlevel 1 goto :error
echo Extension uninstalled.
goto :done

:build_vsix
echo [1/4] Installing the extension dependencies...
call npm install
if errorlevel 1 exit /b 1

echo [2/4] Compiling the extension and the native overlay...
call npm run compile
if errorlevel 1 exit /b 1

echo [3/4] Building the VSIX package...
del /q "%~dp0*.vsix" >nul 2>&1
call npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository --skip-license
if errorlevel 1 exit /b 1

echo [4/4] Building the standalone installer install-virtual-whip.bat...
call node scripts\make-installer.js
if errorlevel 1 exit /b 1

set "VSIX_PATH="
for /f "delims=" %%F in ('powershell -NoProfile -Command "(Get-ChildItem -LiteralPath '%~dp0' -Filter '*.vsix' | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName"') do set "VSIX_PATH=%%F"
if not defined VSIX_PATH (
    echo [ERROR] No VSIX file was generated.
    exit /b 1
)
exit /b 0

:done
echo.
pause
goto :menu

:error
echo.
echo [ERROR] The operation failed. See the message above.
pause
goto :menu

:success
popd
exit /b 0
