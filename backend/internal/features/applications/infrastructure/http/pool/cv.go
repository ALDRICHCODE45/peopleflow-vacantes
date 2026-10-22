package pool

import (
	"errors"
	"io"
	"net/http"
	"path"
	"strings"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func cvError(w http.ResponseWriter, err error) {
	var code httpjson.Code
	switch {
	case errors.Is(err, board.ErrManualCVTooLarge):
		code = httpjson.CodeCVTooLarge
	case errors.Is(err, board.ErrManualCVUnsupportedType):
		code = httpjson.CodeCVUnsupportedType
	case errors.Is(err, board.ErrManualCVContentMismatch):
		code = httpjson.CodeCVContentMismatch
	}
	if code != "" {
		httpjson.WriteCatalogError(w, httpjson.Resolve(code))
		return
	}
	editError(w, err)
}

// Same in-memory/raw-envelope budgets as intake; no temporary disk spooling.
// File extension and content policy belong exclusively to the injected inspector.
func readCV(w http.ResponseWriter, r *http.Request) (board.ManualInput, error) {
	const maxCV = 5_242_880
	var out board.ManualInput
	r.Body = http.MaxBytesReader(w, r.Body, maxCV+65536)
	reader, err := r.MultipartReader()
	if err != nil {
		return out, board.ErrInvalidRequest
	}
	seen := false
	translate := func(err error) error {
		var max *http.MaxBytesError
		if errors.As(err, &max) {
			return board.ErrManualCVTooLarge
		}
		return board.ErrInvalidRequest
	}
	for {
		part, err := reader.NextRawPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return out, translate(err)
		}
		if seen || part.FormName() != "cv" || part.FileName() == "" || part.Header.Get("Content-Transfer-Encoding") != "" {
			return out, board.ErrInvalidRequest
		}
		seen = true
		out.FileName = path.Base(strings.ReplaceAll(part.FileName(), `\`, "/"))
		out.CV, err = io.ReadAll(io.LimitReader(part, maxCV+1))
		if err != nil {
			return out, translate(err)
		}
		if len(out.CV) > maxCV {
			return out, board.ErrManualCVTooLarge
		}
		if err = part.Close(); err != nil {
			return out, translate(err)
		}
	}
	if _, err = io.Copy(io.Discard, r.Body); err != nil {
		return out, translate(err)
	}
	if !seen {
		return out, &board.ManualValidationError{Fields: []board.ManualFieldError{{Field: "cv", Code: "required"}}}
	}
	return out, nil
}
func (h *Handler) CorrectCV(w http.ResponseWriter, r *http.Request) {
	cc, kind, id, ok := detailParams(w, r)
	if !ok {
		return
	}
	pid, err := uuid.Parse(chi.URLParam(r, "participationId"))
	if err != nil || pid == uuid.Nil {
		detailError(w, board.ErrNotFound)
		return
	}
	match := strings.TrimSpace(r.Header.Get("If-Match"))
	if match == "" {
		httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodePreconditionRequired))
		return
	}
	input, err := readCV(w, r)
	if err != nil {
		cvError(w, err)
		return
	}
	// Multiple header lines cannot accidentally match one strong token.
	if len(r.Header.Values("If-Match")) != 1 {
		match = "invalid"
	}
	out, err := h.service.CorrectCV(r.Context(), cc.CompanyID, cc.UserID, kind, id, pid, match, input, h.inspector, h.storage)
	if err != nil {
		cvError(w, err)
		return
	}
	w.Header().Set("ETag", out.ETag)
	httpjson.WriteJSON(w, http.StatusOK, out)
}
