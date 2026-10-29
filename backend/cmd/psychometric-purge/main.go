// Command psychometric-purge is a one-shot, dry-run-by-default retention tool.
// It reads DATABASE_URL only from the environment and never prints driver errors.
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

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/infrastructure/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

const usage = "usage: psychometric-purge [-execute]\nDry run by default; -execute deletes retained-expired assessment data in batches of 100. DATABASE_URL must be supplied in the environment.\n"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(run(ctx, os.Args[1:], os.Stdout, os.Stderr))
}

func run(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	fail := func() int {
		fmt.Fprintln(stderr, "psychometric purge failed")
		return 1
	}
	flags := flag.NewFlagSet("psychometric-purge", flag.ContinueOnError)
	flags.SetOutput(io.Discard) // Flag parser errors can contain arbitrary input.
	execute := flags.Bool("execute", false, "delete expired assessment data")
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
	counts, err := postgres.PurgeAssessmentData(ctx, pool, *execute)
	if err != nil {
		return fail()
	}
	_, err = fmt.Fprintf(stdout, "psychometric_invitations=%d\npsychometric_answers=%d\npsychometric_answer_events=%d\npsychometric_consents=%d\npsychometric_results=%d\npsychometric_comparisons=%d\n", counts.Invitations, counts.Answers, counts.AnswerEvents, counts.Consents, counts.Results, counts.Comparisons)
	if err != nil {
		return fail()
	}
	return 0
}
