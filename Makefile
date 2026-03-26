# Cross-platform Makefile for miniraft
# Works on Linux, macOS, and Windows (with make installed)

.PHONY: help setup build up down logs logs-replica1 logs-replica2 logs-replica3 logs-gateway test restart clean

help:
	@echo "Mini-RAFT - Cross-Platform Docker Development"
	@echo ""
	@echo "Available commands:"
	@echo "  make setup           - Initial setup (build Docker images)"
	@echo "  make build           - Build Docker images"
	@echo "  make up              - Start all services"
	@echo "  make down            - Stop all services"
	@echo "  make logs            - Show all logs (follow)"
	@echo "  make logs-replica1   - Show replica1 logs (follow)"
	@echo "  make logs-replica2   - Show replica2 logs (follow)"
	@echo "  make logs-replica3   - Show replica3 logs (follow)"
	@echo "  make logs-gateway    - Show gateway logs (follow)"
	@echo "  make test            - Run RAFT tests"
	@echo "  make restart         - Restart all services"
	@echo "  make clean           - Remove containers and volumes"
	@echo "  make help            - Show this help message"
	@echo ""

setup:
	docker-compose build
	@echo ""
	@echo "✓ Setup complete. Run 'make up' to start services"

build:
	docker-compose build

up:
	docker-compose up

down:
	docker-compose down

logs:
	docker-compose logs -f

logs-replica1:
	docker-compose logs -f replica1

logs-replica2:
	docker-compose logs -f replica2

logs-replica3:
	docker-compose logs -f replica3

logs-gateway:
	docker-compose logs -f gateway

test:
	@echo "Running RAFT tests..."
	@if [ -f test-raft.sh ]; then \
		bash test-raft.sh; \
	else \
		echo "test-raft.sh not found"; \
	fi

restart:
	docker-compose restart

clean:
	docker-compose down -v
	@echo "✓ Containers and volumes removed"

ps:
	docker-compose ps

shell-replica1:
	docker-compose exec replica1 /bin/sh

shell-replica2:
	docker-compose exec replica2 /bin/sh

shell-replica3:
	docker-compose exec replica3 /bin/sh

shell-gateway:
	docker-compose exec gateway /bin/sh

health:
	@echo "Checking service health..."
	@docker-compose exec -T gateway curl -s http://localhost:3000/health | jq . || echo "Gateway unavailable"
	@docker-compose exec -T replica1 curl -s http://localhost:4001/health | jq . || echo "Replica1 unavailable"
	@docker-compose exec -T replica2 curl -s http://localhost:4002/health | jq . || echo "Replica2 unavailable"
	@docker-compose exec -T replica3 curl -s http://localhost:4003/health | jq . || echo "Replica3 unavailable"
