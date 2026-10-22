package httpjson

import "strings"

// AttachmentFilename retains an existing case-insensitive suffix rather than
// doubling it. Callers supply the extension dictated by the stored MIME type.
func AttachmentFilename(name, extension string) string {
	if strings.HasSuffix(strings.ToLower(name), strings.ToLower(extension)) {
		return name
	}
	return name + extension
}
