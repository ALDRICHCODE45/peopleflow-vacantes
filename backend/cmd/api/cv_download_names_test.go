package main

import (
	"context"
	"io"
	"mime"
	"net/http"
	"strings"
	"testing"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	pool "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	boardhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http/board"
	poolhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http/pool"
	companies "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
)

type namedPoolCVReader struct {
	orgCVReader
	name, typ string
}

func (s *namedPoolCVReader) File(context.Context, uuid.UUID, string, uuid.UUID, uuid.UUID) (board.File, error) {
	return namedCVFile(s.name, s.typ), nil
}
func (s *namedPoolCVReader) OriginalFile(context.Context, uuid.UUID, string, uuid.UUID, uuid.UUID) (board.File, error) {
	return namedCVFile(s.name, s.typ), nil
}

type namedBoardCVStore struct {
	movementRouteStore
	name, typ string
	corrected bool
}

func (s *namedBoardCVStore) File(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (board.File, error) {
	out := namedCVFile(s.name, s.typ)
	out.CompanyCorrected = s.corrected
	return out, nil
}
func (s *namedBoardCVStore) OriginalFile(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (board.File, error) {
	return namedCVFile(s.name, s.typ), nil
}
func namedCVFile(name, typ string) board.File {
	return board.File{Name: name, ContentType: typ, Size: 6, Reader: io.NopCloser(strings.NewReader("%PDF-x"))}
}

func TestCVDownloadAttachmentNames(t *testing.T) {
	headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	for _, surface := range []string{"pool", "board"} {
		t.Run(surface, func(t *testing.T) {
			for _, download := range []string{"corrected", "original", "uncorrected"} {
				t.Run(download, func(t *testing.T) {
					for _, format := range []struct{ extension, typ string }{{".pdf", "application/pdf"}, {".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}} {
						t.Run(format.extension, func(t *testing.T) {
							for _, name := range []string{"cv", "CV-Flores-Corregido" + format.extension, "CV-Flores-Corregido" + strings.ToUpper(format.extension)} {
								t.Run(name, func(t *testing.T) {
									var handler http.Handler
									var path string
									if surface == "pool" {
										reader := &namedPoolCVReader{name: name, typ: format.typ}
										handler = newRouter(routerDeps{candidatePoolHandler: poolhttp.NewHandler(pool.NewService(reader)), requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(companies.RecruiterRole, routeTestRecruiterHeader), requireOwner: routeRoleGate(companies.OwnerRole, routeTestOwnerHeader)})
										path = orgCandidatesPath + "/organic/" + routeTestDraftID.String() + "/participations/" + routeTestDraftID.String() + "/cv"
									} else {
										store := &namedBoardCVStore{name: name, typ: format.typ, corrected: download == "corrected"}
										handler = newRouter(routerDeps{movementHandler: boardhttp.NewHandler(store), requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(companies.RecruiterRole, routeTestRecruiterHeader), requireOwner: routeRoleGate(companies.OwnerRole, routeTestOwnerHeader)})
										path = "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/participations/" + routeTestDraftID.String() + "/cv"
									}
									if download == "original" {
										path += "/original"
									}
									w := doRouteRequest(t, handler, "GET", path, "", headers)
									assertDraftRouteNoStore(t, w)
									want := name + format.extension
									// Preserve the board's original/non-corrected naming byte-for-byte, even
									// for suffixed names. Only company-corrected board downloads deduplicate.
									if (surface == "pool" || download == "corrected") && strings.HasSuffix(strings.ToLower(name), format.extension) {
										want = name
									}
									if w.Code != 200 || w.Header().Get("Content-Disposition") != mime.FormatMediaType("attachment", map[string]string{"filename": want}) || w.Header().Get("Content-Type") != format.typ || w.Header().Get("Content-Length") != "6" || w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Body.String() != "%PDF-x" {
										t.Fatalf("status=%d headers=%v want filename=%q body=%s", w.Code, w.Header(), want, w.Body.String())
									}
								})
							}
						})
					}
				})
			}
		})
	}
}
