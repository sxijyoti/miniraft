# miniraft
Distributed Real Time Drawing Board

A fault-tolerant, multi-replica drawing application using RAFT consensus protocol for distributed state management.

**Cross-platform compatible:** Works identically on Linux, macOS, and Windows. See [CROSS_PLATFORM.md](./CROSS_PLATFORM.md) for setup details.

## Project Structure

```
miniraft/
├── src/
│   ├── gateway/
│   │   └── server.js          # WebSocket gateway for clients
│   ├── replica/
│   │   └── server.js          # RAFT replica node (enhanced with consensus)
│   └── replicas/common/       # Shared RAFT modules
│       ├── raftState.js       # State management & transitions
│       ├── electionTimeout.js # Election timeout (500-800ms)
│       ├── election.js        # Leader election logic
│       ├── logger.js          # Structured logging
│       └── constants.js       # Protocol constants
├── infra/docker/
│   ├── Dockerfile.gateway     # Gateway container
│   └── Dockerfile.replica     # Replica container
├── docker-compose.yml         # Multi-container orchestration
├── RAFT_IMPLEMENTATION.md     # Detailed RAFT documentation
└── test-raft.sh              # RPC endpoint tests
```

## RAFT Implementation (Student B)

The system implements a simplified RAFT consensus protocol with the following features:

### Core Features

- **Leader Election**: Automatic election with 500-800ms timeout
- **Term Management**: Higher terms override previous leaders
- **Vote Safety**: Majority-based voting (≥2 out of 3 replicas)
- **Heartbeat Mechanism**: Leaders send 150ms heartbeats to prevent elections
- **State Replication**: Append-only log with majority commit rule
- **Catch-up Protocol**: Restarted nodes sync via `/sync-log` RPC

### RAFT Modules

| Module | Purpose |
|--------|---------|
| `raftState.js` | Persistent state management with safe transitions |
| `electionTimeout.js` | Random 500-800ms election timeout |
| `election.js` | Candidate state machine and vote collection |
| `logger.js` | Structured logging with timestamps |
| `constants.js` | RAFT protocol constants (timeouts, quorum size) |

### RPC Endpoints

- `POST /rpc/request-vote` - Election voting
- `POST /rpc/heartbeat` - Leader liveness
- `POST /rpc/append-entries` - Log replication
- `POST /rpc/sync-log` - Catch-up for restarted nodes

### Health Endpoints

- `GET /health` - Node state snapshot
- `GET /state` - Node state with peer information

## Deployment (Cross-Platform)

### Prerequisites
- Docker Desktop (includes Docker & Docker Compose)
  - Linux: https://docs.docker.com/engine/install/
  - macOS: https://www.docker.com/products/docker-desktop
  - Windows: https://www.docker.com/products/docker-desktop

### Initial Setup

**Linux/macOS:**
```bash
./setup.sh
```

**Windows (PowerShell or CMD):**
```batch
setup.bat
```

**Or with Make (all platforms):**
```bash
make setup
```

### Run Services

**Using Docker Compose:**
```bash
docker-compose up                    # Start all services
docker-compose down                  # Stop all services
docker-compose logs -f replica1      # View replica1 logs
docker-compose logs -f replica2      # View replica2 logs
docker-compose logs -f replica3      # View replica3 logs
```

**Using Make (all platforms):**
```bash
make up              # Start services
make down            # Stop services
make logs            # Show all logs
make logs-replica1   # Show replica1 logs
make test            # Run tests
make restart         # Restart services
make clean           # Remove containers and volumes
make help            # Show all commands
```

### Test RPC Endpoints

```bash
./test-raft.sh
```

### Configuration

All configuration is in `.env` file (created from `.env.example` during setup):
- **Ports**: GATEWAY_PORT, REPLICA*_PORT (default: 3000, 4001, 4002, 4003)
- **Logging**: DEBUG (set to 'raft' for detailed logs)
- **Environment**: NODE_ENV (development/production)

## Team Responsibilities

**Completed:**
- Infrastructure & Networking (docker-compose, Dockerfiles)
- RAFT Core & API (consensus, elections, heartbeats)

**Data Replication Implementation** (log replication, commit logic)

**In Development:**
- Gateway & Frontend (dashboard, drawing canvas, tests)

## Documentation

See `RAFT_IMPLEMENTATION.md` for:
- Detailed module documentation
- State machine diagrams
- RPC specification
- Integration points for other teams
- Testing procedures

