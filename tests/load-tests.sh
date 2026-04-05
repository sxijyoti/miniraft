#!/bin/bash
set -e

# Run simple load test: spawn multiple websocket clients that send strokes
# Usage: ./tests/load-tests.sh [clients] [interval_ms]

CLIENTS=${1:-5}
INTERVAL=${2:-500}

echo "Starting ${CLIENTS} clients, interval ${INTERVAL}ms"
node tests/load-client.js ${CLIENTS} ${INTERVAL}
