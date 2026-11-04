package config

import "strings"

// LoadAuditProxySecret reads AUDIT_PROXY_SECRET, the secret the Next BFF sends
// in X-PF-Proxy-Secret (audit-log-v1 §4). Unset or blank means no forwarded
// client header is ever trusted. The value is never logged.
func LoadAuditProxySecret(getenv func(string) string) string {
	return strings.TrimSpace(getenv("AUDIT_PROXY_SECRET"))
}
