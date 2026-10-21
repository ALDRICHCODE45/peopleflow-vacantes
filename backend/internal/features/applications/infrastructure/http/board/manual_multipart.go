package board

import (
	"errors"
	"io"
	"net/http"
	"path"
	"strings"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
)

// Keep the transport budget local: applications infrastructure cannot import
// another feature's CV application package. The composition root must inject
// cvs.Inspect into the eventual write operation.
const maxManualCVBytes = 5_242_880

var errManualCVTooLarge = errors.New("manual CV too large")

// manualMultipart holds bounded in-memory input. Content inspection belongs to
// the write operation, after authorization, replay, validation and duplicates.
// In particular, parsing must not write a file or call ParseMultipartForm.
type manualMultipart struct {
	Data     []byte
	CV       []byte
	Filename string
}

func readManualMultipart(w http.ResponseWriter, r *http.Request) (manualMultipart, error) {
	var out manualMultipart
	r.Body = http.MaxBytesReader(w, r.Body, int64(maxManualCVBytes+65536))
	reader, err := r.MultipartReader()
	if err != nil {
		return out, app.ErrInvalidRequest
	}
	seenData, seenCV := false, false
	for {
		part, err := reader.NextRawPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return manualMultipart{}, manualMultipartError(err)
		}
		if part.Header.Get("Content-Transfer-Encoding") != "" {
			return manualMultipart{}, app.ErrInvalidRequest
		}
		switch part.FormName() {
		case "data":
			if seenData || part.FileName() != "" {
				return manualMultipart{}, app.ErrInvalidRequest
			}
			seenData = true
			out.Data, err = io.ReadAll(io.LimitReader(part, 65537))
			if err != nil {
				return manualMultipart{}, manualMultipartError(err)
			}
			if len(out.Data) > 65536 {
				return manualMultipart{}, app.ErrInvalidRequest
			}
		case "cv":
			if seenCV || part.FileName() == "" {
				return manualMultipart{}, app.ErrInvalidRequest
			}
			seenCV = true
			out.Filename = path.Base(strings.ReplaceAll(part.FileName(), `\`, "/"))
			out.CV, err = io.ReadAll(io.LimitReader(part, int64(maxManualCVBytes+1)))
			if err != nil {
				return manualMultipart{}, manualMultipartError(err)
			}
			if len(out.CV) > maxManualCVBytes {
				return manualMultipart{}, errManualCVTooLarge
			}
		default:
			return manualMultipart{}, app.ErrInvalidRequest
		}
		if err := part.Close(); err != nil {
			return manualMultipart{}, manualMultipartError(err)
		}
	}
	// NextRawPart stops at the final boundary. Drain any epilogue through the
	// same raw-body limit so a valid prefix cannot bypass the request budget.
	if _, err := io.Copy(io.Discard, r.Body); err != nil {
		return manualMultipart{}, manualMultipartError(err)
	}
	if !seenData {
		return manualMultipart{}, app.ErrInvalidRequest
	}
	if !seenCV {
		return manualMultipart{}, &app.ManualValidationError{Fields: []app.ManualFieldError{{Field: "cv", Code: "required"}}}
	}
	return out, nil
}

func manualMultipartError(err error) error {
	var max *http.MaxBytesError
	if errors.As(err, &max) {
		return errManualCVTooLarge
	}
	return app.ErrInvalidRequest
}
