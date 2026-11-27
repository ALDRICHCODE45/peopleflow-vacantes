package cognitogetuser

import (
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/userinfo"
)

var _ usecases.UserInfoProvider = (*Client)(nil)

// D11: 5 s default deadline on both the client and the request context, the
// UserInfo response cap, and a non-nil logger.
func TestClientDefaults(t *testing.T) {
	c := NewClient("https://cognito-idp.us-east-1.amazonaws.com/", 0, nil)
	if DefaultTimeout != 5*time.Second || c.timeout != DefaultTimeout || c.client.Timeout != DefaultTimeout || c.logger == nil {
		t.Fatalf("defaults: %s %s %v", c.timeout, c.client.Timeout, c.logger)
	}
	if c.client.CheckRedirect == nil {
		t.Fatal("redirects not refused")
	}
	if limit, want := MaxResponseBytes, userinfo.MaxResponseBytes; limit != want || limit != 16<<10 {
		t.Fatal("response cap differs from UserInfo")
	}
}
