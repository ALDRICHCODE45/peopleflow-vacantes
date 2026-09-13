# Makefile for the backend (run from backend/).
#
# Local dev workflow relies on backend/.env (loaded automatically by `goose` and
# by godotenv in cmd/api/main.go). The targets below wrap the exact commands
# the project uses; no env exports are required.
#
# Available targets:
#   make db-up         # docker compose up -d (Postgres 16)
#   make db-down       # docker compose down
#   make db-migrate    # local/manual external-goose workflow, not closure evidence
#   make db-status     # local/manual external-goose workflow, not closure evidence
#   make db-new        # create a new migration file: make db-new NAME=add_foo
#   make sqlc          # regenerate sqlc code from db/queries/*.sql
#   make run           # run the API server (loads .env via godotenv)
#   make test          # go test ./... -count=1
#   make build         # go build ./...
#   make vet           # go vet ./...
#   make gate-build    # WS7A RED scaffold: pass-through stub (no real check)
#   make closure-gate  # WS7A RED scaffold: pass-through stub (no real check)

GOOSE ?= go tool goose
SQLC  ?= go tool sqlc

CLOSURE_STUB := bash scripts/closure/gate-stub.sh
GATES := gate-build gate-vet gate-fmt gate-unit gate-race \
	gate-integration gate-migrations gate-sqlc closure-gate

.PHONY: db-up db-down db-migrate db-status db-new sqlc run test test-integration build vet $(GATES)

db-up:
	docker compose up -d

db-down:
	docker compose down

db-migrate:
	$(GOOSE) up

db-status:
	$(GOOSE) status

db-new:
	@if [ -z "${NAME}" ]; then echo "usage: make db-new NAME=add_foo"; exit 1; fi
	$(GOOSE) create ${NAME} sql

sqlc:
	$(SQLC) generate

run:
	go run ./cmd/api

test:
	go test ./... -count=1

test-integration:
	set -a && . ./.env && set +a && go test -tags=integration -p 1 ./... -count=1 -v

build:
	go build ./...

vet:
	go vet ./...

# WS7A RED scaffolds — every gate target delegates to the pass-through stub,
# which emits a deterministic JSON pass receipt and exits 0 without running any
# check. Task 7.1 GREEN replaces the delegation with real scripts.
$(GATES):
	$(CLOSURE_STUB) $@