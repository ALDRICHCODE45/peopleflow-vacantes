package closurereport

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/tools/archguard"
)

// Fixed, package-owned repository-relative inputs. LoadEvidence takes the
// repository root as its only input: every path below that root is owned by
// this package, so a caller cannot redirect the loader at trusted-but-unowned
// data, and a caller can never supply the tree identity or a receipt projection.
const (
	// canonicalSQLRel is the canonical sqlc query file that owns the atomic
	// active-industry create gate.
	canonicalSQLRel = "backend/db/queries/companies.sql"
	// receiptsRel is the canonical gate-receipt directory.
	receiptsRel = "backend/quality/receipts"
	// skipWhitelistRel is the canonical, package-owned skip whitelist.
	skipWhitelistRel = "backend/quality/skip-whitelist.json"
)

// skipWhitelistSchema is the exact schema the canonical skip whitelist must
// declare. Any other value is not this package's whitelist and fails closed.
const skipWhitelistSchema = "peopleflow.skip-whitelist/v1"

// sqlcSupportedKinds is the explicit allow-list of sqlc query cardinality kinds
// this loader accepts as authoritative declarations. The query files this closure
// reports on declare `:one`, `:many`, `:exec`, and `:execrows`; the remaining
// kinds complete the supported sqlc cardinality set. An unsupported or
// differently-cased kind is not a declaration: it is ignored rather than trusted,
// so a malformed annotation can never satisfy criterion 9.
var sqlcSupportedKinds = map[string]bool{
	"one":        true,
	"many":       true,
	"exec":       true,
	"execrows":   true,
	"execresult": true,
	"execlastid": true,
	"copyfrom":   true,
	"batchexec":  true,
	"batchmany":  true,
	"batchone":   true,
}

// sqlcNameDeclaration matches one exact sqlc query declaration line
// (`-- name: Symbol :kind`) on a single source line. Every separator is
// horizontal whitespace only (`[ \t]`, never a class that can cross a line
// boundary), so a name, a kind, or a trailing fragment wrapped onto another line
// can never be joined into an authoritative declaration. The exact prefix, the
// symbol, and a supported query kind are all required, so a longer identifier
// that merely shares a prefix, a `--name:` mention without the space, a prose
// mention, and an unsupported kind are all non-declarations. Generated Go is
// never consulted. A line ending other than LF is deliberately not matched
// either: an unrecognized declaration fails criterion 9 closed, never open.
var sqlcNameDeclaration = regexp.MustCompile(`(?m)^-- name:[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]+:([A-Za-z0-9_]+)[ \t]*$`)

// LoadEvidence builds the trusted Evidence set from the fixed real-tree inputs
// under repoRoot (the repository root):
//
//   - the canonical traceability manifest backend/quality/traceability.json;
//   - the effective OpenSpec MUST set composed from the canonical capability
//     specs plus the manifest change's deltas;
//   - the repository-root anchor index;
//   - the two independently observed native scans (locked non-goals for
//     criterion 10, architecture guard for criterion 11) via
//     archguard.ScanEvidence;
//   - the exact sqlc query declarations of the canonical query file;
//   - the receipt identity pair of repoRoot: HEAD tree plus current worktree state;
//   - the canonical gate receipts, read as raw bytes in the deterministic
//     required-gate order;
//   - the canonical skip whitelist backend/quality/skip-whitelist.json, decoded
//     strictly as the exact schema with an explicitly empty entries array;
//   - the four fixed Task 8.1 explanatory documents, validated by the
//     package-owned C12V rule engine.
//
// The pair is observed before and after every derivation and must be equal, so mutable inputs cannot differ.
//
// The returned PreparedEvidence is opaque and observed-only: nonGoalObserved,
// architectureObserved, docsObserved, and loaded are set after their real
// derivations complete, and every failed derivation returns an error with no
// evidence instead of a loaded value. The observed documentation findings are
// the validator's own output: an unobserved document set keeps criterion 12
// closed, while an observed clean set is the only way documents can pass. Only route topology stays gate-level evidence through
// the required gate-arch receipt, which the report requires as a passing
// same-identity receipt: the cross-feature import guard is observed natively by
// ScanEvidence, so no receipt substitutes for it.
//
// The skip whitelist is observed in the same fixed manner: the opaque
// whitelistObserved/whitelistLen state is set only after the canonical document
// proved to be the exact schema with an explicitly empty entries array. A missing,
// unreadable, malformed, non-object, duplicated (including escaped-equivalent),
// unknown-keyed, missing/null/wrong-typed, invalidly-schemaed, non-array,
// non-empty, or trailing-value whitelist fails the whole load closed, and the
// retained Evidence.SkipWhitelistLen compatibility projection never substitutes
// for that observation. Only the observed empty whitelist may pass the whitelist
// part of criterion 3.
//
// The built-executable evidence is derived from those same fixed raw receipts:
// each of the three required executables is emitted only when every receipt in its
// package-owned prerequisite matrix is admitted by the package validator, is a
// passing same-identity receipt, and was read from that prerequisite's own fixed
// canonical path. A valid same-gate receipt stored under another fixed receipt
// path therefore neither substitutes for a missing or invalid canonical
// prerequisite nor masks it, and a decodable receipt whose embedded gate claim
// differs from the fixed path it was read from taints both the expected and the
// claimed gate: missing, failing, stale, duplicate, invalid, misplaced, or
// contract-mismatched prerequisites leave the affected executable absent, so
// Generate reports its existing executable blockers instead of accepting
// caller-supplied or presence-only evidence.
func LoadEvidence(repoRoot string) (Evidence, error) {
	backend := filepath.Join(repoRoot, "backend")

	identity, err := currentReceiptIdentity(repoRoot)
	if err != nil {
		return Evidence{}, err
	}

	manifest, err := archguard.LoadTraceManifest(filepath.Join(backend, "quality", "traceability.json"))
	if err != nil {
		return Evidence{}, err
	}
	effective, err := archguard.ComposeEffectiveSet(
		filepath.Join(repoRoot, "openspec", "specs"),
		filepath.Join(repoRoot, "openspec", "changes", manifest.Change, "specs"),
	)
	if err != nil {
		return Evidence{}, err
	}
	index, err := archguard.BuildAnchorIndex(repoRoot)
	if err != nil {
		return Evidence{}, err
	}
	scan, err := archguard.ScanEvidence(archguard.RepositoryLayout{Backend: backend, Repo: repoRoot})
	if err != nil {
		return Evidence{}, err
	}
	sqlSymbols, err := canonicalQuerySymbols(repoRoot)
	if err != nil {
		return Evidence{}, err
	}
	receipts, err := rawGateReceipts(repoRoot)
	if err != nil {
		return Evidence{}, err
	}
	docs, err := readExplanatoryDocs(repoRoot)
	if err != nil {
		return Evidence{}, err
	}
	docsFindings, err := checkExplanatoryDocs(docs)
	if err != nil {
		return Evidence{}, err
	}
	whitelistLen, err := observeSkipWhitelist(repoRoot)
	if err != nil {
		return Evidence{}, err
	}

	observed, err := currentReceiptIdentity(repoRoot)
	if err != nil {
		return Evidence{}, err
	}
	if err := stableReceiptIdentity(identity, observed); err != nil {
		return Evidence{}, err
	}
	// Receipt-derived evidence is taken only after the identity pair proved stable,
	// so executable evidence can never bind a tree or worktree that moved mid-load.
	executables := deriveExecutables(receipts, identity)

	prepared := &PreparedEvidence{
		manifest:     manifest,
		index:        index,
		effective:    effective,
		nonGoal:      scan.NonGoal,
		architecture: scan.Architecture,
		sqlSymbols:   sqlSymbols,
		docsFindings: docsFindings,
	}
	// The observation state is set only now that every real derivation above
	// completed: a failed or skipped derivation can never report an observed —
	// let alone a clean — domain. The documentation findings are assigned with
	// the rest, so criterion 12 can never see a partially validated document set.
	prepared.nonGoalObserved = true
	prepared.architectureObserved = true
	prepared.docsObserved = true
	prepared.whitelistObserved = true
	prepared.whitelistLen = whitelistLen
	prepared.loaded = true

	return Evidence{
		TreeIdentity:  identity.tree,
		WorktreeState: identity.worktreeState,
		Prepared:      prepared,
		RawReceipts:   rawGateBytes(receipts),
		Executables:   executables,
	}, nil
}

// executablePrerequisiteGates is the closed CE-03 executable matrix: each built
// executable and the exact gate receipts that must all be eligible prerequisites
// for it. It is package-owned, so neither a caller nor a receipt can widen or
// narrow which evidence one built runtime boundary requires.
var executablePrerequisiteGates = map[string][]string{
	"cmd/api":              {"gate-build", "gate-unit"},
	"cmd/migrate":          {"gate-build", "gate-migrations"},
	"cmd/postconfirmation": {"gate-build", "gate-unit"},
}

// deriveExecutables derives the built-executable evidence from the fixed raw
// receipts the loader already read. An executable is eligible only when every
// receipt in its matrix is admitted by the package receipt validator — structural
// decode, semantics, and the exact producer gate/tool/command contract, where a
// passing validated receipt already proves zero failed tests and zero skips — and
// passes the package same-identity check against the observed tree and
// integrity-bound worktree state. Missing, unreadable, stale, failing, duplicate,
// invalid, or contract-mismatched prerequisites therefore leave the affected
// executable absent, and Generate reports its existing executable blockers.
//
// The fixed canonical path is itself part of the contract, so each prerequisite is
// resolved through the loader-owned path association rather than through the raw
// byte slice: the receipt this gate's own fixed file carries must decode and
// validate as that exact expected gate, must be globally unique under the existing
// duplicate rule, and must pass the same-identity check. A decodable same-gate
// claim sitting in another fixed receipt path is therefore ineligible both as a
// substitute for an invalid or missing canonical prerequisite and as a mask for
// one, and it can never bypass the existing duplicate fail-closed behaviour.
//
// Misplaced claims are additionally tainting: any decodable receipt whose embedded
// gate claim differs from its fixed expected gate marks both gates ineligible for
// executable derivation, whether or not full validation of that receipt later
// succeeds. A semantically invalid same-gate claim under another fixed path can
// therefore not leave a single valid canonical receipt eligible.
//
// Only complete Executable{Name, RuntimeBoundaryTests: true} values are ever
// emitted, in the package-owned required-executable order: no caller input, file
// presence, partial entry, or false runtime-boundary claim can grant this
// evidence, and a required executable without a declared prerequisite set gets no
// evidence at all. Receipt blockers are not recomputed here; Generate re-derives
// them from the same raw bytes.
func deriveExecutables(receipts []rawGateReceipt, identity receiptIdentity) []Executable {
	// The package validator plus the existing global duplicate rule decide which
	// gates have exactly one validated receipt. The projected bytes are the same
	// ordered slice Evidence.RawReceipts carries, so uniqueness is judged over the
	// complete fixed evidence set.
	byGate, _ := validatedGateReceipts(rawGateBytes(receipts))
	canonical := make(map[string]rawGateReceipt, len(receipts))
	for _, receipt := range receipts {
		canonical[receipt.gate] = receipt
	}
	tainted := misplacedGateClaims(receipts)
	executables := make([]Executable, 0, len(defaultRequiredExecutables))
	for _, name := range defaultRequiredExecutables {
		gates, declared := executablePrerequisiteGates[name]
		if !declared {
			continue
		}
		eligible := true
		for _, gate := range gates {
			if tainted[gate] {
				eligible = false
				break
			}
			file, present := canonical[gate]
			if !present {
				eligible = false
				break
			}
			canonicalReceipt, err := ValidateReceipt(file.raw)
			if err != nil || canonicalReceipt.Gate != gate {
				eligible = false
				break
			}
			receipt, unique := byGate[gate]
			if !unique || !receiptPasses(receipt, identity.tree, identity.worktreeState) {
				eligible = false
				break
			}
		}
		if eligible {
			executables = append(executables, Executable{Name: name, RuntimeBoundaryTests: true})
		}
	}
	return executables
}

// readExplanatoryDocs reads the four fixed explanatory documents under repoRoot.
// The path set is package-owned (the docID values are the repository-relative
// paths), so a caller cannot redirect, narrow, or widen which documents are
// observed, and any read failure is an error with no observed state at all: a
// missing or unreadable Task 8.1 document fails criterion 12 closed instead of
// looking clean.
func readExplanatoryDocs(repoRoot string) (map[docID]string, error) {
	docs := make(map[docID]string, len(explanatoryDocPaths))
	for _, path := range explanatoryDocPaths {
		abs := filepath.Join(repoRoot, filepath.FromSlash(string(path)))
		data, err := os.ReadFile(abs)
		if err != nil {
			return nil, fmt.Errorf("reading explanatory document %s: %w", abs, err)
		}
		docs[path] = string(data)
	}
	return docs, nil
}

// canonicalQuerySymbols extracts the exact sqlc declarations of the canonical
// query file. Criterion 9 pins the declaration itself, so substring matches and
// generated Go are never authoritative, and an unreadable query file is a
// loader error rather than an empty observation.
func canonicalQuerySymbols(repoRoot string) ([]string, error) {
	path := filepath.Join(repoRoot, filepath.FromSlash(canonicalSQLRel))
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading canonical sqlc queries %s: %w", path, err)
	}
	symbols := []string{}
	for _, match := range sqlcNameDeclaration.FindAllStringSubmatch(string(data), -1) {
		if !sqlcSupportedKinds[match[2]] {
			continue
		}
		symbols = append(symbols, match[1])
	}
	return symbols, nil
}

// currentTreeIdentity resolves the current Git tree object id of repoRoot. The
// identity is always derived from the repository Git reports; it is never
// accepted from the caller, and a repository without a resolvable HEAD tree is
// an error rather than a stale identity.
func currentTreeIdentity(repoRoot string) (string, error) {
	out, err := exec.Command("git", "-C", repoRoot, "rev-parse", "--verify", "HEAD^{tree}").Output()
	if err != nil {
		return "", fmt.Errorf("resolving the current Git tree identity in %s: %w", repoRoot, err)
	}
	identity := strings.TrimSpace(string(out))
	if identity == "" {
		return "", fmt.Errorf("resolving the current Git tree identity in %s: empty Git output", repoRoot)
	}
	return identity, nil
}

// currentWorktreeState mirrors the gate producer's worktree_state byte stream, fail-closed.
// currentWorktreeState mirrors the gate producer's root-based worktree_state byte stream, fail-closed.
func currentWorktreeState(repoRoot string) (string, error) {
	var stream bytes.Buffer
	for _, args := range [][]string{{"status", "--porcelain", "--untracked-files=all"}, {"diff", "HEAD"}} {
		out, err := gitWorktreeOutput(repoRoot, args...)
		if err != nil {
			return "", err
		}
		stream.Write(out)
	}
	untracked, err := gitWorktreeOutput(repoRoot, "ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return "", err
	}
	for _, path := range bytes.Split(untracked, []byte{0}) {
		if len(path) == 0 {
			continue
		}
		content, err := os.ReadFile(filepath.Join(repoRoot, filepath.FromSlash(string(path))))
		if err != nil {
			return "", fmt.Errorf("reading untracked worktree file %s: %w", path, err)
		}
		fmt.Fprintf(&stream, "%x  %s\n", sha256.Sum256(content), path)
	}
	return fmt.Sprintf("sha256:%x", sha256.Sum256(stream.Bytes())), nil
}

func gitWorktreeOutput(dir string, args ...string) ([]byte, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git %s in %s: %w", strings.Join(args, " "), dir, err)
	}
	return out, nil
}

type receiptIdentity struct{ tree, worktreeState string }

func currentReceiptIdentity(repoRoot string) (receiptIdentity, error) {
	tree, err := currentTreeIdentity(repoRoot)
	if err != nil {
		return receiptIdentity{}, err
	}
	worktreeState, err := currentWorktreeState(repoRoot)
	if err != nil {
		return receiptIdentity{}, err
	}
	return receiptIdentity{tree, worktreeState}, nil
}

// stableReceiptIdentity rejects a pair that moved between the two observations.
func stableReceiptIdentity(before, after receiptIdentity) error {
	if before == after {
		return nil
	}
	return fmt.Errorf("receipt identity drifted during observation: tree %q -> %q, worktree_state %q -> %q",
		before.tree, after.tree, before.worktreeState, after.worktreeState)
}

// misplacedGateClaims decodes each canonical receipt only far enough to read its
// embedded gate claim — DecodeReceipt is the package structural decoder, not
// another semantic validator — and returns the gates tainted by a misplaced claim:
// the fixed expected gate of the file it was read from and the gate it claims. A
// decodable receipt whose claim differs from its fixed path is ambiguous evidence,
// so neither gate can grant an executable regardless of whether full ValidateReceipt
// later accepts or rejects that receipt. A raw that is not decodable taints nothing
// here: the canonical ValidateReceipt path already rejects it fail-closed.
func misplacedGateClaims(receipts []rawGateReceipt) map[string]bool {
	tainted := make(map[string]bool, len(receipts))
	for _, receipt := range receipts {
		decoded, err := DecodeReceipt(receipt.raw)
		if err != nil || decoded.Gate == receipt.gate {
			continue
		}
		tainted[receipt.gate] = true
		tainted[decoded.Gate] = true
	}
	return tainted
}

// rawGateReceipt is one canonical gate receipt as it was read from its fixed
// package-owned path: the exact gate that fixed filename is expected to carry,
// and the untouched bytes read from it. The expected gate travels with the bytes
// so every receipt-derived decision can bind evidence to the canonical path it
// came from; missing files simply contribute no entry, in the deterministic
// required-gate order.
type rawGateReceipt struct {
	gate string
	raw  []byte
}

// rawGateReceipts reads the canonical gate receipt files as raw bytes in the
// deterministic required-gate order, without normalizing or interpreting them,
// and keeps each file's fixed expected gate alongside its bytes. A missing
// receipt file is not a preparation failure: it is omitted so Generate emits its
// fixed missing-receipt and dependent-criterion blockers. Any other I/O failure
// (an unreadable path, for example) fails closed. `fs.ErrNotExist` is the modern
// equivalent of `os.IsNotExist` and matches the producer's not-written-yet case
// only.
func rawGateReceipts(repoRoot string) ([]rawGateReceipt, error) {
	receipts := make([]rawGateReceipt, 0, len(defaultRequiredGates))
	for _, gate := range defaultRequiredGates {
		path := filepath.Join(repoRoot, filepath.FromSlash(receiptsRel), gate+".json")
		data, err := os.ReadFile(path)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				continue
			}
			return nil, fmt.Errorf("reading gate receipt %s: %w", path, err)
		}
		receipts = append(receipts, rawGateReceipt{gate: gate, raw: data})
	}
	return receipts, nil
}

// rawGateBytes projects the canonical receipts onto the ordered raw byte slice
// Evidence.RawReceipts carries: byte-for-byte, in the deterministic required-gate
// order.
func rawGateBytes(receipts []rawGateReceipt) [][]byte {
	raw := make([][]byte, 0, len(receipts))
	for _, receipt := range receipts {
		raw = append(raw, receipt.raw)
	}
	return raw
}

// observeSkipWhitelist reads the fixed, package-owned canonical skip whitelist
// under repoRoot and returns its observed entry count. The path is package-owned,
// so a caller can neither redirect nor omit the whitelist, and the only accepted
// document is the exact schema with an explicitly empty entries array: missing or
// unreadable input, malformed JSON, a non-object root, duplicate keys (including
// escaped-equivalent names), unknown keys, missing/null/wrong-typed fields, an
// invalid schema, a non-array entries value, any entry at all, and trailing JSON
// values are all errors. A caller compatibility projection never substitutes for
// this observation.
func observeSkipWhitelist(repoRoot string) (int, error) {
	path := filepath.Join(repoRoot, filepath.FromSlash(skipWhitelistRel))
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, fmt.Errorf("reading skip whitelist %s: %w", path, err)
	}
	whitelist, err := decodeSkipWhitelist(data)
	if err != nil {
		return 0, fmt.Errorf("skip whitelist %s: %w", path, err)
	}
	return len(whitelist), nil
}

// decodeSkipWhitelist parses one canonical skip-whitelist document and enforces
// its exact schema. Ordinary JSON whitespace and key order are accepted; every
// other deviation is an error, so a malformed or non-empty whitelist can never be
// mistaken for an observed clean one. The returned entries are the exact decoded
// array: the observed length is derived from it, never assumed.
func decodeSkipWhitelist(raw []byte) ([]json.RawMessage, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil, errors.New("document is empty")
	}
	if trimmed[0] != '{' {
		return nil, errors.New("root must be a JSON object")
	}

	// json.Decode silently overwrites duplicate keys, so scan the token stream
	// first and compare decoded string keys: `schema` and `sch\u0065ma` are the
	// same field and must be rejected as a duplicate.
	dupDec := json.NewDecoder(bytes.NewReader(raw))
	dupDec.UseNumber()
	if err := checkDuplicateKeys(dupDec); err != nil {
		return nil, err
	}

	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var top map[string]json.RawMessage
	if err := dec.Decode(&top); err != nil {
		return nil, fmt.Errorf("malformed JSON: %w", err)
	}
	if err := ensureNoTrailingJSON(dec); err != nil {
		return nil, err
	}

	for _, field := range []string{"schema", "entries"} {
		value, ok := top[field]
		if !ok {
			return nil, errMissingField(field)
		}
		if jsonType(value) == "null" {
			return nil, fmt.Errorf("field %s: must not be null", field)
		}
	}
	for field := range top {
		if field != "schema" && field != "entries" {
			return nil, errUnknownField(field)
		}
	}

	var schema string
	if err := json.Unmarshal(top["schema"], &schema); err != nil {
		return nil, errWrongType("schema", jsonType(top["schema"]), "string")
	}
	if schema != skipWhitelistSchema {
		return nil, fmt.Errorf("field schema: invalid schema %q, want %q", schema, skipWhitelistSchema)
	}

	if jsonType(top["entries"]) != "array" {
		return nil, errWrongType("entries", jsonType(top["entries"]), "array")
	}
	var entries []json.RawMessage
	if err := json.Unmarshal(top["entries"], &entries); err != nil {
		return nil, errWrongType("entries", jsonType(top["entries"]), "array")
	}
	if len(entries) != 0 {
		return nil, fmt.Errorf("field entries: must be empty, found %d", len(entries))
	}
	return entries, nil
}

// ensureNoTrailingJSON rejects any JSON value after the top-level whitelist
// object, so two concatenated values are never read as one whitelist.
func ensureNoTrailingJSON(dec *json.Decoder) error {
	var extra json.RawMessage
	err := dec.Decode(&extra)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("malformed JSON: %w", err)
	}
	return errors.New("trailing JSON value after the whitelist object")
}
