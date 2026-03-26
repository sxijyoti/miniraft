#!/bin/bash

# Test Script for RAFT Core Implementation
# Verifies basic RAFT functionality

set -e

GATEWAY_URL="http://localhost:3000"
REPLICA1_URL="http://localhost:4001"
REPLICA2_URL="http://localhost:4002"
REPLICA3_URL="http://localhost:4003"

echo "=========================================="
echo "RAFT Core Implementation Test"
echo "=========================================="
echo ""

# Helper function
check_endpoint() {
  local url=$1
  local name=$2
  
  response=$(curl -s -o /dev/null -w "%{http_code}" "$url/health")
  if [ "$response" = "200" ]; then
    echo "✓ $name is healthy"
    curl -s "$url/health" | jq '.'
    return 0
  else
    echo "✗ $name is not responding (HTTP $response)"
    return 1
  fi
}

echo "Test 1: Check all services are running"
echo "========================================"
check_endpoint "$GATEWAY_URL" "Gateway"
check_endpoint "$REPLICA1_URL" "Replica 1"
check_endpoint "$REPLICA2_URL" "Replica 2"
check_endpoint "$REPLICA3_URL" "Replica 3"
echo ""

echo "Test 2: Check cluster state"
echo "========================================"
echo "Replica 1 State:"
curl -s "$REPLICA1_URL/state" | jq '.role, .currentTerm, .leaderId'
echo ""
echo "Replica 2 State:"
curl -s "$REPLICA2_URL/state" | jq '.role, .currentTerm, .leaderId'
echo ""
echo "Replica 3 State:"
curl -s "$REPLICA3_URL/state" | jq '.role, .currentTerm, .leaderId'
echo ""

echo "Test 3: Verify leader election"
echo "========================================"
leader=$(curl -s "$REPLICA1_URL/state" | jq -r '.leaderId')
if [ ! -z "$leader" ] && [ "$leader" != "null" ]; then
  echo "✓ Leader detected: $leader"
else
  echo "⚠ No leader detected yet (may still be electing)"
fi
echo ""

echo "Test 4: Verify RequestVote RPC"
echo "========================================"
response=$(curl -s -X POST "$REPLICA1_URL/rpc/request-vote" \
  -H "Content-Type: application/json" \
  -d '{
    "term": 10,
    "candidateId": "test-candidate",
    "lastLogIndex": 0,
    "lastLogTerm": 0
  }')
echo "Response: $response"
echo "$response" | jq '.'
echo ""

echo "Test 5: Verify Heartbeat RPC"
echo "========================================"
response=$(curl -s -X POST "$REPLICA1_URL/rpc/heartbeat" \
  -H "Content-Type: application/json" \
  -d '{
    "term": 10,
    "leaderId": "test-leader"
  }')
echo "Response: $response"
echo "$response" | jq '.'
echo ""

echo "Test 6: Verify AppendEntries RPC"
echo "========================================"
response=$(curl -s -X POST "$REPLICA1_URL/rpc/append-entries" \
  -H "Content-Type: application/json" \
  -d '{
    "term": 10,
    "leaderId": "test-leader",
    "entries": [
      {"type": "test", "data": "test entry"}
    ]
  }')
echo "Response: $response"
echo "$response" | jq '.'
echo ""

echo "Test 7: Verify SyncLog RPC"
echo "========================================"
response=$(curl -s -X POST "$REPLICA1_URL/rpc/sync-log" \
  -H "Content-Type: application/json" \
  -d '{
    "term": 10,
    "leaderId": "test-leader",
    "fromIndex": 0,
    "log": [
      {"type": "test", "data": "synced entry"}
    ]
  }')
echo "Response: $response"
echo "$response" | jq '.'
echo ""

echo "=========================================="
echo "Tests Complete!"
echo "=========================================="
echo ""
echo "Note: Check docker logs for detailed RAFT behavior:"
echo "  docker-compose logs replica1"
echo "  docker-compose logs replica2"
echo "  docker-compose logs replica3"
echo ""
