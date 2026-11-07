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
#   make test          # unit tests: make test PKG=./internal/foo/... RUN='^TestBar$' [COUNT=4] [TIMEOUT=300s]
#   make test-integration # integration tests (loads .env, -p 1), same PKG/RUN/TIMEOUT knobs
#   make build         # go build ./...
#   make vet           # go vet ./...
#   make gate-build    # WS7A GREEN: real gate, JSON receipt under quality/receipts/
#   make gate-arch     # WS7B: archguard repository guards (task 7.2 REFACTOR)
#   make closure-gate  # WS7A GREEN: all required gates in sequence
#   make closure-report # CE-04: generate the docs/ closure report artifacts (GO/NO-GO)

GOOSE ?= go tool goose
SQLC  ?= go tool sqlc

CLOSURE_STUB := bash scripts/closure/gate
# Gates that run tests go through the test queue; the others only build or diff.
QUEUED_GATES := gate-unit gate-race gate-integration gate-migrations gate-arch closure-gate
PLAIN_GATES := gate-build gate-vet gate-fmt gate-sqlc
GATES := $(PLAIN_GATES) $(QUEUED_GATES)

# Test commands run through the machine-wide queue named by RUN_TESTS (set to
# `run-tests` only on the developer PC; empty in CI, where commands run as is).
# The queued command runs with RUN_TESTS unset so tests that call make
# themselves (scripts/closure) never queue again behind their own slot.
RUN_TESTS ?=
TEST_QUEUE = $(if $(strip $(RUN_TESTS)),$(RUN_TESTS) env -u RUN_TESTS)

# Focus knobs for the test targets. $(value ...) keeps `$` in -run regexes literal.
PKG ?= ./...
RUN ?=
TIMEOUT ?=
COUNT ?= 1
TEST_FLAGS = $(if $(value RUN),-run '$(value RUN)') $(if $(TIMEOUT),-timeout $(TIMEOUT))

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

.PHONY: geo-import geo-reduce
# Explicit environment only: geoimport never loads .env.
geo-import:
	go run ./cmd/geoimport $(GEO_ARGS)

# RAW is the directory layout documented in db/geo/README.md.
geo-reduce:
	test -n "$(RAW)" || (echo 'usage: make geo-reduce RAW=/path/to/raw'; exit 1)
	go run ./cmd/geoimport -reduce "$(RAW)" -dir db/geo

run:
	go run ./cmd/api

test:
	$(TEST_QUEUE) go test -p 4 -count=$(COUNT) $(TEST_FLAGS) $(PKG)

# Integration tests share one database, so they stay serial (-p 1).
test-integration:
	set -a && . ./.env && set +a && $(TEST_QUEUE) go test -tags=integration -p 1 -count=$(COUNT) -v $(TEST_FLAGS) $(PKG)

build:
	go build ./...

vet:
	go vet ./...

# WS7A GREEN — every gate target runs the real check via scripts/closure/gate,
# which captures output, scans test counts and emitted skips, and writes one
# machine-readable JSON receipt (quality/receipts/<gate>.json) while mirroring
# the check's exit status. The RED pass-through stub (gate-stub.sh) is kept as
# historical RED evidence.
$(PLAIN_GATES):
	$(CLOSURE_STUB) $@

$(QUEUED_GATES):
	$(TEST_QUEUE) $(CLOSURE_STUB) $@

# CE-04: the report driver is a first-class Make target, deliberately NOT part of
# $(GATES) — closure-gate invokes it after the nine sub-gates, and it must never
# become a tenth evidence gate or enter the aggregate gate set.
closure-report:
	go run ./cmd/closure-report