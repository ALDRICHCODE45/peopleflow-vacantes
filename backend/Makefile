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
#   make gate-build    # WS7A GREEN: real gate, JSON receipt under quality/receipts/
#   make gate-arch     # WS7B: archguard repository guards (task 7.2 REFACTOR)
#   make closure-gate  # WS7A GREEN: all required gates in sequence
#   make closure-report # CE-04: generate the docs/ closure report artifacts (GO/NO-GO)

GOOSE ?= go tool goose
SQLC  ?= go tool sqlc

CLOSURE_STUB := bash scripts/closure/gate
GATES := gate-build gate-vet gate-fmt gate-unit gate-race \
	gate-integration gate-migrations gate-sqlc gate-arch closure-gate

.PHONY: db-up db-down db-migrate db-status db-new sqlc run test test-integration build vet closure-report $(GATES)

db-up:
	docker compose up -d

db-down:
	docker compose down

db-migrate:
	$(GOOSE) up

db-status:
	$(GOOSE) status

db-new:
	@if [ -z "${NAME}" ]; then \
		echo "usage: make db-new NAME=add_foo"; exit 1; \
	fi
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

# WS7A GREEN — every gate target runs the real check via scripts/closure/gate,
# which captures output, scans test counts and emitted skips, and writes one
# machine-readable JSON receipt (quality/receipts/<gate>.json) while mirroring
# the check's exit status. The RED pass-through stub (gate-stub.sh) is kept as
# historical RED evidence.
$(GATES):
	$(CLOSURE_STUB) $@

# CE-04: the report driver is a first-class Make target, deliberately NOT part of
# $(GATES) — closure-gate invokes it after the nine sub-gates, and it must never
# become a tenth evidence gate or enter the aggregate gate set.
closure-report:
	go run ./cmd/closure-report