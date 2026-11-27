package httpjson

import "net/http"

// CodeNotificationPreferenceLocked refuses a preference PUT that tries to change
// a mandatory (locked) type × channel pair (notifications-v2 §Preferences).
const CodeNotificationPreferenceLocked Code = "notification_preference_locked"

// CodeUnsubscribeLinkInvalid answers every invalid unsubscribe token
// (malformed, bad MAC, unknown key, expired, mandatory or foreign type, user
// gone) with identical bytes and no data (notifications-v2 §Unsubscribe).
const CodeUnsubscribeLinkInvalid Code = "unsubscribe_link_invalid"

// NotificationErrorCodes lists the notification catalog codes.
func NotificationErrorCodes() []Code {
	return []Code{CodeNotificationPreferenceLocked, CodeUnsubscribeLinkInvalid}
}

func resolveNotificationError(code Code) (Definition, bool) {
	switch code {
	case CodeNotificationPreferenceLocked:
		return Definition{code, http.StatusUnprocessableEntity, "notification preference locked"}, true
	case CodeUnsubscribeLinkInvalid:
		return Definition{code, http.StatusUnprocessableEntity, "unsubscribe link invalid"}, true
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
