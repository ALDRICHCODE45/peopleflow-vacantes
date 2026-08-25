package usecases

import (
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/valueobjects"
	"github.com/google/uuid"
)

// --- buildSubmittedMetadata -------------------------------------------------

// TestBuildSubmittedMetadata_WithSource pins D7's PII-free metadata shape for
// the ApplicationSubmitted event when the candidate supplied a source: the
// metadata map MUST contain exactly {job_id, source} — nothing more, nothing
// less. The wire values are the canonical String() forms (job_id as the UUID
// string, source as the lowercase vocabulary value).
func TestBuildSubmittedMetadata_WithSource(t *testing.T) {
	jobID := uuid.MustParse("018e0000-0000-7000-8000-000000000111")
	src := valueobjects.Referral

	got := buildSubmittedMetadata(jobID, &src)

	want := map[string]string{
		"job_id": jobID.String(),
		"source": "referral",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("buildSubmittedMetadata(jobID, Referral): want %v, got %v", want, got)
	}
}

// TestBuildSubmittedMetadata_NilSource pins the nil-source branch: the map is
// EXACTLY {job_id} — a nil source MUST NOT add a "source" key (the adapter
// stores SQL NULL, so the audit metadata must stay `{"job_id": ...}`).
func TestBuildSubmittedMetadata_NilSource(t *testing.T) {
	jobID := uuid.MustParse("018e0000-0000-7000-8000-000000000111")

	got := buildSubmittedMetadata(jobID, nil)

	want := map[string]string{"job_id": jobID.String()}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("buildSubmittedMetadata(jobID, nil): want %v, got %v", want, got)
	}
}

// TestBuildSubmittedMetadata_NeverCoverLetterOrCandidateID pins the PII-free
// invariant structurally: whatever the builders produce, the key set MUST be a
// subset of the closed metadata vocabulary {job_id, source, from_status,
// to_status}. cover_letter, candidate_id, or any other PII key can never leak
// into the audit metadata through these builders (D7 — the builders are the
// only place metadata keys are assembled).
func TestBuildSubmittedMetadata_NeverCoverLetterOrCandidateID(t *testing.T) {
	jobID := uuid.MustParse("018e0000-0000-7000-8000-000000000111")
	src := valueobjects.LinkedIn
	coverLetter := "I am a great fit"
	candidateID := uuid.MustParse("018e0000-0000-7000-8000-000000000222")

	// Exercise the builders with inputs that COULD smuggle PII if the builder
	// signature ever grew to accept them — today only jobID/source reach them.
	got := buildSubmittedMetadata(jobID, &src)
	_ = coverLetter
	_ = candidateID

	allowed := map[string]bool{
		"job_id":      true,
		"source":      true,
		"from_status": true,
		"to_status":   true,
	}
	for key := range got {
		if !allowed[key] {
			t.Errorf("metadata key %q is outside the closed PII-free vocabulary {job_id, source, from_status, to_status}", key)
		}
	}
}

// --- buildTransitionedMetadata ----------------------------------------------

// TestBuildTransitionedMetadata_ExactKeys pins D7's Transitioned metadata
// shape: EXACTLY {job_id, from_status, to_status}, each carrying the canonical
// String() form of its VO.
func TestBuildTransitionedMetadata_ExactKeys(t *testing.T) {
	jobID := uuid.MustParse("018e0000-0000-7000-8000-000000000111")

	got := buildTransitionedMetadata(jobID, valueobjects.Submitted, valueobjects.InReview)

	want := map[string]string{
		"job_id":      jobID.String(),
		"from_status": "submitted",
		"to_status":   "in_review",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("buildTransitionedMetadata: want %v, got %v", want, got)
	}
}
