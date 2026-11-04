// Command audit-purge is the audit log retention job (audit-log-v1 §7): it
// deletes audit_events rows older than 24 months. Dry run by default, it reads
// DATABASE_URL only from the environment and never prints driver errors.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres/retention"
	"github.com/jackc/pgx/v5/pgxpool"
)

const usage = "usage: audit-purge [-execute]\n" +
	"Dry run by default: prints how many audit_events rows are older than the 24 month retention. " +
	"-execute deletes them in batches of 1000, one transaction per batch, each binding the peopleflow.audit_purge flag to its own transaction id (audit-log-v1 sections 6 and 7). " +
	"Run it daily from the deploy scheduler, dry run first. DATABASE_URL must be supplied in the environment.\n"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(run(ctx, os.Args[1:], os.Stdout, os.Stderr))
}

func run(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	return runBatch(ctx, args, stdout, stderr, retention.DefaultBatchSize)
}

// runBatch is run with an injectable batch size, so tests cross a batch
// boundary without seeding thousands of rows.
func runBatch(ctx context.Context, args []string, stdout, stderr io.Writer, batchSize int) int {
	fail := func() int {
		fmt.Fprintln(stderr, "audit purge failed")
		return 1
	}
	flags := flag.NewFlagSet("audit-purge", flag.ContinueOnError)
	flags.SetOutput(io.Discard) // Flag parser errors can contain arbitrary input.
	execute := flags.Bool("execute", false, "delete expired audit events")
	flags.Usage = func() {}
	if err := flags.Parse(args); err != nil {
		if err == flag.ErrHelp {
			if _, err = io.WriteString(stdout, usage); err != nil {
				return fail()
			}
			return 0
		}
		return fail()
	}
	if flags.NArg() != 0 {
		return fail()
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return fail()
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return fail()
	}
	cfg.MaxConns = 1
	cfg.ConnConfig.ConnectTimeout = 10 * time.Second
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return fail()
	}
	defer pool.Close()
	store := retention.NewStore(pool, batchSize)
	if !*execute {
		n, err := store.CountExpired(ctx)
		if err != nil {
			return fail()
		}
		if _, err = fmt.Fprintf(stdout, "audit_events_would_delete=%d\n", n); err != nil {
			return fail()
		}
		return 0
	}
	n, err := store.DeleteExpired(ctx)
	if err != nil {
		return fail()
	}
	if _, err = fmt.Fprintf(stdout, "audit_events_deleted=%d\n", n); err != nil {
		return fail()
	}
	return 0
}
