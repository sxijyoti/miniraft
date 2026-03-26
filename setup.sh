#!/bin/bash
# Cross-platform setup script for miniraft
# Works on Linux, macOS, and Windows (WSL/Git Bash)

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "  Mini-RAFT Setup - Cross-Platform Configuration"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Detect OS
OS="Unknown"
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="Linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macOS"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    OS="Windows"
fi

echo "Detected OS: $OS"
echo ""

# Check prerequisites
echo "Checking prerequisites..."
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed"
    echo "   Please install Docker Desktop from https://www.docker.com/products/docker-desktop"
    exit 1
fi
echo "✓ Docker $(docker --version)"

# Check Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed"
    echo "   Docker Desktop usually includes Docker Compose"
    exit 1
fi
echo "✓ Docker Compose $(docker-compose --version)"

# Check Node.js (for local development, not required for Docker)
if command -v node &> /dev/null; then
    echo "✓ Node.js $(node --version)"
else
    echo "⚠ Node.js not found (optional - only needed for local development)"
fi

echo ""
echo "Setting up environment..."
echo ""

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✓ Created .env file from .env.example"
    echo "  You can customize ports/settings in .env if needed"
else
    echo "✓ .env file already exists"
fi

echo ""
echo "Checking Docker daemon..."
if ! docker ps &> /dev/null; then
    echo "❌ Docker daemon is not running"
    echo "   Please start Docker Desktop or the Docker service"
    exit 1
fi
echo "✓ Docker daemon is running"

echo ""
echo "Building Docker images..."
echo ""

# Build images
docker-compose build

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ Setup Complete!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo ""
echo "  Start the cluster:"
echo "    docker-compose up"
echo ""
echo "  View logs:"
echo "    docker-compose logs -f replica1"
echo "    docker-compose logs -f replica2"
echo "    docker-compose logs -f replica3"
echo ""
echo "  Run tests:"
echo "    ./test-raft.sh"
echo ""
echo "  Stop the cluster:"
echo "    docker-compose down"
echo ""
echo "Note: All services run in Docker containers, so the system"
echo "works identically on Linux, macOS, and Windows."
echo ""
