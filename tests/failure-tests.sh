#!/bin/bash
set -e

# Simple failure test script for Docker setup
# Usage: ./tests/failure-tests.sh <replica-service-name>

SERVICE=${1:-replica2}

echo "Stopping ${SERVICE}..."
docker compose stop ${SERVICE} || docker compose rm -f ${SERVICE} || true
sleep 5

echo "Starting ${SERVICE}..."
docker compose start ${SERVICE} || docker compose up -d ${SERVICE}
sleep 5

echo "Checking gateway leader state"
curl -s http://localhost:3000/leader | jq '.'

echo "Done"
