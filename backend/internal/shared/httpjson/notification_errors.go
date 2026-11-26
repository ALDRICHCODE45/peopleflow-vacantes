package httpjson

import "net/http"

// CodeNotificationPreferenceLocked refuses a preference PUT that tries to change
// a mandatory (locked) type × channel pair (notifications-v2 §Preferences).
const CodeNotificationPreferenceLocked Code = "notification_preference_locked"

// NotificationErrorCodes lists the notification catalog codes.
func NotificationErrorCodes() []Code { return []Code{CodeNotificationPreferenceLocked} }

func resolveNotificationError(code Code) (Definition, bool) {
	if code == CodeNotificationPreferenceLocked {
		return Definition{code, http.StatusUnprocessableEntity, "notification preference locked"}, true
	}
	return Definition{}, false
}

// WriteNotificationPreferenceLocked answers 422 notification_preference_locked
// with `data {types}`: the locked types the request tried to change.
func WriteNotificationPreferenceLocked(w http.ResponseWriter, types []string) {
	if types == nil {
		types = []string{}
	}
	def := normalizeDefinition(Resolve(CodeNotificationPreferenceLocked))
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, ErrorEnvelope{Error: def.Message, Code: def.Code, Data: map[string]any{"types": types}})
}
