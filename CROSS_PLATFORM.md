# Cross-Platform Setup Guide

This document ensures miniraft works identically on **Linux, macOS, and Windows**.

## Why Docker?

Docker containerizes the entire application, ensuring identical behavior regardless of host OS. All services run inside containers, so OS differences don't affect the RAFT protocol or networking.

## OS-Specific Installation

### Linux
```bash
# Install Docker
sudo apt-get update
sudo apt-get install docker.io docker-compose

# Add user to docker group (avoid sudo requirement)
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker-compose --version
```

### macOS
1. Download **Docker Desktop** from https://www.docker.com/products/docker-desktop
2. Install and launch
3. Verify in terminal:
```bash
docker --version
docker-compose --version
```

### Windows
1. Download **Docker Desktop** from https://www.docker.com/products/docker-desktop
2. Install (choose WSL 2 backend if available)
3. Launch Docker Desktop
4. Verify in PowerShell or CMD:
```batch
docker --version
docker-compose --version
```

## Setup Scripts

### Option 1: Automated Setup

**Linux/macOS:**
```bash
chmod +x setup.sh
./setup.sh
```

**Windows:**
- Double-click `setup.bat` (or run from PowerShell/CMD)

### Option 2: Manual Setup

```bash
# Copy environment configuration
cp .env.example .env

# Build Docker images
docker-compose build

# Start services
docker-compose up
```

### Option 3: Using Make

If `make` is installed (or via `choco install make` on Windows):
```bash
make setup    # Initial setup
make up       # Start services
make down     # Stop services
make test     # Run tests
```

## Troubleshooting

### Issue: "Docker daemon is not running"
**Solution:**
- **Linux:** `sudo systemctl start docker`
- **macOS:** Launch Docker Desktop from Applications
- **Windows:** Launch Docker Desktop from Start Menu

### Issue: "Port already in use (macOS)"
**Solution:**
macOS sometimes reserves certain ports. If you see port conflicts:
1. Edit `.env` file and change ports:
   ```
   GATEWAY_PORT=8080
   REPLICA1_PORT=8001
   REPLICA2_PORT=8002
   REPLICA3_PORT=8003
   ```
2. Update `docker-compose.yml` ports section to match
3. Restart: `docker-compose down && docker-compose up`

### Issue: "Permission denied" (Linux)
**Solution:**
```bash
sudo usermod -aG docker $USER
# Log out and back in, or:
newgrp docker
```

### Issue: "Docker not found on Windows"
**Solution:**
- Ensure Docker Desktop is installed and running
- Restart your terminal/PowerShell after installing
- Use PowerShell or Command Prompt (not Git Bash) if on older Windows

### Issue: "Cannot connect to Docker daemon"
**Solution:**
All platforms:
1. Ensure Docker Desktop is running (check system tray)
2. On Windows, ensure WSL 2 is properly installed:
   ```powershell
   wsl --list --verbose
   wsl --set-default-version 2
   ```
3. Restart Docker Desktop

## Verified On

- ✅ **Linux** (Ubuntu 20.04+, Debian, Fedora)
- ✅ **macOS** (Monterey, Ventura, Sonoma - Intel & Apple Silicon)
- ✅ **Windows** (Windows 10/11 with WSL 2)

## Port Compatibility

All ports used (3000, 4001, 4002, 4003) are standard development ports and should work on all platforms.

**Note:** Port 5000 is explicitly avoided due to conflicts on macOS (reserved by AirPlay).

## Environment Variables

The `.env` file controls all configuration:

```env
# Gateway
GATEWAY_PORT=3000
GATEWAY_HOST=0.0.0.0

# Replicas
REPLICA1_PORT=4001
REPLICA2_PORT=4002
REPLICA3_PORT=4003

# Internal networking (container names)
REPLICA1_URL=http://replica1:4001
REPLICA2_URL=http://replica2:4002
REPLICA3_URL=http://replica3:4003

# Logging
DEBUG=false       # or 'raft' for detailed logs

# Node environment
NODE_ENV=development
```

## Common Commands (All Platforms)

```bash
# Start services
docker-compose up -d                 # Detached mode

# View logs
docker-compose logs -f               # All services
docker-compose logs -f replica1      # Specific service

# Execute commands in container
docker-compose exec replica1 sh      # Shell access

# Check service status
docker-compose ps

# Stop services
docker-compose down

# Remove all containers and volumes
docker-compose down -v

# Rebuild images after code changes
docker-compose build
docker-compose up
```

## Using Make (Recommended)

Make is available on all platforms (install with package manager or `choco install make`):

```bash
make help        # Show all commands
make setup       # Initial setup
make up          # Start services
make down        # Stop services
make logs        # Follow logs
make test        # Run tests
make restart     # Restart services
make clean       # Clean up
```

## Networking in Docker

- **Container-to-Container:** Use service names (e.g., `http://replica1:4001`)
- **Host-to-Container:** Use localhost (e.g., `http://localhost:3000`)
- **Cross-Platform:** All container names resolve identically on all OSes

## Network Diagram

```
┌─────────────────────────────────────────────────────┐
│         Docker Network (raft-network)               │
│                                                      │
│  ┌───────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Gateway   │  │ Replica1 │  │ Replica2 │        │
│  │ :3000     │  │ :4001    │  │ :4002    │        │
│  └─────┬─────┘  └────┬─────┘  └────┬─────┘        │
│        │             │             │               │
│        └─────────────┼─────────────┘               │
│                      │                             │
│              ┌───────┴────────┐                   │
│              │ Replica3 :4003 │                   │
│              └────────────────┘                   │
│                                                   │
└─────────────────────────────────────────────────────┘
        ↕ (Docker port mapping)
┌─────────────────────────────────────────────────────┐
│           Host Machine (Any OS)                     │
│   localhost:3000, localhost:4001, etc.              │
└─────────────────────────────────────────────────────┘
```

## Performance Notes

- **Linux:** Native Docker, best performance
- **macOS:** Virtualized Docker Desktop, ~5-10% overhead
- **Windows (WSL 2):** Virtualized, ~5-10% overhead

For RAFT consensus (which is network-bound), these differences are negligible.

## Support

For issues specific to your OS:
1. Check prerequisites are installed
2. Ensure Docker daemon is running
3. Run `docker-compose ps` to check container status
4. Check logs: `docker-compose logs <service-name>`

All team members should get identical behavior after setup.
