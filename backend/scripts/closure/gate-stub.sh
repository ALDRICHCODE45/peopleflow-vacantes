#!/usr/bin/env bash
# gate-stub.sh — WS7A RED pass-through stub.
#
# One common stub behind every `gate-*` Makefile scaffold target (see
# backend/Makefile). It performs NO check: it emits a deterministic JSON
# pass receipt on stdout and exits 0. GREEN (task 7.1) replaces the
# delegation with real scripts; until then, mutated fixtures are
# incorrectly reported as pass.
#
# Receipt contract (stable field order, single line):
#   {"gate":"<name>","status":"pass","tool":"stub","exit_code":0}
set -euo pipefail

if [ $# -lt 1 ]; then
  echo 'usage: gate-stub.sh <gate-name> [args...]' >&2
  exit 64
fi

gate="$1"
shift

printf '{"gate":"%s","status":"pass","tool":"stub","exit_code":0}\n' "$gate"
exit 0
