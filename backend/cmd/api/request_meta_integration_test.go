//go:build integration

package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres/audittest"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/requestmeta"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// TestRequestMetaReachesTheAuditRow drives the real router and the real audit
// adapter: a gate behind requestMeta appends one event on the request context,
// and the row carries the metadata the middleware chose (audit-log-v1 §4).
func TestRequestMetaReachesTheAuditRow(t *testing.T) {
	pool := requireDraftFlowPool(t)
	const secret = "integration-secret-0123456789abcdef0123456789"
	audit := auditpostgres.NewAuditEventRepository()
	company := uuid.Must(uuid.NewV7())
	appendOnRequest := func(eventID uuid.UUID) func(http.Handler) http.Handler {
		return func(http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				err := pgx.BeginFunc(r.Context(), pool, func(tx pgx.Tx) error {
					return audit.Append(r.Context(), tx, auditentities.AuditEvent{
						ID: eventID, ActorType: auditentities.ActorTypeSystem, EventType: auditentities.EventCompanyUpdated,
						EntityType: auditentities.EntityCompany, EntityID: company, CompanyID: &company,
						Metadata: map[string]string{},
					})
				})
				if err != nil {
					http.Error(w, "append failed", http.StatusInternalServerError)
					return
				}
				w.WriteHeader(http.StatusNoContent)
			})
		}
	}
	for name, tc := range map[string]struct {
		headers map[string]string
		ip      string
		ua      string
		source  string
	}{
		"bff secret":     {map[string]string{"X-PF-Proxy-Secret": secret, "X-PF-Client-IP": "201.141.12.7", "X-PF-Client-User-Agent": "Browser/1.0", "User-Agent": "node"}, "201.141.12.7", "Browser/1.0", "bff"},
		"wrong secret":   {map[string]string{"X-PF-Proxy-Secret": "nope", "X-PF-Client-IP": "6.6.6.6", "X-PF-Client-User-Agent": "Forged/1.0", "User-Agent": "Real/2.0"}, "192.0.2.10", "Real/2.0", "peer"},
		"no secret sent": {map[string]string{"X-PF-Client-IP": "6.6.6.6", "User-Agent": "Real/2.0"}, "192.0.2.10", "Real/2.0", "peer"},
		"bff invalid ip": {map[string]string{"X-PF-Proxy-Secret": secret, "X-PF-Client-IP": "garbage", "X-PF-Client-User-Agent": "Browser/1.0"}, "", "Browser/1.0", "bff"},
	} {
		t.Run(name, func(t *testing.T) {
			eventID := uuid.Must(uuid.NewV7())
			t.Cleanup(func() {
				if err := audittest.Delete(context.Background(), pool, `DELETE FROM audit_events WHERE id = $1`, eventID); err != nil {
					t.Errorf("cleanup: %v", err)
				}
			})
			gate := appendOnRequest(eventID)
			router := newRouter(routerDeps{
				requestMeta: requestmeta.Middleware(requestmeta.Config{ProxySecret: secret}),
				requireAuth: gate, requireRecruiter: gate, requireOwner: gate,
			})
			req := httptest.NewRequest(http.MethodPost, "/companies", nil)
			req.RemoteAddr = "192.0.2.10:5555"
			req.Header.Del("User-Agent")
			for k, v := range tc.headers {
				req.Header.Set(k, v)
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code != http.StatusNoContent {
				t.Fatalf("status %d", rec.Code)
			}
			var ip, ua, source *string
			if err := pool.QueryRow(context.Background(), `SELECT host(ip), user_agent, ip_source FROM audit_events WHERE id = $1`, eventID).Scan(&ip, &ua, &source); err != nil {
				t.Fatalf("read back: %v", err)
			}
			if (tc.ip == "") != (ip == nil) || (ip != nil && *ip != tc.ip) {
				t.Errorf("ip: got %v want %q", ip, tc.ip)
			}
			if ua == nil || *ua != tc.ua || source == nil || *source != tc.source {
				t.Errorf("ua/source: got %v %v want %q %q", ua, source, tc.ua, tc.source)
			}
		})
	}
}
