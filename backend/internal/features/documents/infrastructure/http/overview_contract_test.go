package http

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
)

// The example JSON of «GET V/document-overview» in docs/contracts/placement-vacancy-documents-v1.md is not prose: it is exactly what the
// handler writes for the values below, key for key. Editing either side without the other fails this test.

const contractPath = "../../../../../../docs/contracts/placement-vacancy-documents-v1.md"

func contractExample(t *testing.T, heading string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.FromSlash(contractPath))
	if err != nil {
		t.Skipf("contract not readable from this checkout: %v", err)
	}
	text := string(raw)
	at := strings.Index(text, heading)
	if at < 0 {
		t.Fatalf("heading %q not found in the contract", heading)
	}
	rest := text[at:]
	open := strings.Index(rest, "```json\n")
	if open < 0 {
		t.Fatalf("no json block after %q", heading)
	}
	rest = rest[open+len("```json\n"):]
	end := strings.Index(rest, "\n```")
	if end < 0 {
		t.Fatalf("unterminated json block after %q", heading)
	}
	return []byte(rest[:end])
}

func sp(s string) *string { return &s }

func TestOverviewContractExampleIsWhatTheHandlerWrites(t *testing.T) {
	manager := documents.Person{ID: "0193c0cc-0000-7000-8000-000000000031", Name: "Ana López"}
	luis := documents.Person{ID: "0193c0cc-0000-7000-8000-000000000032", Name: "Luis Ortega"}
	marta := documents.NamedCandidate{Kind: "manual", ID: "0193c0dd-0000-7000-8000-000000000041", FullName: "Marta Ruiz"}
	zoe := documents.NamedCandidate{Kind: "organic", ID: "0193c0dd-0000-7000-8000-000000000042", FullName: "Zoe Zapata"}
	p1, p2 := "0193c0bb-0000-7000-8000-000000000021", "0193c0bb-0000-7000-8000-000000000022"
	martaPart := documents.OverviewParticipation{
		ParticipationID: p1, Candidate: marta, Stage: documents.Stage{Kind: "placement", Name: "Placement"},
		ScopeAllowedActions: []documents.Action{documents.ActionUpload, documents.ActionLink},
	}
	limit := documents.BlockedLimitReached
	overview := documents.Overview{
		Vacancy: documents.OverviewVacancy{
			ID: "0193c000-0000-7000-8000-000000000001", Title: sp("Analista contable"), Publication: sp("published"), Process: sp("active"),
			Kind: "replacement", Visibility: sp("private"),
		},
		Scope: documents.BuildScope(documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: true, CanReceiveLinks: true, Documents: 1, Links: 1}),
		Items: []documents.OverviewItem{
			{Item: documents.Item{
				ID: "0193c0aa-0000-7000-8000-000000000011", ParticipationID: &p1, Name: "Contrato firmado", Format: documents.PDF, ContentType: "application/pdf",
				Size: 183204, Version: 2, VersionCount: 2, CreatedAt: "2026-11-20T15:02:11.482910Z", CreatedBy: manager,
				UpdatedAt: "2026-11-22T09:40:03.100200Z", UpdatedBy: luis, AllowedActions: documents.ItemActions(true, 2),
			}, Owner: documents.ParticipationOwner(martaPart)},
			{Item: documents.Item{
				ID: "0193c0aa-0000-7000-8000-000000000012", Name: "Contrato marco", Format: documents.DOCX, ContentType: documents.DOCX.ContentType(),
				Size: 91200, Version: 1, VersionCount: 1, CreatedAt: "2026-11-20T15:02:11.482910Z", CreatedBy: manager,
				UpdatedAt: "2026-11-20T15:02:11.482910Z", UpdatedBy: manager, AllowedActions: documents.ItemActions(true, 1),
			}, Owner: documents.VacancyOwner()},
		},
		Links: []documents.OverviewLink{
			{Link: documents.Link{
				ID: "0193c0ee-0000-7000-8000-000000000051", State: documents.LinkAvailable, LinkedAt: "2026-11-22T10:00:00.000000Z", LinkedBy: manager,
				AllowedActions: documents.LinkActions(true, documents.LinkAvailable),
				Source: &documents.LinkSource{
					DocumentID: "0193c0ff-0000-7000-8000-000000000061", ProcessID: "0193bfff-0000-7000-8000-000000000001", Sequence: 0, Name: "Contrato original",
					Format: documents.DOCX, Size: 91200, Version: 1, VersionCount: 3, UploadedAt: "2026-10-03T12:00:00.000000Z", UploadedBy: manager, HasNewerVersion: true,
				},
			}, Owner: documents.VacancyOwner()},
			{Link: documents.Link{
				ID: "0193c0ee-0000-7000-8000-000000000052", State: documents.LinkRemoved, LinkedAt: "2026-11-21T08:30:00.000000Z", LinkedBy: manager,
				AllowedActions: documents.LinkActions(true, documents.LinkRemoved),
			}, Owner: documents.ParticipationOwner(martaPart)},
		},
		Participations: []documents.OverviewParticipation{
			martaPart,
			{ParticipationID: p2, Candidate: zoe, Discarded: true, Stage: documents.Stage{Kind: "screening", Name: "Screening"},
				ScopeAllowedActions: []documents.Action{}, UploadBlockedReason: &limit},
		},
	}

	reader := &fakeOverviewReader{overview: overview}
	rec := serveOverview(t, NewHandler(reader, nil), overview.Vacancy.ID, "", ccFor(t))
	if rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	var written, documented any
	if err := json.Unmarshal(rec.Body.Bytes(), &written); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(contractExample(t, "### `GET V/document-overview`"), &documented); err != nil {
		t.Fatalf("the contract example is not valid JSON: %v", err)
	}
	if !reflect.DeepEqual(written, documented) {
		got, _ := json.MarshalIndent(written, "", "  ")
		want, _ := json.MarshalIndent(documented, "", "  ")
		t.Fatalf("the contract example differs from the handler's body.\nhandler:\n%s\ncontract:\n%s", got, want)
	}
}
