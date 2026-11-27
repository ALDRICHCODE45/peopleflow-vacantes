// Package email is the notifications email channel (notifications-v2 D13,
// D14, D15, D22, §Templates): the Mailer port and its Message, the renderer
// that turns a delivery view into a Message with the verbatim Spanish copy,
// labels, fallbacks, Mexico City dates and the frontend path map, and the
// TokenSigner seam of the unsubscribe links (the HMAC signer is E7). Adapters
// live in email/logmail and email/smtpmail; the sender loop (E6) composes them.
package email

import (
	"context"
	"errors"
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
