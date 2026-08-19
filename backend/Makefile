# Makefile for the backend (run from backend/).
#
# Local dev workflow relies on backend/.env (loaded automatically by `goose` and
# by godotenv in cmd/api/main.go). The targets below wrap the exact commands
# the project uses; no env exports are required.
#
# Available targets:
#   make db-up         # docker compose up -d (Postgres 16)
#   make db-down       # docker compose down
#   make db-migrate    # apply all pending goose migrations (reads .env)
#   make db-status     # show applied migrations
#   make db-new        # create a new migration file: make db-new NAME=add_foo
#   make sqlc          # regenerate sqlc code from db/queries/*.sql
#   make run           # run the API server (loads .env via godotenv)
#   make test          # go test ./... -count=1
#   make build         # go build ./...
#   make vet           # go vet ./...

GOOSE ?= go tool goose
SQLC  ?= go tool sqlc

.PHONY: db-up db-down db-migrate db-status db-new sqlc run test test-integration build vet

db-up:
	docker compose up -d

db-down:
	docker compose down

db-migrate:
	$(GOOSE) up

db-status:
	$(GOOSE) status

db-new:
	@if [ -z "$(NAME)" ]; then echo "usage: make db-new NAME=add_foo"; exit 1; fi
	$(GOOSE) create $(NAME) sql

sqlc:
	$(SQLC) generate

run:
	go run ./cmd/api

test:
	go test ./... -count=1

test-integration:
	set -a && . ./.env && set +a && go test -tags=integration ./... -count=1 -v

build:
	go build ./...

vet:
	go vet ./...