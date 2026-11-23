// Package documents holds the application rules of placement and vacancy
// documents (docs/contracts/placement-vacancy-documents-v1.md): limits, accepted
// formats, content inspection over a head + tail window and display names. It has
// no storage, HTTP or SQL; those arrive in later slices.
package documents

const (
	// MaxBytes is the size limit of one file (D8): 10 MB.
	MaxBytes = 10_485_760
	// RequestOverhead is the multipart allowance on top of MaxBytes.
	RequestOverhead = 65_536
	// MaxRequestBytes caps the whole request body (http.MaxBytesReader).
	MaxRequestBytes = MaxBytes + RequestOverhead

	// MaxVacancyDocuments and MaxParticipationDocuments bound files plus links per scope (D15).
	MaxVacancyDocuments       = 50
	MaxParticipationDocuments = 20
	// MaxVersions bounds the versions of one document (D7).
	MaxVersions = 25

	// HeadSize and TailWindow are the bytes kept while streaming for inspection (D9).
	HeadSize   = 16
	TailWindow = 2 << 20

	// MaxNameRunes is the display name limit (cvs.NormalizeName).
	MaxNameRunes = 120
	// FallbackName names a document whose file name leaves nothing once the extension is removed (D11).
	FallbackName = "Documento"
)
