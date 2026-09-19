// Package closurereport generates the WS7C traceability Markdown view and the
// objective AWS go/no-go report (design §10.2) from immutable closure
// evidence: traceability manifest rows, gate receipts, executables, the skip
// whitelist, non-goal scan findings, and the proposal §9 criteria map.
//
// GREEN (Task 7.3 / WS7C): Generate implements the design §10.2 algorithm
// and lists every blocker in one run, deterministically sorted. Waivers and
// size:exception entries are never accepted as technical evidence: the
// algorithm never consults them, so they can neither flip the decision nor
// remove a blocker.
package closurereport

import (
	"encoding/json"
	"fmt"
	"io"
	"slices"
	"sort"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/tools/archguard"
)

// Decision values written into every report.
const (
	DecisionGo   = "GO"
	DecisionNoGo = "NO-GO"
)

// Blocker kinds the GREEN algorithm emits (design §10.2).
// KindInvalidManifest and KindUnpreparedEvidence are the BC-04 native-evidence
// kinds: a defective observed manifest and an absent or zero observation seam.
const (
	KindInvalidManifest    = "invalid-manifest"
	KindUnpreparedEvidence = "unprepared-evidence"
	KindStaleReceipt       = "stale-receipt"
	KindMissingReceipt     = "missing-receipt"
	KindInvalidReceipt     = "invalid-receipt"
	KindDuplicateReceipt   = "duplicate-receipt"
	KindFailedReceipt      = "failed-receipt"
	KindIntegrationSkip    = "integration-skip"
	KindSkipWhitelist      = "skip-whitelist"
	KindUnresolvableAnchor = "unresolvable-anchor"
	KindExecutable         = "executable"
	KindCriterion          = "criterion"
	KindNonGoal            = "non-goal"
	KindArchitecture       = "architecture"
	// KindDocsContradiction is one observed explanatory-docs drift finding from
	// the C12V validator (proposal §9.12 / Task 8.1).
	KindDocsContradiction = "docs-contradiction"
)

// TierMUST is the manifest tier the report algorithm validates completely.
const TierMUST = "MUST"

// StatusPass is the receipt status required for GO.
const StatusPass = "pass"

// Fixed proposal §9 criterion identifiers. Criteria 3 and 4 keep their BC-03
// identifiers so the frozen render view still names them.
const (
	criterionC1  = "criterion-1-canonical-requirement-ownership-and-traceability-matrix"
	criterionC2  = "criterion-2-build-vet-fmt-unit-race"
	criterionC3  = "criterion-3-serial-live-integration-zero-unexpected-skips"
	criterionC4  = "criterion-4-fresh-migrations-and-sqlc-deterministic"
	criterionC5  = "criterion-5-cmd-api-cmd-migrate-postconfirmation-boundary-tests"
	criterionC6  = "criterion-6-production-auth-jwks-rotation-fail-closed"
	criterionC7  = "criterion-7-health-limits-shutdown-envelope-observability"
	criterionC8  = "criterion-8-companies-industries-candidates-wire-and-catalog-contract"
	criterionC9  = "criterion-9-atomic-active-industry-sql-gate"
	criterionC10 = "criterion-10-locked-non-goals-absent"
	criterionC11 = "criterion-11-architecture-guard-enforces-a1"
	criterionC12 = "criterion-12-explanatory-docs-no-longer-contradict-delivered-behavior"
)

// criterion12Detail is the deterministic reason criterion 12 stays NO-GO while
// the four fixed explanatory documents are unobserved. No boolean, waiver, or
// caller projection can replace the observed docs validator.
const criterion12Detail = "no observed machine-readable explanatory-docs evidence exists yet; Task 8.1 evidence is required before criterion 12 can pass"

// Report is the generated go/no-go decision record.
type Report struct {
	Decision string    `json:"decision"`
	Blockers []Blocker `json:"blockers"`
}

// Blocker names one reason the report stays at NO-GO.
type Blocker struct {
	Kind    string `json:"kind"`
	Subject string `json:"subject"`
	Detail  string `json:"detail"`
}

// canonicalMUSTRequirements is the package-owned canonical MUST set: the exact
// 122 effective MUST requirements the closure reports against, in the design
// §12 source order. The distribution is fixed: backend-runtime 9, industries 3,
// candidates 8, companies 13, identity 12, jobs 32, company-membership 9,
// applications 30, audit_events 6. Coverage is never derived from caller
// manifest or caller effective data.
var canonicalMUSTRequirements = []archguard.EffectiveRequirement{
	{Capability: "backend-runtime", Title: "Migration Executable (`cmd/migrate`)"},
	{Capability: "backend-runtime", Title: "Health Liveness and DB Readiness Split"},
	{Capability: "backend-runtime", Title: "HTTP Server Hardening"},
	{Capability: "backend-runtime", Title: "Stable Error Envelope"},
	{Capability: "backend-runtime", Title: "Stable Error-Code Catalog"},
	{Capability: "backend-runtime", Title: "Minimum Structured Observability"},
	{Capability: "backend-runtime", Title: "Repository-Enforced Quality Gates"},
	{Capability: "backend-runtime", Title: "Architecture Guard"},
	{Capability: "backend-runtime", Title: "Traceability Matrix and AWS Go/No-Go Evidence Contract"},
	{Capability: "industries", Title: "Public Active-Catalog Endpoint"},
	{Capability: "industries", Title: "Active-Only Catalog Semantics"},
	{Capability: "industries", Title: "Single Canonical Route Registration"},
	{Capability: "candidates", Title: "Candidate Profile Field Matrix"},
	{Capability: "candidates", Title: "CV Storage Key Reserve Semantics"},
	{Capability: "candidates", Title: "Field Validation"},
	{Capability: "candidates", Title: "Self-Service Profile Access"},
	{Capability: "candidates", Title: "Ownership Invariant (No IDOR)"},
	{Capability: "candidates", Title: "Languages List Management"},
	{Capability: "candidates", Title: "Profile Lifecycle"},
	{Capability: "candidates", Title: "Authentication Required"},
	{Capability: "companies", Title: "Public Company Create Endpoint"},
	{Capability: "companies", Title: "Public Company Read Endpoint"},
	{Capability: "companies", Title: "Atomic Active-Industry Create Gate"},
	{Capability: "companies", Title: "Companies Write-Surface Evidence Contract"},
	{Capability: "companies", Title: "PATCH /me/company Endpoint, Owner-Only Gate, and Field Mutability"},
	{Capability: "companies", Title: "PATCH /me/company CAS Optimistic Concurrency Control"},
	{Capability: "companies", Title: "PATCH /me/company Response Shape"},
	{Capability: "companies", Title: "DELETE /me/company Endpoint, Owner-Only Gate, and Idempotency"},
	{Capability: "companies", Title: "DELETE /me/company CAS Optimistic Concurrency Control"},
	{Capability: "companies", Title: "Soft-Delete Atomic Transactional Close of Jobs"},
	{Capability: "companies", Title: "Soft-Deleted Company Read Visibility"},
	{Capability: "companies", Title: "Authorization Dispatch Order for /me/company Writes"},
	{Capability: "companies", Title: "Audit Events for Companies"},
	{Capability: "identity", Title: "Production PostConfirmation Lambda Boundary"},
	{Capability: "identity", Title: "PostConfirmation Handler"},
	{Capability: "identity", Title: "JWT Middleware"},
	{Capability: "identity", Title: "JWT Verification Modes"},
	{Capability: "identity", Title: "users Schema Migration"},
	{Capability: "identity", Title: "Identity Value Objects"},
	{Capability: "identity", Title: "User Entity and Factory"},
	{Capability: "identity", Title: "Identity Sentinel Errors"},
	{Capability: "identity", Title: "CreateUser Persistence is Idempotent"},
	{Capability: "identity", Title: "User Reads"},
	{Capability: "identity", Title: "mapCreateError Translation"},
	{Capability: "identity", Title: "Identity Use Cases"},
	{Capability: "jobs", Title: "Status Domain"},
	{Capability: "company-membership", Title: "company_members Schema Migration"},
	{Capability: "company-membership", Title: "Membership Resolution from Authenticated Subject"},
	{Capability: "company-membership", Title: "GetMyMembership"},
	{Capability: "company-membership", Title: "ListMembers"},
	{Capability: "company-membership", Title: "AddMember (Owner-Only)"},
	{Capability: "company-membership", Title: "UpdateRole (Owner-Only, Same-Company)"},
	{Capability: "company-membership", Title: "RemoveMember (Owner-Only, Same-Company)"},
	{Capability: "company-membership", Title: "RequireCompanyRole Middleware"},
	{Capability: "company-membership", Title: "HTTP Surface Under /me/company"},
	{Capability: "applications", Title: "Applications Schema Migration"},
	{Capability: "applications", Title: "Status Domain"},
	{Capability: "applications", Title: "Status Transition Matrix"},
	{Capability: "applications", Title: "Apply Endpoint"},
	{Capability: "applications", Title: "Candidate Identity Resolution (No IDOR)"},
	{Capability: "applications", Title: "Atomic Apply Eligibility Gate"},
	{Capability: "applications", Title: "No Double-Apply"},
	{Capability: "applications", Title: "Apply Domain Validation"},
	{Capability: "applications", Title: "Apply Response"},
	{Capability: "applications", Title: "Apply Error Taxonomy"},
	{Capability: "applications", Title: "Apply Route Security Boundary"},
	{Capability: "applications", Title: "Candidate My Applications Endpoint"},
	{Capability: "applications", Title: "Candidate My Applications DTO Shape"},
	{Capability: "applications", Title: "Recruiter List Endpoint"},
	{Capability: "applications", Title: "Recruiter List Same-Company Invariant"},
	{Capability: "applications", Title: "Recruiter List Cap"},
	{Capability: "applications", Title: "Soft-Deleted Job Applications Stay Recruiter-Accessible"},
	{Capability: "applications", Title: "Recruiter Detail Endpoint"},
	{Capability: "applications", Title: "Recruiter Detail Same-Company Invariant"},
	{Capability: "applications", Title: "Recruiter Detail PII Minimization"},
	{Capability: "applications", Title: "Recruiter Transition Endpoint"},
	{Capability: "applications", Title: "Recruiter Transition Matrix Enforcement"},
	{Capability: "applications", Title: "Recruiter Transition Lost Race"},
	{Capability: "applications", Title: "Recruiter Transition Same-Company Invariant"},
	{Capability: "applications", Title: "Recruiter Transition Error Taxonomy"},
	{Capability: "applications", Title: "Recruiter Route Security Boundary"},
	{Capability: "applications", Title: "ApplicationSubmitted Audit Emission"},
	{Capability: "applications", Title: "ApplicationTransitioned Audit Emission"},
	{Capability: "applications", Title: "Transition Actor Identity (CompanyContext UserID)"},
	{Capability: "applications", Title: "Fail-Closed Application + Audit Co-Write"},
	{Capability: "audit_events", Title: "Audit Events Schema Migration"},
	{Capability: "audit_events", Title: "Actor Type Vocabulary"},
	{Capability: "audit_events", Title: "Event Type Vocabulary (Closed Set for This Cycle)"},
	{Capability: "audit_events", Title: "Append-Only Port"},
	{Capability: "audit_events", Title: "Co-Write Atomicity Contract"},
	{Capability: "audit_events", Title: "Metadata Shape (PII-Free)"},
	{Capability: "jobs", Title: "Public Read Endpoints"},
	{Capability: "jobs", Title: "Read-Side Visibility Rule"},
	{Capability: "jobs", Title: "Jobs Schema Migration"},
	{Capability: "jobs", Title: "Full-Text Search"},
	{Capability: "jobs", Title: "Listing Filters"},
	{Capability: "jobs", Title: "Keyset Pagination"},
	{Capability: "jobs", Title: "Enum Invariants"},
	{Capability: "jobs", Title: "PATCH /jobs/{id} Endpoint and Gate"},
	{Capability: "jobs", Title: "Field Editability Matrix"},
	{Capability: "jobs", Title: "Status Transition Table"},
	{Capability: "jobs", Title: "CAS Optimistic Concurrency"},
	{Capability: "jobs", Title: "Domain Validation Rules"},
	{Capability: "jobs", Title: "Same-Company Invariant and IDOR Defense"},
	{Capability: "jobs", Title: "Editor Response DTO"},
	{Capability: "jobs", Title: "Write Route Security Boundary"},
	{Capability: "jobs", Title: "Error Taxonomy"},
	{Capability: "jobs", Title: "Job Creation Endpoint"},
	{Capability: "jobs", Title: "Create Field Set"},
	{Capability: "jobs", Title: "Draft Creation Semantics"},
	{Capability: "jobs", Title: "Active Company Creation Gate"},
	{Capability: "jobs", Title: "Create Domain Validation"},
	{Capability: "jobs", Title: "Create Response"},
	{Capability: "jobs", Title: "Create Route Security Boundary"},
	{Capability: "jobs", Title: "Create Error Taxonomy"},
	{Capability: "jobs", Title: "Re-Open Transitions"},
	{Capability: "jobs", Title: "Re-Open + Field Edits Apply Atomically"},
	{Capability: "jobs", Title: "Active-Company Update Gate"},
	{Capability: "jobs", Title: "Re-Open Inherits CAS and Same-Company Invariants"},
	{Capability: "jobs", Title: "DELETE /jobs/{id} Endpoint, Gate, and Route Boundary"},
	{Capability: "jobs", Title: "Soft-Delete Concurrency Controls"},
	{Capability: "jobs", Title: "Soft-Delete Eligibility, Audit, and Read-Side Invariants"},
}

// PreparedEvidence is the trusted, package-owned observation seam for native
// closure evidence. Its decision fields are unexported, so a caller cannot
// hand-build observed-clean native evidence: the only production source is a
// package loader over fixed package-owned paths, and package-internal test
// fixtures are the other. A nil, zero, or unprepared value fails closed.
type PreparedEvidence struct {
	manifest     archguard.TraceManifest
	index        archguard.AnchorIndex
	effective    []archguard.EffectiveRequirement
	nonGoal      []archguard.Violation
	architecture []archguard.Violation
	// nonGoalObserved and architectureObserved are independent observation states:
	// an explicitly observed empty slice passes its own criterion, while an
	// unobserved scan fails only its owning criterion (10 and 11 respectively).
	nonGoalObserved      bool
	architectureObserved bool
	sqlSymbols           []string
	// docsObserved and docsFindings are the explanatory-docs observation: the
	// four fixed documents were read, and the C12V validator's findings for them.
	// Criterion 12 passes only when the documents were actually observed and the
	// validator reported no finding; an unobserved document set always fails.
	docsObserved bool
	docsFindings []DocFinding
	// whitelistObserved and whitelistLen are the opaque native skip-whitelist
	// observation: criterion 3 can pass only when a skip whitelist was actually
	// observed, so an unobserved zero is never a clean whitelist.
	whitelistObserved bool
	whitelistLen      int
	loaded            bool
}

// atomicIndustryGateTitle is the exact companies MUST requirement the C9
// criterion pins together with its own SQL owner and declared query symbol.
const atomicIndustryGateTitle = "Atomic Active-Industry Create Gate"

// ManifestRow is one traceability-manifest row
// (backend/quality/traceability.json): one effective MUST requirement with its
// single owning capability and one resolved anchor.
type ManifestRow struct {
	Requirement string `json:"requirement"`
	Capability  string `json:"capability"`
	Tier        string `json:"tier"`
	Owner       string `json:"owner"`  // exactly one owning capability
	Anchor      string `json:"anchor"` // resolved path/symbol/test; empty means unresolvable
}

// Receipt is the machine-readable gate receipt
// (backend/quality/receipts/*.json) the algorithm consumes.
type Receipt struct {
	Gate      string   `json:"gate"`
	Status    string   `json:"status"`
	Tree      string   `json:"tree"`
	ExitCode  int      `json:"exit_code"`
	SkipNames []string `json:"skip_names"`
	// WorktreeState is the receipt's integrity-bound worktree_state: a receipt is
	// passing evidence only when it matches the current worktree state too.
	WorktreeState string `json:"worktree_state"`
}

// Executable is one built runtime boundary and its test evidence.
type Executable struct {
	Name                 string // cmd/api, cmd/migrate, cmd/postconfirmation
	RuntimeBoundaryTests bool
}

// Criterion is one proposal §9 criterion and the gate receipts plus manifest
// requirements that must support it with passing evidence.
type Criterion struct {
	ID               string
	RequiredGates    []string
	RequiredManifest []string
}

// Waiver is a non-technical exception claim. The algorithm never accepts a
// waiver or a size:exception as technical evidence: it may not flip the
// decision, remove a blocker, or substitute for a missing receipt or anchor.
type Waiver struct {
	Kind        string // "waiver" or "size:exception"
	Description string
}

// Evidence is the immutable input set the report algorithm evaluates.
type Evidence struct {
	TreeIdentity string
	// WorktreeState is the current worktree state of the repository, derived by
	// the package loader exactly as the gate producer derives it. A receipt is
	// passing evidence only when it matches TreeIdentity and WorktreeState.
	WorktreeState string
	// Prepared is the observed native-evidence seam. Generate never reads a
	// caller-built manifest, criteria list, or receipt projection for
	// eligibility; absent or zero prepared evidence fails closed.
	Prepared *PreparedEvidence
	Manifest []ManifestRow
	// RawReceipts preserves the exact original bytes received from each gate.
	// Generate validates these bytes before considering receipt evidence.
	RawReceipts [][]byte
	Receipts    []Receipt
	Executables []Executable
	// SkipWhitelistLen is a retained compatibility projection only. Generate never
	// consults it: the opaque native skip-whitelist observation on PreparedEvidence
	// alone decides the whitelist part of criterion 3.
	SkipWhitelistLen int
	NonGoalFindings  []string
	Waivers          []Waiver
	Criteria         []Criterion
	// RequiredGates and RequiredExecutables are retained so callers can declare
	// intent only. Generate never consults them: the design §9 gate and
	// executable sets are package-owned constants a caller can neither narrow nor
	// widen.
	RequiredGates       []string
	RequiredExecutables []string
}

// defaultRequiredGates is the closed set of sub-gate receipts design §9
// requires for GO (the nine aggregate closure-gate targets).
var defaultRequiredGates = []string{
	"gate-build", "gate-vet", "gate-fmt", "gate-unit", "gate-race",
	"gate-integration", "gate-migrations", "gate-sqlc", "gate-arch",
}

// defaultRequiredExecutables are the built executables with runtime boundary
// tests required by proposal §9 criterion 5.
var defaultRequiredExecutables = []string{"cmd/api", "cmd/migrate", "cmd/postconfirmation"}

// manifestRowKey identifies one observed manifest row.
func manifestRowKey(capability, title string) string { return capability + "/" + title }

// ruleTierDrift is the local native rule for a canonical row whose declared tier
// is not MUST: coverage matches capability and title only, so a tier change needs
// its own explicit C1 violation.
const ruleTierDrift = "traceability-tier-drift"

// nativeManifestViolations reports the observed-manifest defects C1 rejects:
// native structure (including duplicate-owner validation), coverage against the
// package-owned canonical MUST set, anchor resolvability, and any canonical row
// declared with a tier other than MUST.
func nativeManifestViolations(prepared PreparedEvidence) []archguard.Violation {
	violations := archguard.CheckManifestStructure(prepared.manifest)
	violations = append(violations, archguard.CheckManifestCoverage(prepared.manifest.Rows, canonicalMUSTRequirements)...)
	violations = append(violations, archguard.CheckManifestAnchors(prepared.manifest.Rows, prepared.index)...)
	for _, row := range prepared.manifest.Rows {
		key := archguard.EffectiveRequirement{Capability: row.Capability, Title: row.Requirement}
		if row.Tier != TierMUST && canonicalMUSTSet[key] {
			violations = append(violations, archguard.Violation{
				Rule:   ruleTierDrift,
				File:   manifestRowKey(row.Capability, row.Requirement),
				Detail: fmt.Sprintf("canonical MUST row is declared tier %q, want %q", row.Tier, TierMUST),
			})
		}
	}
	return violations
}

// validObservedRow reports whether one observed row is valid MUST evidence: its
// exact (capability, requirement) key occurs exactly once in the whole observed
// manifest, the row is tier MUST, its native per-row structure is valid (no
// repeated implementation-path owner and at least one anchor), and every declared
// anchor resolves natively. A present-but-invalid or duplicated row is therefore
// never valid evidence for any row-coverage criterion.
func validObservedRow(row archguard.TraceabilityRow, index archguard.AnchorIndex, keyCount int) bool {
	if row.Tier != TierMUST || keyCount != 1 {
		return false
	}
	structure := archguard.CheckManifestStructure(archguard.TraceManifest{Rows: []archguard.TraceabilityRow{row}})
	return len(structure) == 0 && len(archguard.CheckManifestAnchors([]archguard.TraceabilityRow{row}, index)) == 0
}

// ruleEffectiveDrift is the local native rule for an observed effective MUST set
// that does not match the package-owned canonical set exactly.
const ruleEffectiveDrift = "traceability-effective-set-drift"

// canonicalMUSTSet indexes the package-owned canonical set for membership checks.
var canonicalMUSTSet = func() map[archguard.EffectiveRequirement]bool {
	set := make(map[archguard.EffectiveRequirement]bool, len(canonicalMUSTRequirements))
	for _, req := range canonicalMUSTRequirements {
		set[req] = true
	}
	return set
}()

// errorCodeCatalogTitle is the backend-runtime MUST row that criterion 8 pins
// together with the companies, candidates, and industries row sets; criterion 7
// already covers it as part of the backend-runtime contract.
const errorCodeCatalogTitle = "Stable Error-Code Catalog"

// rowsForCapability selects the package-owned canonical MUST rows of one
// capability, so no fixed criterion row set is ever caller-supplied.
func rowsForCapability(capability string) []archguard.EffectiveRequirement {
	rows := []archguard.EffectiveRequirement{}
	for _, req := range canonicalMUSTRequirements {
		if req.Capability == capability {
			rows = append(rows, req)
		}
	}
	return rows
}

// criterionRowRequirements returns the observed MUST row set each row-coverage
// criterion requires: criterion 6 all 12 identity rows, criterion 7 all 9
// backend-runtime rows, and criterion 8 exactly the 13 companies + 8 candidates
// + 3 industries rows plus the stable error-code catalog row (25 rows).
func criterionRowRequirements() map[string][]archguard.EffectiveRequirement {
	rows := map[string][]archguard.EffectiveRequirement{
		criterionC6: rowsForCapability("identity"),
		criterionC7: rowsForCapability("backend-runtime"),
		criterionC8: append(rowsForCapability("companies"), rowsForCapability("candidates")...),
	}
	rows[criterionC8] = append(rows[criterionC8], rowsForCapability("industries")...)
	for _, req := range rowsForCapability("backend-runtime") {
		if req.Title == errorCodeCatalogTitle {
			rows[criterionC8] = append(rows[criterionC8], req)
		}
	}
	return rows
}

// effectiveDrift reports an observed effective MUST set that is absent, smaller,
// larger, repeated, or otherwise different from the package-owned canonical set,
// including duplicate (capability, title) entries. The production seam therefore
// fails closed on spec drift instead of silently narrowing the expected coverage.
func effectiveDrift(observed []archguard.EffectiveRequirement) []archguard.Violation {
	counts := make(map[archguard.EffectiveRequirement]int, len(observed))
	for _, req := range observed {
		counts[req]++
	}
	var violations []archguard.Violation
	if len(observed) != len(canonicalMUSTRequirements) || len(counts) != len(canonicalMUSTRequirements) {
		violations = append(violations, archguard.Violation{
			Rule:   ruleEffectiveDrift,
			File:   "effective-set",
			Detail: fmt.Sprintf("observed effective MUST set has %d entries / %d unique requirements, the package-owned canonical set has %d", len(observed), len(counts), len(canonicalMUSTRequirements)),
		})
	}
	for req, count := range counts {
		if count > 1 {
			violations = append(violations, archguard.Violation{
				Rule:   ruleEffectiveDrift,
				File:   manifestRowKey(req.Capability, req.Title),
				Detail: fmt.Sprintf("observed effective MUST set repeats (%s, %q) %d times", req.Capability, req.Title, count),
			})
		}
		if !canonicalMUSTSet[req] {
			violations = append(violations, archguard.Violation{
				Rule:   ruleEffectiveDrift,
				File:   manifestRowKey(req.Capability, req.Title),
				Detail: fmt.Sprintf("observed effective MUST set carries (%s, %q) outside the package-owned canonical set", req.Capability, req.Title),
			})
		}
	}
	for _, req := range canonicalMUSTRequirements {
		if counts[req] == 0 {
			violations = append(violations, archguard.Violation{
				Rule:   ruleEffectiveDrift,
				File:   manifestRowKey(req.Capability, req.Title),
				Detail: fmt.Sprintf("observed effective MUST set is missing canonical requirement (%s, %q)", req.Capability, req.Title),
			})
		}
	}
	return violations
}

// criterionForGate maps a required closure gate to the fixed proposal §9
// criterion that owns its receipt.
func criterionForGate(gate string) string {
	switch gate {
	case "gate-arch":
		return criterionC11
	case "gate-integration":
		return criterionC3
	case "gate-migrations", "gate-sqlc":
		return criterionC4
	default:
		return criterionC2
	}
}

// Contract anchors criterion 9 pins exactly: the single SQL owner of the atomic
// active-industry create gate and the query symbol that owner must declare.
const (
	atomicIndustrySQLOwner  = "backend/db/queries/companies.sql"
	atomicIndustrySQLSymbol = "CreateCompany"
)

// nativeKind maps a native manifest rule to the blocker kind the BC-03 contract
// already used for that class of defect.
func nativeKind(rule string) string {
	switch {
	case strings.HasSuffix(rule, "-zero-anchors"),
		strings.HasSuffix(rule, "-unresolvable-path"),
		strings.HasSuffix(rule, "-unresolvable-symbol"),
		strings.HasSuffix(rule, "-selector-no-matches"):
		return KindUnresolvableAnchor
	default:
		return KindInvalidManifest
	}
}

// nativeDetail keeps the BC-03 blocker wording for the preserved anchor kind.
func nativeDetail(rule, detail string) string {
	if nativeKind(rule) == KindUnresolvableAnchor {
		return "MUST row has no resolvable anchor"
	}
	return detail
}

// validatedGateReceipts validates every raw receipt and returns the decision-only
// gate index plus blockers for untrustworthy raw evidence; Generate and
// RenderTraceability share it, so the decision and the artifact cannot disagree.
func validatedGateReceipts(rawReceipts [][]byte) (map[string]Receipt, []Blocker) {
	validatedByGate := make(map[string][]ValidatedReceipt, len(rawReceipts))
	blockers := []Blocker{}
	for index, raw := range rawReceipts {
		rec, err := ValidateReceipt(raw)
		if err != nil {
			blockers = append(blockers, Blocker{
				Kind:    KindInvalidReceipt,
				Subject: fmt.Sprintf("raw[%d]", index),
				Detail:  fmt.Sprintf("raw receipt validation failed: %v", err),
			})
			continue
		}
		validatedByGate[rec.Gate] = append(validatedByGate[rec.Gate], rec)
	}
	byGate := make(map[string]Receipt, len(validatedByGate))
	for gate, receipts := range validatedByGate {
		if len(receipts) != 1 {
			blockers = append(blockers, Blocker{
				Kind:    KindDuplicateReceipt,
				Subject: gate,
				Detail:  "multiple validated receipts for gate",
			})
			continue
		}
		rec := receipts[0]
		byGate[gate] = Receipt{
			Gate:          rec.Gate,
			Status:        rec.Status,
			Tree:          rec.Tree,
			ExitCode:      rec.ExitCode,
			SkipNames:     append([]string(nil), rec.SkipNames...),
			WorktreeState: rec.ArtifactHashes.WorktreeState,
		}
	}
	return byGate, blockers
}

// receiptPasses reports whether a receipt is a passing same-identity receipt: a
// pass status, exit 0, and both the Git tree and the integrity-bound worktree
// state matching the current evidence.
func receiptPasses(rec Receipt, tree, worktreeState string) bool {
	return rec.Status == StatusPass && rec.ExitCode == 0 && rec.Tree == tree && rec.WorktreeState == worktreeState
}

// docsFindingDetail renders one explanatory-docs finding as the deterministic
// detail shared by its docs-contradiction blocker and its criterion 12
// attribution: the anchored line and the stable rule id always precede the
// finding's own evidence.
func docsFindingDetail(finding DocFinding) string {
	return fmt.Sprintf("line %d rule %s: %s", finding.Line, finding.Rule, finding.Detail)
}

// Generate renders the go/no-go Report from evidence with the design §10.2
// algorithm: it starts at NO-GO and flips to GO only when native traceability
// validation, the fixed nine gate receipts, zero unexplained skips, the three
// runtime boundaries, all twelve fixed proposal §9 criteria, and both observed
// locked non-goal scans pass. Every blocker is listed in one run, sorted for
// deterministic output. Caller gate, executable, criteria, manifest, and receipt
// projections are render-only and never decide eligibility.
func Generate(ev Evidence) Report {
	blockers := []Blocker{}
	add := func(kind, subject, detail string) {
		blockers = append(blockers, Blocker{Kind: kind, Subject: subject, Detail: detail})
	}
	// addCriterion lists one criterion blocker per distinct cause: the fixed
	// criteria never repeat the same subject/detail pair.
	criterionSeen := map[string]bool{}
	addCriterion := func(id, detail string) {
		key := id + "\x00" + detail
		if criterionSeen[key] {
			return
		}
		criterionSeen[key] = true
		add(KindCriterion, id, detail)
	}

	// 1. Traceability (C1): the observed native-evidence seam must be prepared,
	// and the observed manifest is validated with the native archguard guards
	// against the package-owned canonical MUST set. Caller manifest and criteria
	// projections never decide eligibility: absent or zero prepared evidence
	// fails closed, and every native defect also fails criterion 1 (plus criterion
	// 9 when the atomic active-industry row is the defective row).
	prepared := ev.Prepared
	if prepared == nil || !prepared.loaded {
		detail := "observed native evidence is absent; the canonical MUST set, anchors, non-goal scan, and architecture scan cannot be validated"
		add(KindUnpreparedEvidence, "prepared-evidence", detail)
		addCriterion(criterionC1, detail)
	} else {
		violations := nativeManifestViolations(*prepared)
		violations = append(violations, effectiveDrift(prepared.effective)...)
		for _, violation := range violations {
			detail := nativeDetail(violation.Rule, violation.Detail)
			reason := violation.Rule + ": " + detail
			add(nativeKind(violation.Rule), violation.File, detail)
			addCriterion(criterionC1, reason)
			if strings.Contains(violation.File, atomicIndustryGateTitle) || strings.Contains(detail, atomicIndustryGateTitle) {
				addCriterion(criterionC9, reason)
			}
		}
	}

	// 2. Validate raw receipts, reject ambiguous gates, then build the
	// decision-only index from unique validated evidence.
	byGate, receiptBlockers := validatedGateReceipts(ev.RawReceipts)
	blockers = append(blockers, receiptBlockers...)

	// 3. The nine required gate receipts are a package-owned constant set, and
	// each gate failure fails the criterion that owns that gate: the
	// build/vet/fmt/unit/race receipts own criterion 2, integration owns criterion
	// 3, migrations and sqlc own criterion 4, and the architecture gate owns
	// criterion 11.
	for _, gate := range defaultRequiredGates {
		rec, ok := byGate[gate]
		if !ok {
			add(KindMissingReceipt, gate, "required receipt absent")
		} else if !receiptPasses(rec, ev.TreeIdentity, ev.WorktreeState) {
			switch rec.Tree {
			case ev.TreeIdentity:
				if rec.WorktreeState != ev.WorktreeState {
					add(KindStaleReceipt, gate,
						fmt.Sprintf("receipt worktree_state %q does not match evidence worktree state %q", rec.WorktreeState, ev.WorktreeState))
					break
				}
				add(KindFailedReceipt, gate, fmt.Sprintf("status %q exit %d", rec.Status, rec.ExitCode))
			default:
				add(KindStaleReceipt, gate,
					fmt.Sprintf("receipt tree %q does not match evidence identity %q", rec.Tree, ev.TreeIdentity))
			}
		}
		for _, skip := range rec.SkipNames {
			add(KindIntegrationSkip, gate+"/"+skip, "unexplained integration skip")
		}
		if !ok || !receiptPasses(rec, ev.TreeIdentity, ev.WorktreeState) || len(rec.SkipNames) > 0 {
			addCriterion(criterionForGate(gate),
				fmt.Sprintf("criterion gate %q is not a passing zero-skip same-identity receipt", gate))
		}
	}

	// 4. The skip whitelist must be empty: proposal §9 criterion 3. The whitelist is
	// opaque native observed evidence: an unobserved whitelist fails criterion 3 even
	// when the legacy caller projection is zero, and a nonzero observed length
	// blocks. The retained Evidence.SkipWhitelistLen projection never decides
	// eligibility.
	whitelistObserved := prepared != nil && prepared.loaded && prepared.whitelistObserved
	switch {
	case !whitelistObserved:
		detail := "observed native skip-whitelist is absent"
		add(KindSkipWhitelist, "skip-whitelist", detail)
		addCriterion(criterionC3, detail)
	case prepared.whitelistLen != 0:
		detail := fmt.Sprintf("length %d, want 0", prepared.whitelistLen)
		add(KindSkipWhitelist, "skip-whitelist", detail)
		addCriterion(criterionC3, "skip whitelist "+detail)
	}

	// 5. The three built executables with runtime boundary tests are a
	// package-owned constant set; a missing one fails criterion 5.
	counts := map[string]int{}
	withBoundary := map[string]bool{}
	for _, ex := range ev.Executables {
		counts[ex.Name]++
		if ex.RuntimeBoundaryTests {
			withBoundary[ex.Name] = true
		}
	}
	for _, name := range defaultRequiredExecutables {
		detail := "built executable with runtime-boundary tests absent"
		if counts[name] > 1 {
			detail = fmt.Sprintf("duplicate executable evidence: %d entries, want exactly 1", counts[name])
		}
		if counts[name] != 1 || !withBoundary[name] {
			add(KindExecutable, name, detail)
			addCriterion(criterionC5, fmt.Sprintf("required executable %q: %s", name, detail))
		}
	}

	// 6. The twelve proposal §9 criteria are a fixed, package-owned set. The row
	// sets of criteria 6, 7, and 8 are derived from the package-owned canonical
	// set, never from caller data; criterion 8 shares the stable error-code catalog
	// row with criterion 7.
	validRows := map[archguard.EffectiveRequirement]bool{}
	if prepared != nil && prepared.loaded {
		keyCounts := map[archguard.EffectiveRequirement]int{}
		for _, row := range prepared.manifest.Rows {
			keyCounts[archguard.EffectiveRequirement{Capability: row.Capability, Title: row.Requirement}]++
		}
		for _, row := range prepared.manifest.Rows {
			key := archguard.EffectiveRequirement{Capability: row.Capability, Title: row.Requirement}
			if validObservedRow(row, prepared.index, keyCounts[key]) {
				validRows[key] = true
			}
		}
	}
	for criterion, required := range criterionRowRequirements() {
		for _, req := range required {
			if !validRows[req] {
				addCriterion(criterion, fmt.Sprintf("required MUST row (%s, %q) is absent or its evidence is invalid in the observed manifest", req.Capability, req.Title))
			}
		}
	}

	// 7. Criterion 9: the atomic active-industry gate row must be valid evidence
	// and its plural implementation-path owners must include the exact SQL file,
	// and that file must declare its exact query symbol, so an arbitrary SQL owner
	// can never satisfy the criterion.
	var atomicRow archguard.TraceabilityRow
	atomicValid := false
	if prepared != nil && prepared.loaded {
		for _, row := range prepared.manifest.Rows {
			if row.Capability == "companies" && row.Requirement == atomicIndustryGateTitle {
				atomicRow = row
				atomicValid = validRows[archguard.EffectiveRequirement{Capability: row.Capability, Title: row.Requirement}]
			}
		}
	}
	switch {
	case !atomicValid:
		addCriterion(criterionC9, fmt.Sprintf("required atomic active-industry MUST row (companies, %q) is absent or its evidence is invalid in the observed manifest", atomicIndustryGateTitle))
	case !slices.Contains(atomicRow.Owners, atomicIndustrySQLOwner):
		addCriterion(criterionC9, fmt.Sprintf("atomic active-industry row owners %q must include %q", atomicRow.Owners, atomicIndustrySQLOwner))
	case !slices.Contains(prepared.sqlSymbols, atomicIndustrySQLSymbol):
		addCriterion(criterionC9, fmt.Sprintf("observed %q does not declare the atomic gate query %q", atomicIndustrySQLOwner, atomicIndustrySQLSymbol))
	}

	// 8. Criteria 10 and 11 each require their OWN observed native scan: an
	// explicitly observed empty scan passes its criterion, while an unobserved scan
	// fails only its owning criterion instead of passing silently.
	nonGoalObserved := prepared != nil && prepared.loaded && prepared.nonGoalObserved
	architectureObserved := prepared != nil && prepared.loaded && prepared.architectureObserved
	var nonGoalScan, architectureScan []archguard.Violation
	if nonGoalObserved {
		nonGoalScan = prepared.nonGoal
	}
	if architectureObserved {
		architectureScan = prepared.architecture
	}
	for _, scan := range []struct {
		criterion  string
		kind       string
		subject    string
		observed   bool
		violations []archguard.Violation
	}{
		{criterionC10, KindNonGoal, "non-goal-scan", nonGoalObserved, nonGoalScan},
		{criterionC11, KindArchitecture, "architecture-guard-scan", architectureObserved, architectureScan},
	} {
		if !scan.observed {
			detail := "observed native " + scan.subject + " is absent"
			add(scan.kind, scan.subject, detail)
			addCriterion(scan.criterion, detail)
			continue
		}
		for _, violation := range scan.violations {
			add(scan.kind, violation.File, violation.Detail)
			addCriterion(scan.criterion, violation.Rule+": "+violation.Detail)
		}
	}

	// 9. Legacy non-goal findings are preserved as concrete blockers and as
	// criterion 10 evidence.
	for _, finding := range ev.NonGoalFindings {
		add(KindNonGoal, finding, "locked non-goal scan hit")
		addCriterion(criterionC10, fmt.Sprintf("locked non-goal finding %q", finding))
	}

	// 10. Criterion 12: the four fixed explanatory documents must be actually
	// observed and their validator must report no drift. An unobserved document set
	// keeps the deterministic NO-GO blocker; an observed finding becomes one
	// docs-contradiction blocker per unique finding plus its own criterion 12
	// attribution; observed clean documents leave criterion 12 with no blocker at
	// all. No boolean, waiver, or caller projection can stand in for the observed
	// validator.
	docsObserved := prepared != nil && prepared.loaded && prepared.docsObserved
	if !docsObserved {
		addCriterion(criterionC12, criterion12Detail)
	} else {
		docsSeen := map[DocFinding]bool{}
		for _, finding := range prepared.docsFindings {
			detail := docsFindingDetail(finding)
			addCriterion(criterionC12, detail)
			if docsSeen[finding] {
				continue
			}
			docsSeen[finding] = true
			add(KindDocsContradiction, finding.Path, detail)
		}
	}

	sort.Slice(blockers, func(i, j int) bool {
		a, b := blockers[i], blockers[j]
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		if a.Subject != b.Subject {
			return a.Subject < b.Subject
		}
		return a.Detail < b.Detail
	})

	decision := DecisionGo
	if len(blockers) > 0 {
		decision = DecisionNoGo
	}
	return Report{Decision: decision, Blockers: blockers}
}

// WriteJSON writes the report as one JSON line: the canonical write path for
// the decision artifact.
func (r Report) WriteJSON(w io.Writer) error {
	return json.NewEncoder(w).Encode(r)
}
