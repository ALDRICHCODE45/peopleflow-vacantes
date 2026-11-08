package main

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
)

const localDSN = "postgres://dev:dev@127.0.0.1:5432/peopleflow_vacancies?sslmode=disable"

var errOpened = errors.New("opened")

// runtimeFor never reaches a database: OpenPool records the call and fails.
func runtimeFor(env map[string]string, opened *bool) (Runtime, *bytes.Buffer) {
	out := &bytes.Buffer{}
	return Runtime{
		Getenv:  func(key string) string { return env[key] },
		LoadEnv: func() {},
		OpenPool: func(context.Context, string) (Pool, error) {
			*opened = true
			return nil, errOpened
		},
		Stdout: out,
	}, out
}

var applyArgs = []string{"apply", "--owner-email", "o@example.com", "--stakeholder-email", "s@example.com", "--recruiter-email", "r@example.com"}

func TestRunRefusesBeforeConnecting(t *testing.T) {
	for name, c := range map[string]struct {
		env  map[string]string
		args []string
		want string
	}{
		"no command":         {map[string]string{"DATABASE_URL": localDSN}, nil, "usage"},
		"unknown command":    {map[string]string{"DATABASE_URL": localDSN}, []string{"seed"}, "usage"},
		"missing email":      {map[string]string{"DATABASE_URL": localDSN}, []string{"apply", "--owner-email", "o@example.com"}, "required"},
		"remove takes flags": {map[string]string{"DATABASE_URL": localDSN}, []string{"remove", "--owner-email", "o@example.com"}, "flag"},
		"production":         {map[string]string{"DATABASE_URL": localDSN, "APP_ENV": "production"}, applyArgs, "production"},
		"production remove":  {map[string]string{"DATABASE_URL": localDSN, "APP_ENV": "production"}, []string{"remove"}, "production"},
		"remote database":    {map[string]string{"DATABASE_URL": "postgres://dev:dev@db.example.com/peopleflow_vacancies"}, applyArgs, "refusing host"},
		"test database":      {map[string]string{"DATABASE_URL": "postgres://draft_test:draft_test@127.0.0.1:55432/draft_test"}, []string{"remove"}, "refusing database"},
		"no database url":    {map[string]string{}, applyArgs, "DATABASE_URL"},
	} {
		opened := false
		rt, _ := runtimeFor(c.env, &opened)
		err := Run(context.Background(), c.args, rt)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: %v, want %q", name, err, c.want)
		}
		if opened {
			t.Errorf("%s: opened a connection", name)
		}
	}
}

func TestRunConnectsOnlyToTheLocalDatabase(t *testing.T) {
	for _, args := range [][]string{applyArgs, {"remove"}} {
		opened := false
		rt, _ := runtimeFor(map[string]string{"DATABASE_URL": localDSN, "APP_ENV": "local"}, &opened)
		if err := Run(context.Background(), args, rt); !errors.Is(err, errOpened) || !opened {
			t.Fatalf("%v: %v", args, err)
		}
	}
}

// The dotenv file is loaded before the environment is checked, so a
// production marker in it refuses too.
func TestRunChecksTheLoadedEnvironment(t *testing.T) {
	env := map[string]string{"DATABASE_URL": localDSN}
	opened := false
	rt, _ := runtimeFor(env, &opened)
	rt.LoadEnv = func() { env["APP_ENV"] = "production" }
	if err := Run(context.Background(), []string{"remove"}, rt); err == nil || opened {
		t.Fatalf("%v, opened %v", err, opened)
	}
}
