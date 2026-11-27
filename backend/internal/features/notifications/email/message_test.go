package email

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"testing"
)

// Verifier finding (E5, D19): a Message carries the address, subject, bodies
// and the unsubscribe token in its headers. Every fmt verb, slog (text and
// JSON) and encoding/json render only its value-free metadata (delivery id,
// type, template).
func TestMessageIsRedactedEverywhere(t *testing.T) {
	m := Message{
		To: "person@example.test", From: "PeopleFlow <no-reply@peopleflow.test>", Subject: "Nueva postulación en Secreto",
		Text: "body text secreto", HTML: "<p>body html secreto</p>", MessageID: "<d1@peopleflow.test>",
		Headers:    map[string]string{"List-Unsubscribe": "<https://app.test/api/notificaciones/baja?token=k1.tok.mac>"},
		DeliveryID: "0193c0de-0000-7000-8000-000000000001", Type: "application_received", Template: "application_received.one",
	}
	var out strings.Builder
	for _, verb := range []string{"%v", "%+v", "%#v", "%s", "%q", "%d", "%x", "%X", "%o", "%b", "%20v"} {
		for _, v := range []any{m, &m, []Message{m}, map[string]Message{"m": m}, struct{ M Message }{m}} {
			fmt.Fprintf(&out, verb+"\n", v)
		}
	}
	var logged bytes.Buffer
	slog.New(slog.NewJSONHandler(&logged, nil)).Info("m", "msg", m, "ptr", &m)
	slog.New(slog.NewTextHandler(&logged, nil)).Info("m", "msg", m, "ptr", &m)
	asJSON, err := json.Marshal(map[string]any{"msg": m, "ptr": &m})
	if err != nil {
		t.Fatal(err)
	}
	all := out.String() + logged.String() + string(asJSON)
	for _, leak := range []string{"person@", "example.test", "Secreto", "secreto", "token=", "k1.tok", "no-reply", "d1@", "7065727", "706572736f6e"} {
		if strings.Contains(all, leak) {
			t.Fatalf("message content %q printed:\n%s", leak, all)
		}
	}
	for _, want := range []string{m.DeliveryID, m.Type, m.Template} {
		if !strings.Contains(all, want) {
			t.Fatalf("metadata %q missing:\n%s", want, all)
		}
	}
	if s := m.String(); s != "email.Message{delivery_id="+m.DeliveryID+" type="+m.Type+" template="+m.Template+"}" {
		t.Fatalf("String() = %q", s)
	}
}
