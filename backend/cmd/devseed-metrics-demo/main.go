// Command devseed-metrics-demo creates or removes the dev-only «Demo Métricas»
// company in the local database (docs/devseed-metrics-demo.md). It refuses any
// database but peopleflow_vacancies on 127.0.0.1, localhost or ::1, and any
// environment marked production. It is never part of the migrations.
//
//	go run ./cmd/devseed-metrics-demo apply --owner-email E --stakeholder-email E --recruiter-email E
//	go run ./cmd/devseed-metrics-demo remove
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/tools/metricsdemo"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// Pool is the connection the command writes through.
type Pool interface {
	metricsdemo.Beginner
	Close()
}

// Runtime is the command's dependency surface, injectable in tests.
type Runtime struct {
	Getenv   func(string) string
	LoadEnv  func()
	OpenPool func(ctx context.Context, dsn string) (Pool, error)
	Now      func() time.Time
	Stdout   io.Writer
}

// DefaultRuntime loads backend/.env like the API (never overriding the
// environment) and connects with pgx.
func DefaultRuntime() Runtime {
	return Runtime{
		Getenv:  os.Getenv,
		LoadEnv: func() { _ = godotenv.Load() },
		OpenPool: func(ctx context.Context, dsn string) (Pool, error) {
			return pgxpool.New(ctx, dsn)
		},
		Now:    time.Now,
		Stdout: os.Stdout,
	}
}

const usage = "usage: devseed-metrics-demo apply --owner-email E --stakeholder-email E --recruiter-email E | remove"

// Run parses the command, checks the environment and the database URL, and
// only then connects and runs apply or remove.
func Run(ctx context.Context, args []string, rt Runtime) error {
	if len(args) == 0 || (args[0] != "apply" && args[0] != "remove") {
		return errors.New(usage)
	}
	flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	var accounts metricsdemo.Accounts
	if args[0] == "apply" {
		flags.StringVar(&accounts.OwnerEmail, "owner-email", "", "owner account email")
		flags.StringVar(&accounts.StakeholderEmail, "stakeholder-email", "", "stakeholder account email")
		flags.StringVar(&accounts.RecruiterEmail, "recruiter-email", "", "recruiter account email")
	}
	if err := flags.Parse(args[1:]); err != nil {
		return fmt.Errorf("%s: invalid flag: %w (%s)", args[0], err, usage)
	}
	if flags.NArg() > 0 {
		return fmt.Errorf("%s: unexpected arguments (%s)", args[0], usage)
	}
	if args[0] == "apply" && (accounts.OwnerEmail == "" || accounts.StakeholderEmail == "" || accounts.RecruiterEmail == "") {
		return fmt.Errorf("apply: --owner-email, --stakeholder-email and --recruiter-email are required")
	}

	if rt.LoadEnv != nil {
		rt.LoadEnv()
	}
	if err := metricsdemo.CheckEnvironment(rt.Getenv); err != nil {
		return err
	}
	dsn := rt.Getenv("DATABASE_URL")
	if err := metricsdemo.CheckDatabaseURL(dsn); err != nil {
		return err
	}
	pool, err := rt.OpenPool(ctx, dsn)
	if err != nil {
		return err
	}
	defer pool.Close()

	if args[0] == "remove" {
		removed, err := metricsdemo.Remove(ctx, pool, metricsdemo.LocalDatabase())
		if err != nil {
			return err
		}
		fmt.Fprintf(rt.Stdout, "Removed %s (%s): %d rows. audit_events rows stay (append-only).\n", metricsdemo.CompanyName, metricsdemo.CompanyID(), removed.Total())
		for _, c := range removed {
			if c.Rows > 0 {
				fmt.Fprintf(rt.Stdout, "  %-32s %d\n", c.Table, c.Rows)
			}
		}
		return nil
	}
	now := time.Now
	if rt.Now != nil {
		now = rt.Now
	}
	applied, err := metricsdemo.Apply(ctx, pool, metricsdemo.LocalDatabase(), accounts, now())
	if err != nil {
		return err
	}
	fmt.Fprintf(rt.Stdout, "Applied %s (%s): %d rows written, %d previous demo rows replaced.\n",
		metricsdemo.CompanyName, applied.Company, applied.Statements, applied.Removed.Total())
	return nil
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := Run(ctx, os.Args[1:], DefaultRuntime()); err != nil {
		fmt.Fprintln(os.Stderr, "devseed-metrics-demo:", err)
		stop()
		os.Exit(1)
	}
}
