package logmail

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email"
)

func message(unsubscribe bool) email.Message {
	m := email.Message{
		To:         "persona.secreta@example.test",
		From:       `"PeopleFlow" <no-reply@peopleflow.test>`,
		Subject:    "Nueva postulación en Vacante Secreta",
		Text:       "cuerpo de texto secreto https://app.test/x?token=k1.secret.mac",
		HTML:       "<p>cuerpo html secreto</p>",
		MessageID:  "<11111111-1111-4111-8111-111111111111@peopleflow.test>",
		Headers:    map[string]string{"Auto-Submitted": "auto-generated"},
		DeliveryID: "11111111-1111-4111-8111-111111111111",
		Type:       "application_received",
		Template:   "application_received.one",
	}
	if unsubscribe {
		m.Headers["List-Unsubscribe"] = "<https://app.test/api/notificaciones/baja?token=k1.secret.mac>"
		m.Headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
	}
	return m
}

// The log adapter writes one value-free line: delivery id, type, template,
// has-unsubscribe — never the address, subject, bodies, headers or token.
func TestLogMailerWritesOneValueFreeLine(t *testing.T) {
	for _, unsubscribe := range []bool{true, false} {
		var buf bytes.Buffer
		m := New(slog.New(slog.NewJSONHandler(&buf, nil)))
		id, err := m.Send(context.Background(), message(unsubscribe))
		if err != nil {
			t.Fatal(err)
		}
		if id != "<11111111-1111-4111-8111-111111111111@peopleflow.test>" {
			t.Fatalf("provider id %q", id)
		}
		out := buf.String()
		if strings.Count(out, "\n") != 1 {
			t.Fatalf("want one line, got %q", out)
		}
		for _, leak := range []string{"persona", "example.test", "secret", "Secreta", "cuerpo", "postulación", "token", "auto-generated", "no-reply"} {
			if strings.Contains(out, leak) {
				t.Fatalf("log leaked %q: %s", leak, out)
			}
		}
		var line map[string]any
		if err := json.Unmarshal(buf.Bytes(), &line); err != nil {
			t.Fatal(err)
		}
		if line["delivery_id"] != "11111111-1111-4111-8111-111111111111" || line["type"] != "application_received" ||
			line["template"] != "application_received.one" || line["has_unsubscribe"] != unsubscribe {
			t.Fatalf("line %v", line)
		}
		allowed := map[string]bool{"time": true, "level": true, "msg": true, "delivery_id": true, "type": true, "template": true, "has_unsubscribe": true}
		for k := range line {
			if !allowed[k] {
				t.Fatalf("unexpected attribute %q", k)
			}
		}
	}
}

func TestLogMailerHonoursCancellation(t *testing.T) {
	var buf bytes.Buffer
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := New(slog.New(slog.NewJSONHandler(&buf, nil))).Send(ctx, message(false)); err == nil {
		t.Fatal("cancelled context accepted")
	}
	if buf.Len() != 0 {
		t.Fatalf("logged after cancellation: %s", buf.String())
	}
}

func TestLogMailerNilLoggerUsesDefault(t *testing.T) {
	if New(nil) == nil {
		t.Fatal("nil mailer")
	}
}
