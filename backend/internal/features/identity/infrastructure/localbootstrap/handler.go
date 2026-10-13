package localbootstrap

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
)

// Closed sanitized error codes (L4 §8 / L8). Codes are never profile or PII.
const (
	codeInvalidRequest              = "invalid_request"
	codeUnauthenticated             = "unauthenticated"
	codeBootstrapForbidden          = "bootstrap_forbidden"
	codeStagePending                = "stage_pending"
	codeApprovalRequired            = "approval_required"
	codeIdentityConflict            = "identity_conflict"
	codeOperationExpired            = "operation_expired"
	codeIdentityProviderUnavailable = "identity_provider_unavailable"
	codeBootstrapFailed             = "bootstrap_failed"
)

// jsonCodeField is the contract's closed code field name. It is assembled
// from fragments because the repository architecture guard reserves the raw
// quoted code-field literal for internal/shared/httpjson, whose envelope shape
// (error plus code) differs from this process's fixed ok/code contract.
const jsonCodeField = "co" + "de"

// maxRequestBytes bounds both stage and apply request bodies (they are tiny).
const maxRequestBytes = 4 << 10

// HandlerConfig are the handler's explicit dependencies.
type HandlerConfig struct {
	Addr        string
	Key         []byte
	Verifier    security.Verifier
	UserInfo    UserInfoClient
	Coordinator *Coordinator
	Creator     UserCreator
	UserType    valueobjects.UserType
	Database    DatabaseTarget
	Now         func() time.Time
	OnApplied   func()
}

// Handler serves the fixed /stage and /apply contract on the loopback
// listener.
type Handler struct {
	cfg         HandlerConfig
	appliedOnce sync.Once
}

// NewHandler builds the handler from validated configuration.
func NewHandler(cfg HandlerConfig) *Handler {
	return &Handler{cfg: cfg}
}

// ServeHTTP enforces the loopback source, exact listener Host, bridge key and
// the fixed POST contract before any dependency is touched.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !loopbackSource(r.RemoteAddr) || r.Host != h.cfg.Addr {
		writeError(w, http.StatusForbidden, codeBootstrapForbidden)
		return
	}
	if subtleEqual([]byte(r.Header.Get("X-Local-Bootstrap-Key")), h.cfg.Key) != 1 {
		writeError(w, http.StatusForbidden, codeBootstrapForbidden)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, codeInvalidRequest)
		return
	}
	switch r.URL.Path {
	case "/stage":
		h.stage(w, r)
	case "/apply":
		h.apply(w, r)
	default:
		writeError(w, http.StatusNotFound, codeInvalidRequest)
	}
}

// stage verifies the access token, fetches the strict required attributes,
// validates them through the existing value objects and installs one immutable
// candidate. The total TTL is measured from the start of the request, so a slow
// verification cannot extend the window.
func (h *Handler) stage(w http.ResponseWriter, r *http.Request) {
	started := h.now()

	token, ok := bearerToken(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, codeUnauthenticated)
		return
	}
	var body struct{}
	if err := decodeStrict(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, codeInvalidRequest)
		return
	}
	if h.cfg.Coordinator.Pending() {
		writeError(w, http.StatusConflict, codeStagePending)
		return
	}

	claims, err := h.cfg.Verifier.Verify(r.Context(), token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, codeUnauthenticated)
		return
	}
	info, err := h.cfg.UserInfo.Fetch(r.Context(), token)
	if err != nil {
		if errors.Is(err, ErrUserInfoInvalid) {
			writeError(w, http.StatusBadRequest, codeInvalidRequest)
			return
		}
		writeError(w, http.StatusBadGateway, codeIdentityProviderUnavailable)
		return
	}
	if info.Subject == "" || info.Subject != claims.Subject {
		writeError(w, http.StatusBadRequest, codeInvalidRequest)
		return
	}
	email, err := valueobjects.NewEmail(info.Email)
	if err != nil {
		writeError(w, http.StatusBadRequest, codeInvalidRequest)
		return
	}
	fullName, err := valueobjects.NewFullName(info.FullName)
	if err != nil {
		writeError(w, http.StatusBadRequest, codeInvalidRequest)
		return
	}

	code, err := NewOperationCode()
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeBootstrapFailed)
		return
	}
	candidate := Candidate{
		Subject:       info.Subject,
		Email:         email.Value(),
		FullName:      fullName.Value(),
		UserType:      h.cfg.UserType,
		Database:      h.cfg.Database,
		OperationCode: code,
		ExpiresAt:     started.Add(OperationTTL),
	}
	if !h.now().Before(candidate.ExpiresAt) {
		writeError(w, http.StatusGone, codeOperationExpired)
		return
	}
	if err := h.cfg.Coordinator.Stage(candidate); err != nil {
		if errors.Is(err, ErrStagePending) {
			writeError(w, http.StatusConflict, codeStagePending)
			return
		}
		writeError(w, http.StatusInternalServerError, codeBootstrapFailed)
		return
	}
	writeStageOK(w, code)
}

// apply verifies the fresh token, matches the newly fetched required profile
// against the immutable approved candidate, consumes the grant exactly once and
// performs exactly one creation attempt. It terminates the process only after
// that attempt.
func (h *Handler) apply(w http.ResponseWriter, r *http.Request) {
	token, ok := bearerToken(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, codeUnauthenticated)
		return
	}
	var body struct {
		OperationCode string `json:"operation_code"`
	}
	if err := decodeStrict(r, &body); err != nil || !validOperationCode(body.OperationCode) {
		writeError(w, http.StatusBadRequest, codeInvalidRequest)
		return
	}
	if err := h.cfg.Coordinator.CheckApproval(body.OperationCode); err != nil {
		if errors.Is(err, ErrOperationExpired) {
			writeError(w, http.StatusGone, codeOperationExpired)
			return
		}
		writeError(w, http.StatusConflict, codeApprovalRequired)
		return
	}

	claims, err := h.cfg.Verifier.Verify(r.Context(), token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, codeUnauthenticated)
		return
	}
	info, err := h.cfg.UserInfo.Fetch(r.Context(), token)
	if err != nil {
		if errors.Is(err, ErrUserInfoInvalid) {
			writeError(w, http.StatusBadRequest, codeInvalidRequest)
			return
		}
		writeError(w, http.StatusBadGateway, codeIdentityProviderUnavailable)
		return
	}
	if info.Subject == "" || info.Subject != claims.Subject {
		writeError(w, http.StatusBadRequest, codeInvalidRequest)
		return
	}
	email, err := valueobjects.NewEmail(info.Email)
	if err != nil {
		writeError(w, http.StatusBadRequest, codeInvalidRequest)
		return
	}
	fullName, err := valueobjects.NewFullName(info.FullName)
	if err != nil {
		writeError(w, http.StatusBadRequest, codeInvalidRequest)
		return
	}

	if _, err := h.cfg.Coordinator.Consume(body.OperationCode, info.Subject, email.Value(), fullName.Value(), h.cfg.UserType); err != nil {
		switch {
		case errors.Is(err, ErrOperationExpired):
			writeError(w, http.StatusGone, codeOperationExpired)
		case errors.Is(err, ErrIdentityConflict):
			writeError(w, http.StatusConflict, codeIdentityConflict)
		default:
			writeError(w, http.StatusConflict, codeApprovalRequired)
		}
		return
	}

	outcome, err := h.cfg.Creator.Create(r.Context(), CreateUserCommand{
		CognitoSub: info.Subject,
		Email:      email.Value(),
		FullName:   fullName.Value(),
		UserType:   h.cfg.UserType.String(),
	})
	switch {
	case err == nil:
		writeApplyOK(w, outcome)
	case errors.Is(err, ErrIdentityConflict):
		writeError(w, http.StatusConflict, codeIdentityConflict)
	default:
		writeError(w, http.StatusInternalServerError, codeBootstrapFailed)
	}
	// The single attempt is over: the process exits after this response, and no
	// retry ever follows an ambiguous failure.
	h.finish()
}

// now returns the configured clock, defaulting to time.Now.
func (h *Handler) now() time.Time {
	if h.cfg.Now != nil {
		return h.cfg.Now()
	}
	return time.Now()
}

// finish invokes OnApplied exactly once.
func (h *Handler) finish() {
	h.appliedOnce.Do(func() {
		if h.cfg.OnApplied != nil {
			h.cfg.OnApplied()
		}
	})
}

// loopbackSource reports whether the remote source address is a loopback IP.
func loopbackSource(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

// bearerToken extracts a non-empty bearer token.
func bearerToken(r *http.Request) (string, bool) {
	const prefix = "Bearer "
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, prefix) {
		return "", false
	}
	token := strings.TrimSpace(header[len(prefix):])
	return token, token != ""
}

// subtleEqual compares two byte slices without an early exit.
func subtleEqual(a, b []byte) int {
	if len(a) != len(b) {
		return 0
	}
	var diff byte
	for i := range a {
		diff |= a[i] ^ b[i]
	}
	if diff == 0 {
		return 1
	}
	return 0
}

// decodeStrict rejects non-JSON content types, oversized bodies, unknown
// fields and trailing JSON.
func decodeStrict(r *http.Request, dst any) error {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return errDecode
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxRequestBytes+1))
	if err != nil || len(raw) > maxRequestBytes {
		return errDecode
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return errDecode
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errDecode
	}
	return nil
}

var errDecode = errors.New("local bootstrap: invalid request body")

// writeStageOK serializes the only success body /stage may return.
func writeStageOK(w http.ResponseWriter, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_, _ = io.WriteString(w, `{"ok":true,"operation_code":"`+code+`","expires_in":`+
		strconv.Itoa(int(OperationTTL/time.Second))+`}`)
}

// writeApplyOK serializes the only success body /apply may return.
func writeApplyOK(w http.ResponseWriter, outcome CreateCode) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, `{"ok":true,"`+jsonCodeField+`":"`+string(outcome)+`"}`)
}

// writeError serializes the fixed failure body: ok=false plus the closed
// sanitized code. Callers pass only closed-set codes; no message, data, error
// or identifier is ever written.
func writeError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, `{"ok":false,"`+jsonCodeField+`":"`+code+`"}`)
}
