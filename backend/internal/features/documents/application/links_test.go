package documents

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

// P7 of placement-vacancy-documents-v1: replacement linking (S3, D16-D19, D22).

// The writer double of the link operations; the other Writer methods live in upload_test.go.
type linkCalls struct {
	linkCmd      LinkCommand
	linkResp     LinkResponse
	unlinkScope  Scope
	unlinkTarget Target
	unlinkID     uuid.UUID
	downloadID   uuid.UUID
	file         File
}

func (f *fakeWriter) Link(_ context.Context, cmd LinkCommand) (LinkResponse, error) {
	f.calls = append(f.calls, "link")
	f.links.linkCmd = cmd
	return f.links.linkResp, f.err
}

func (f *fakeWriter) Unlink(_ context.Context, _, _ uuid.UUID, target Target, link uuid.UUID) (Scope, error) {
	f.calls = append(f.calls, "unlink")
	f.links.unlinkTarget, f.links.unlinkID = target, link
	return f.links.unlinkScope, f.err
}

func (f *fakeWriter) DownloadLink(_ context.Context, _, _ uuid.UUID, target Target, link uuid.UUID) (File, error) {
	f.calls = append(f.calls, "download-link")
	f.links.unlinkTarget, f.links.downloadID = target, link
	return f.links.file, f.err
}

// Linking moves no file, so it works with the storage disabled and never touches the storage.
func TestLinkNeedsNoStorage(t *testing.T) {
	scope := BuildScope(ScopeInput{Kind: ScopeVacancy, CanManage: true, CanReceiveLinks: true, Links: 1})
	w := &fakeWriter{links: linkCalls{linkResp: LinkResponse{Link: Link{ID: "l1", State: LinkAvailable}, Scope: scope}}}
	cmd := LinkCommand{CompanyID: uuid.New(), ActorID: uuid.New(), Target: VacancyTarget(uuid.New()), SourceDocumentID: uuid.New()}
	res, err := NewService(nil, w).Link(context.Background(), cmd)
	if err != nil || res.Link.ID != "l1" || !reflect.DeepEqual(res.Scope, scope) || !reflect.DeepEqual(w.links.linkCmd, cmd) {
		t.Fatalf("res %+v err %v cmd %+v", res, err, w.links.linkCmd)
	}
	if !reflect.DeepEqual(w.calls, []string{"link"}) {
		t.Fatalf("calls %v", w.calls)
	}
}

func TestLinkPassesTheWritersErrorsThrough(t *testing.T) {
	for _, want := range []error{&LinkInvalidError{Reason: LinkNotReplacement}, &AlreadyLinkedError{LinkID: uuid.New()}, &LimitReachedError{Kind: "documents", Limit: 50}, ErrScopeNotFound} {
		_, err := NewService(nil, &fakeWriter{err: want}).Link(context.Background(), LinkCommand{})
		if !errors.Is(err, want) && !sameErrorType(err, want) {
			t.Fatalf("err %v want %v", err, want)
		}
	}
}

func sameErrorType(a, b error) bool { return reflect.TypeOf(a) == reflect.TypeOf(b) }

// Unlink answers {scope} and never touches the storage: the source and its files are not the link's.
func TestUnlinkAnswersTheScopeAndTouchesNoFile(t *testing.T) {
	mem := newMemStorage()
	scope := BuildScope(ScopeInput{Kind: ScopeParticipation, CanManage: true, CanReceiveLinks: true})
	w := &fakeWriter{links: linkCalls{unlinkScope: scope}}
	target, link := ParticipationTarget(uuid.New(), uuid.New()), uuid.New()
	res, err := NewService(mem, w).Unlink(context.Background(), uuid.New(), uuid.New(), target, link)
	if err != nil || !reflect.DeepEqual(res, ScopeResponse{Scope: scope}) || !reflect.DeepEqual(w.links.unlinkTarget, target) || w.links.unlinkID != link {
		t.Fatalf("res %+v err %v", res, err)
	}
	if mem.puts != 0 || len(mem.deletes) != 0 {
		t.Fatalf("storage touched: puts %d deletes %v", mem.puts, mem.deletes)
	}
	if _, err := NewService(mem, &fakeWriter{err: ErrScopeNotFound}).Unlink(context.Background(), uuid.New(), uuid.New(), target, link); !errors.Is(err, ErrScopeNotFound) {
		t.Fatalf("err %v", err)
	}
}

func TestDownloadLinkDelegatesToTheStore(t *testing.T) {
	w := &fakeWriter{err: ErrNotFound}
	target, link := VacancyTarget(uuid.New()), uuid.New()
	if _, err := NewService(newMemStorage(), w).DownloadLink(context.Background(), uuid.New(), uuid.New(), target, link); !errors.Is(err, ErrNotFound) ||
		w.links.downloadID != link || !reflect.DeepEqual(w.links.unlinkTarget, target) {
		t.Fatalf("err %v link %v", err, w.links.downloadID)
	}
}

// The wire shape of the sources list (contract «GET P/document-sources»): can_link and sources always present, never null.
func TestSourcesJSONShape(t *testing.T) {
	pid := "p1"
	body := Sources{CanLink: true, Sources: []SourceGroup{{
		ProcessID: "proc", Sequence: 0, ParticipationID: &pid,
		Documents: []SourceDocument{{ID: "d1", Name: "Contrato original", Format: DOCX, Size: 91200, Version: 1, VersionCount: 1, UpdatedAt: "2026-10-03T12:00:00.000000Z", AlreadyLinked: false}},
	}}}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"can_link":true,"sources":[{"process_id":"proc","sequence":0,"participation_id":"p1","documents":[{"id":"d1","name":"Contrato original","format":"docx","size":91200,"version":1,"version_count":1,"updated_at":"2026-10-03T12:00:00.000000Z","already_linked":false}]}]}`
	if string(raw) != want {
		t.Fatalf("got  %s\nwant %s", raw, want)
	}
	// A vacancy origin has a null participation_id, never an omitted one.
	raw, _ = json.Marshal(SourceGroup{ProcessID: "proc", Documents: []SourceDocument{}})
	if string(raw) != `{"process_id":"proc","sequence":0,"participation_id":null,"documents":[]}` {
		t.Fatalf("vacancy group: %s", raw)
	}
	raw, _ = json.Marshal(NoSources())
	if string(raw) != `{"can_link":false,"sources":[]}` {
		t.Fatalf("empty: %s", raw)
	}
}

// The 201 of a link is {"link": …, "scope": …} (contract «POST P/document-links»).
func TestLinkResponseJSONShape(t *testing.T) {
	raw, err := json.Marshal(LinkResponse{Link: Link{ID: "l1", State: LinkRemoved, AllowedActions: []Action{ActionUnlink}}, Scope: BuildScope(ScopeInput{Kind: ScopeVacancy, CanManage: true})})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil || len(m) != 2 || m["link"] == nil || m["scope"] == nil {
		t.Fatalf("%s %v", raw, err)
	}
}

// The closed enum of document_link_invalid reasons is the contract's.
func TestLinkInvalidReasonsAreTheContractsEnum(t *testing.T) {
	if LinkNotReplacement != "not_replacement" || LinkSourceNotInChain != "source_not_in_chain" || LinkVersionNotFound != "version_not_found" {
		t.Fatal("reason values drifted from the contract")
	}
	if (&LinkInvalidError{Reason: LinkNotReplacement}).Error() == "" || (&AlreadyLinkedError{}).Error() == "" {
		t.Fatal("errors need messages")
	}
}
