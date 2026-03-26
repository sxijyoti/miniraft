@echo off
REM Cross-platform setup script for miniraft (Windows)
REM Works on Windows with Docker Desktop

echo.
echo ===============================================================
echo   Mini-RAFT Setup - Windows Configuration
echo ===============================================================
echo.

echo Detected OS: Windows
echo.

echo Checking prerequisites...
echo.

REM Check Docker
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo X Docker is not installed
    echo   Please install Docker Desktop from https://www.docker.com/products/docker-desktop
    exit /b 1
)
for /f "tokens=*" %%i in ('docker --version') do set DOCKER_VERSION=%%i
echo + %DOCKER_VERSION%

REM Check Docker Compose
docker-compose --version >nul 2>&1
if %errorlevel% neq 0 (
    echo X Docker Compose is not installed
    echo   Docker Desktop usually includes Docker Compose
    exit /b 1
)
for /f "tokens=*" %%i in ('docker-compose --version') do set COMPOSE_VERSION=%%i
echo + %COMPOSE_VERSION%

REM Check Node.js (optional)
node --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
    echo + Node.js %NODE_VERSION%
) else (
    echo ~ Node.js not found (optional - only needed for local development)
)

echo.
echo Setting up environment...
echo.

REM Create .env file if it doesn't exist
if not exist .env (
    copy .env.example .env
    echo + Created .env file from .env.example
    echo   You can customize ports/settings in .env if needed
) else (
    echo + .env file already exists
)

echo.
echo Checking Docker daemon...
docker ps >nul 2>&1
if %errorlevel% neq 0 (
    echo X Docker daemon is not running
    echo   Please start Docker Desktop
    exit /b 1
)
echo + Docker daemon is running

echo.
echo Building Docker images...
echo.

docker-compose build

if %errorlevel% neq 0 (
    echo X Build failed
    exit /b 1
)

echo.
echo ===============================================================
echo   + Setup Complete!
echo ===============================================================
echo.
echo Next steps:
echo.
echo   Start the cluster:
echo     docker-compose up
echo.
echo   View logs:
echo     docker-compose logs -f replica1
echo     docker-compose logs -f replica2
echo     docker-compose logs -f replica3
echo.
echo   Stop the cluster:
echo     docker-compose down
echo.
echo Note: All services run in Docker containers, so the system
echo works identically on Linux, macOS, and Windows.
echo.

pause
