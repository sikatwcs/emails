@echo off
cd /d "%~dp0"
set "SURAT_NODE=node"
"%SURAT_NODE%" --version >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" (
    set "SURAT_NODE=%ProgramFiles%\nodejs\node.exe"
  ) else (
    echo Node.js tidak ditemukan. Periksa instalasi Node.js lalu buka file ini lagi.
    pause
    exit /b 1
  )
)
set "SURAT_NPM=npm"
call "%SURAT_NPM%" --version >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\npm.cmd" (
    set "SURAT_NPM=%ProgramFiles%\nodejs\npm.cmd"
  ) else (
    echo npm tidak ditemukan. Periksa instalasi Node.js lalu buka file ini lagi.
    pause
    exit /b 1
  )
)
if "%SURAT_CHECK_ONLY%"=="1" (
  echo Node.js dan npm ditemukan.
  exit /b 0
)
if not exist node_modules (
  call "%SURAT_NPM%" install
  if errorlevel 1 (
    echo Pemasangan paket gagal.
    pause
    exit /b 1
  )
)
if not exist .env (
  "%SURAT_NODE%" setup.js
  if errorlevel 1 (
    echo Persiapan kata sandi admin gagal.
    pause
    exit /b 1
  )
)
echo.
echo Buka http://localhost:3000 di browser Anda.
echo Tekan Ctrl+C untuk menghentikan web.
echo.
call "%SURAT_NPM%" start
pause
