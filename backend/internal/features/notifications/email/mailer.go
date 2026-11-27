// Package email is the notifications email channel (notifications-v2 D13,
// D14, D15, D22, §Templates): the Mailer port and its Message, the renderer
// that turns a delivery view into a Message with the verbatim Spanish copy,
// labels, fallbacks, Mexico City dates and the frontend path map, and the
// TokenSigner seam of the unsubscribe links (the HMAC signer is E7). Adapters
// live in email/logmail and email/smtpmail; the sender loop (E6) composes them.
package email

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
)

// ErrPermanent marks a send failure that must not be retried (SMTP 5xx,
// invalid address); adapters wrap it. Any other error is transient.
var ErrPermanent = errors.New("email: permanent failure")

// Message is one rendered email. To, From, Subject, Text, HTML, MessageID and
// Headers are transmitted; DeliveryID, Type and Template are value-free
// metadata for logs (never the address, subject or bodies, D19).
type Message struct {
	To, From, Subject, Text, HTML string
	// MessageID is "<delivery_id@sender domain>" (stable across retries).
	MessageID string
	// Headers: Auto-Submitted on every email; List-Unsubscribe and
	// List-Unsubscribe-Post on non-mandatory types only (D15).
	Headers map[string]string

	DeliveryID string
	Type       string
	Template   string
}

// Mailer sends one Message and returns the provider message id. A
// permanent failure wraps ErrPermanent.
type Mailer interface {
	Send(ctx context.Context, m Message) (providerID string, err error)
}

// String is the value-free rendering of a Message: its delivery id, type and
// template only (never the address, subject, bodies or headers — the token
// travels in List-Unsubscribe —, D19). GoString, Format, LogValue and
// MarshalJSON render the same metadata, so no fmt verb, slog handler or JSON
// encoding can print the content.
func (m Message) String() string {
	return "email.Message{delivery_id=" + m.DeliveryID + " type=" + m.Type + " template=" + m.Template + "}"
}

func (m Message) GoString() string { return m.String() }

func (m Message) Format(f fmt.State, _ rune) { _, _ = f.Write([]byte(m.String())) }

func (m Message) LogValue() slog.Value {
	return slog.GroupValue(slog.String("delivery_id", m.DeliveryID), slog.String("type", m.Type), slog.String("template", m.Template))
}

func (m Message) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		DeliveryID string `json:"delivery_id"`
		Type       string `json:"type"`
		Template   string `json:"template"`
	}{m.DeliveryID, m.Type, m.Template})
}
