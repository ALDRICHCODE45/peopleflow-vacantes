// Command notifications-purge is the notifications retention job
// (notifications-v1 D22): it deletes notifications rows created more than 180
// days ago and processed notification_events rows processed more than 180 days
// ago. Dry run by default, it reads DATABASE_URL only from the environment and
// never prints driver errors.
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

	"github.com/jackc/pgx/v5/pgxpool"
)

const usage = "usage: notifications-purge [-execute]\n" +
	"Dry run by default: prints how many notifications rows (created_at) and processed notification_events rows (processed_at) are older than the 180 day retention. " +
	"-execute deletes them in batches of 1000, one transaction per batch, notifications first; unprocessed events and events a remaining notification still references are kept (notifications-v1 D22). " +
	"Run it daily from the deploy scheduler, dry run first. DATABASE_URL must be supplied in the environment.\n"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(run(ctx, os.Args[1:], os.Stdout, os.Stderr))
}

func run(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	return runBatch(ctx, args, stdout, stderr, defaultBatchSize)
}

// runBatch is run with an injectable batch size, so tests cross a batch
// boundary without seeding thousands of rows.
func runBatch(ctx context.Context, args []string, stdout, stderr io.Writer, batchSize int) int {
	fail := func() int {
		fmt.Fprintln(stderr, "notifications purge failed")
		return 1
	}
	flags := flag.NewFlagSet("notifications-purge", flag.ContinueOnError)
	flags.SetOutput(io.Discard) // Flag parser errors can contain arbitrary input.
	execute := flags.Bool("execute", false, "delete expired notifications and processed events")
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
	s := newStore(pool, batchSize)
	verb, c := "deleted", counts{}
	if *execute {
		c, err = s.deleteExpired(ctx)
	} else {
		verb = "would_delete"
		c, err = s.countExpired(ctx)
	}
	if err != nil {
		return fail()
	}
	// Counts only: no row content, ids or personal data.
	if _, err = fmt.Fprintf(stdout, "notifications_%s=%d\nnotification_events_%s=%d\n", verb, c.notifications, verb, c.events); err != nil {
		return fail()
	}
	return 0
}
