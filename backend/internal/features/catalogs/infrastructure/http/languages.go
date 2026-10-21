// Package http exposes anonymous, embedded reference catalogs.
package http

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

// The collator is used only during initialization: collators are not safe for
// concurrent use. The resulting representation and validator never change.
var languageBody, languageETag = languageRepresentation()

func languageRepresentation() ([]byte, string) {
	items := languages.All()
	c := collate.New(language.Spanish, collate.IgnoreCase, collate.IgnoreDiacritics)
	sort.Slice(items, func(i, j int) bool {
		order := c.CompareString(items[i].Name, items[j].Name)
		if order == 0 {
			return items[i].Code < items[j].Code
		}
		return order < 0
	})
	body, err := json.Marshal(struct {
		Items []languages.Item `json:"items"`
	}{items})
	if err != nil {
		panic(err)
	} // Only strings and a slice: encoding cannot fail.
	return body, fmt.Sprintf(`"%x"`, sha256.Sum256(body))
}

// Languages serves the public catalog without authentication or database access.
func Languages(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("ETag", languageETag)
	// GET If-None-Match uses weak comparison, even though our validator is strong.
	for _, line := range r.Header.Values("If-None-Match") {
		for _, candidate := range strings.Split(line, ",") {
			tag := strings.TrimSpace(candidate)
			if tag == "*" || strings.TrimPrefix(tag, "W/") == languageETag {
				w.WriteHeader(http.StatusNotModified)
				return
			}
		}
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(languageBody)
}
