package documents

import (
	"path"
	"strings"
)

// Format is the closed `format` enum the frontend decodes (D8).
type Format string

const (
	PDF  Format = "pdf"
	DOCX Format = "docx"
	XLSX Format = "xlsx"
	JPG  Format = "jpg"
	PNG  Format = "png"
)

// Descriptor is one entry of `limits.formats`: what the UI needs for `accept` and its copy.
type Descriptor struct {
	Format      Format   `json:"format"`
	Extensions  []string `json:"extensions"`
	ContentType string   `json:"content_type"`
}

const (
	contentTypePDF  = "application/pdf"
	contentTypeDOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	contentTypeXLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	contentTypeJPG  = "image/jpeg"
	contentTypePNG  = "image/png"
)

// table is the single source of truth, in the order the descriptors are listed.
var table = []Descriptor{
	{PDF, []string{".pdf"}, contentTypePDF},
	{DOCX, []string{".docx"}, contentTypeDOCX},
	{XLSX, []string{".xlsx"}, contentTypeXLSX},
	{JPG, []string{".jpg", ".jpeg"}, contentTypeJPG},
	{PNG, []string{".png"}, contentTypePNG},
}

// Formats returns the descriptors of every accepted format. The result is a copy.
func Formats() []Descriptor {
	out := make([]Descriptor, len(table))
	for i, d := range table {
		d.Extensions = append([]string(nil), d.Extensions...)
		out[i] = d
	}
	return out
}

func (f Format) descriptor() (Descriptor, bool) {
	for _, d := range table {
		if d.Format == f {
			return d, true
		}
	}
	return Descriptor{}, false
}

// ContentType is the stored content type of the format, "" for an unknown one.
func (f Format) ContentType() string {
	d, _ := f.descriptor()
	return d.ContentType
}

// Extension is the canonical extension of the format with its dot (".jpg" for JPG), "" for an unknown one.
func (f Format) Extension() string {
	d, ok := f.descriptor()
	if !ok {
		return ""
	}
	return d.Extensions[0]
}

// FormatFromContentType maps a stored content type back to its format.
func FormatFromContentType(contentType string) (Format, bool) {
	for _, d := range table {
		if d.ContentType == contentType {
			return d.Format, true
		}
	}
	return "", false
}

// FormatForExtension maps an extension with its dot, in any case, to its format.
func FormatForExtension(ext string) (Format, bool) {
	ext = strings.ToLower(ext)
	for _, d := range table {
		for _, e := range d.Extensions {
			if e == ext {
				return d.Format, true
			}
		}
	}
	return "", false
}

// fileExtension is the extension of a client file name as it will be judged: lower-cased, with its dot.
func fileExtension(filename string) string {
	return strings.ToLower(path.Ext(filename))
}
