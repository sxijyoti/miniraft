 # DoodleDock (miniraft)

 Lightweight, production-oriented real-time collaborative drawing backed by a small RAFT-based cluster. The repository contains a WebSocket gateway, three RAFT replica nodes, and a static frontend that together provide a resilient drawing experience for multiple simultaneous clients.

 Key points:
 - Real-time canvas updates over WebSocket (gateway)
 - Fault-tolerant replication and leader election using RAFT (replicas)
 - Gateway routes client strokes to the current leader and broadcasts committed strokes back to clients
 - Docker Compose + Makefile for easy local orchestration and development

<img width="1470" height="808" alt="image" src="https://github.com/user-attachments/assets/678f9979-af6e-4a6d-a805-2d4388c78d68" />

 ---

 ## Quickstart (recommended)

 Prerequisites:
 - Docker & Docker Compose (or Docker Desktop)

 1. Copy sample environment file and adjust if needed:

   ```bash
   cp .env.example .env
   # edit .env as needed
   ```

 2. Build and start the cluster (recommended):

   ```bash
   make setup    # builds images
   make up       # starts gateway + replica1/2/3
   ```

   Or directly with Docker Compose:

   ```bash
   docker compose up --build
   # or: docker-compose up --build
   ```

 3. Open the frontend at: http://localhost:3000

 4. Stop the cluster when finished:

   ```bash
   make down
   # or: docker compose down
   ```

 Notes:
 - The gateway serves the static frontend from `src/frontend` and exposes a WebSocket server for client connections.
 - The Docker images use `DEV_MODE=true` (in `docker-compose.yml`) to enable `nodemon` for fast iteration when editing `src/`.

 ---

 ## Running components individually (development)

 You can run gateway and replicas directly with Node for faster debugging.

 Start the gateway (example):

 ```bash
 # point the gateway at your running replicas
 REPLICA_ENDPOINTS="http://localhost:4001,http://localhost:4002,http://localhost:4003" PORT=3000 npm run start:gateway
 ```

 Start a replica (example for replica 1):

 ```bash
 REPLICA_ID=1 PORT=4001 PEERS="http://localhost:4002,http://localhost:4003" npm run start:replica
 ```

 Tips:
 - If you run services locally (not in Docker), ensure the `REPLICA_ENDPOINTS` (gateway) and `PEERS` (replicas) point to the correct hosts/ports.
 - The gateway will serve `src/frontend` on `/` so you can open `http://localhost:3000` while running the gateway locally.

 ---

 ## Project layout

 Top-level folders and their purpose:

 ```
 .
 ├── src/
 │   ├── gateway/            # Gateway: HTTP + WebSocket server
 │   ├── replica/            # Replica node (RAFT participant)
 │   └── replicas/common/    # RAFT internals (state, election, replication)
 ├── replica1/               # Replica1 container source (used by Docker Compose)
 ├── replica2/               # Replica2 container source
 ├── replica3/               # Replica3 container source
 ├── infra/docker/           # Dockerfiles for gateway and replicas
 ├── docker-compose.yml      # Orchestration for local cluster
 ├── Makefile                # Convenience commands (build, up, down, logs, test)
 └── src/frontend/           # Static frontend (served by gateway)
 ```

 Key files:
 - `src/gateway/server.js` — HTTP routes, health, `POST /commit`, static file serving, and WebSocket initialization
 - `src/gateway/websocket.js` — WebSocket handling, client queueing when leader unavailable
 - `src/gateway/leaderRouter.js` — Routes commands to leader replica and discovers leader
 - `src/replica/server.js` — Replica API: `/rpc/*`, `/command`, state endpoints
 - `src/replicas/common/*` — RAFT algorithm components (state, election, replication)
 - `src/frontend/index.html` — Frontend UI (canvas, toolbar, websocket client)
 - `src/frontend/canvas.js` — Canvas drawing engine (undo, eraser, stroke history)

 ---

 ## APIs & Protocols

 Gateway (HTTP):
 - `GET /health` — basic health check
 - `GET /leader` — returns the currently known leader (URL)
 - `POST /commit` — leader posts committed entries here; gateway will broadcast them to connected clients
 - `GET /cluster` — configured replica endpoints
 - `GET /clients` — number of connected websocket clients

 Gateway (WebSocket):
 - Clients connect over WebSocket (example client uses `ws://<host>/`).
 - Client -> gateway messages: JSON objects with `type: 'stroke'` and payload `{ points: [...], color, timestamp }`.
 - Gateway broadcasts committed strokes back to clients as `{ type: 'stroke', points, color, timestamp }`.
 - When the gateway cannot reach a leader it will enqueue strokes and respond to client with `{ type: 'queued', message: 'stroke queued, will retry' }`.
 - Gateway also sends informational messages (e.g. `type: 'leader'` when leader changes).

 Replica (HTTP):
 - `GET /health` — replica health and basic state
 - `GET /state` — detailed replica state (role, term, log length)
 - `POST /command` — write path accepted only by leader (used by gateway/clients via leaderRouter)
 - `POST /rpc/request-vote` — RAFT voting endpoint
 - `POST /rpc/append-entries` — RAFT log replication endpoint

 Message structure (example stroke):

 ```json
 {
  "type": "stroke",
  "points": [{"x":10,"y":15}, ...],
  "color": "#000000",
  "timestamp": 1680000000000
 }
 ```

 ---

 ## Testing & Utilities

 - Run RAFT smoke tests: `npm run test:smoke` or `make test` (runs `test-raft.sh` when present)
 - Use `docker compose logs -f gateway` or `make logs-gateway` to tail gateway logs
 - Health checks: `make health` (uses `curl` inside containers via `docker-compose exec`)

 ---

 ## Development notes

 - The Docker images include `nodemon` and will automatically reload Node services when `DEV_MODE` is set to `true` (see `docker-compose.yml`).
 - The gateway statically serves files from `src/frontend`, so editing frontend assets and restarting the gateway (or using `nodemon`) is sufficient for most UI changes.
 - The gateway maintains a small in-memory queue to hold strokes when there is no available leader; queued items are flushed periodically.

 ---

 ## Contributing

 - Fork the repository and open a pull request with a clear description.
 - Run unit/integration tests where applicable and ensure Docker Compose runs locally.
 - Add documentation updates to this README or `docs/` as needed.

 ---

