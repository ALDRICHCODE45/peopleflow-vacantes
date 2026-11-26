package httpjson

import (
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestNotificationErrorCodes(t *testing.T) {
	if want := []Code{"notification_preference_locked"}; !reflect.DeepEqual(NotificationErrorCodes(), want) {
		t.Fatal(NotificationErrorCodes())
	}
	def := Resolve(CodeNotificationPreferenceLocked)
	if def.Status != 422 || def.Code != CodeNotificationPreferenceLocked || def.Message != "notification preference locked" {
		t.Fatal(def)
	}
}

func TestWriteNotificationPreferenceLocked(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteNotificationPreferenceLocked(rec, []string{"delivery_overdue", "vacancy_assigned"})
	want := `{"error":"notification preference locked","code":"notification_preference_locked","data":{"types":["delivery_overdue","vacancy_assigned"]}}` + "\n"
	if rec.Code != 422 || rec.Body.String() != want {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	// A nil list still serialises as an array, never null.
	rec = httptest.NewRecorder()
	WriteNotificationPreferenceLocked(rec, nil)
	if want := `{"error":"notification preference locked","code":"notification_preference_locked","data":{"types":[]}}` + "\n"; rec.Body.String() != want {
		t.Fatalf("%s", rec.Body.String())
	}
}
