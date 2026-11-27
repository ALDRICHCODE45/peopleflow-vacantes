// Package logmail is the NOTIFICATIONS_MAILER=log adapter (notifications-v2
// D13): one structured line per email with the delivery id, type, template
// and whether it carries an unsubscribe header — never the address, subject,
// bodies, headers or token (D19). For CI and dev without Mailpit.
package logmail

import (
	"context"
	"log/slog"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email"
)

// Mailer writes value-free log lines instead of sending.
type Mailer struct {
	logger *slog.Logger
}

var _ email.Mailer = (*Mailer)(nil)

// New returns a log mailer; a nil logger means slog.Default().
func New(logger *slog.Logger) *Mailer {
	if logger == nil {
		logger = slog.Default()
	}
	return &Mailer{logger: logger}
}

// Send logs the message metadata and returns its Message-ID as provider id.
func (m *Mailer) Send(ctx context.Context, msg email.Message) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	_, unsubscribe := msg.Headers["List-Unsubscribe"]
	m.logger.LogAttrs(ctx, slog.LevelInfo, "notification email (log mailer)",
		slog.String("delivery_id", msg.DeliveryID),
		slog.String("type", msg.Type),
		slog.String("template", msg.Template),
		slog.Bool("has_unsubscribe", unsubscribe),
	)
	return msg.MessageID, nil
}
