package valueobjects

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// InvitationNoteMaxRunes is the longest stakeholder invitation note, counted in
// Unicode code points after NFC and trimming (migration 00065 checks the same
// bound with char_length).
const InvitationNoteMaxRunes = 80

// ErrInvalidInvitationNote: the note is not valid UTF-8, holds a control
// character after trimming, or is longer than InvitationNoteMaxRunes. The HTTP
// layer answers 400 validation_error with field "note", code "invalid".
var ErrInvalidInvitationNote = errors.New("invalid invitation note")

// ParseInvitationNote normalizes the optional note of a stakeholder invitation
// (stakeholder-metrics-v1 §1.3): valid UTF-8, NFC, leading and trailing white
// space trimmed, no control character left (inner tabs and newlines included),
// 1..InvitationNoteMaxRunes runes. Absent, empty or blank is nil (no note).
func ParseInvitationNote(raw *string) (*string, error) {
	if raw == nil {
		return nil, nil
	}
	if !utf8.ValidString(*raw) {
		return nil, ErrInvalidInvitationNote
	}
	note := strings.TrimSpace(norm.NFC.String(*raw))
	if note == "" {
		return nil, nil
	}
	for _, r := range note {
		if unicode.IsControl(r) {
			return nil, ErrInvalidInvitationNote
		}
	}
	if utf8.RuneCountInString(note) > InvitationNoteMaxRunes {
		return nil, ErrInvalidInvitationNote
	}
	return &note, nil
}
