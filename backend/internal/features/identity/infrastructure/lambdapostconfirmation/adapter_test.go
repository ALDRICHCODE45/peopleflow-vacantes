package lambdapostconfirmation

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application"
	"github.com/aws/aws-lambda-go/events"
)

// fakeHandler records every application event it receives so tests can
// assert on the forwarded payload and the invocation count.
type fakeHandler struct {
	received []application.PostConfirmationEvent
	err      error
}

func (f *fakeHandler) Handle(_ context.Context, event application.PostConfirmationEvent) error {
	f.received = append(f.received, event)
	return f.err
}

func postConfirmationEvent(source string, attrs map[string]string) events.CognitoEventUserPoolsPostConfirmation {
	return events.CognitoEventUserPoolsPostConfirmation{
		CognitoEventUserPoolsHeader: events.CognitoEventUserPoolsHeader{
			TriggerSource: source,
		},
		Request: events.CognitoEventUserPoolsPostConfirmationRequest{
			UserAttributes: attrs,
		},
	}
}

// assertNoEventLeak fails the test when the error string carries any user
// attribute value (sub, email, name, groups or any other raw attribute).
func assertNoEventLeak(t *testing.T, err error, attrs map[string]string) {
	t.Helper()
	if err == nil {
		return
	}
	msg := err.Error()
	for k, v := range attrs {
		if v != "" && strings.Contains(msg, v) {
			t.Errorf("error message leaks attribute %q: %q", k, msg)
		}
	}
}

func TestAdapter_ForwardsFreshCopyOfUserAttributes(t *testing.T) {
	attrs := map[string]string{
		"sub":            "sub-1",
		"email":          "user1@example.com",
		"name":           "User One",
		"cognito:groups": `["candidates"]`,
		"custom:noise":   "noise-1",
	}
	handler := &fakeHandler{}
	adapter := NewAdapter(handler)

	err := adapter.Handle(context.Background(), postConfirmationEvent("PostConfirmation_ConfirmSignUp", attrs))
	if err != nil {
		t.Fatalf("Handle returned error: %v", err)
	}
	if len(handler.received) != 1 {
		t.Fatalf("expected exactly 1 handler invocation, got %d", len(handler.received))
	}

	got := handler.received[0].UserAttributes
	want := map[string]string{
		"sub":            "sub-1",
		"email":          "user1@example.com",
		"name":           "User One",
		"cognito:groups": `["candidates"]`,
		"custom:noise":   "noise-1",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("forwarded attributes = %v, want %v", got, want)
	}

	// Fresh-copy contract: mutating the input map after the call must not
	// affect the event already delivered to the handler.
	attrs["email"] = "mutated@example.com"
	delete(attrs, "sub")
	if !reflect.DeepEqual(handler.received[0].UserAttributes, want) {
		t.Errorf("delivered event shares state with the input map: got %v, want %v",
			handler.received[0].UserAttributes, want)
	}
}

func TestAdapter_AcceptsBothOfficialTriggerSources(t *testing.T) {
	for _, source := range []string{
		"PostConfirmation_ConfirmSignUp",
		"PostConfirmation_ConfirmForgotPassword",
	} {
		t.Run(source, func(t *testing.T) {
			handler := &fakeHandler{}
			adapter := NewAdapter(handler)

			err := adapter.Handle(context.Background(), postConfirmationEvent(source, map[string]string{
				"sub": "sub-2", "email": "user2@example.com", "name": "User Two",
			}))
			if err != nil {
				t.Fatalf("Handle(%q) returned error: %v", source, err)
			}
			if len(handler.received) != 1 {
				t.Errorf("expected 1 invocation for %q, got %d", source, len(handler.received))
			}
		})
	}
}

func TestAdapter_RejectsOtherTriggerSourcesBeforeHandler(t *testing.T) {
	for _, source := range []string{
		"PreSignUp_SignUp",
		"PreAuthentication_Authentication",
		"PostAuthentication_Authentication",
		"TokenGeneration_Human",
		"",
	} {
		t.Run(source, func(t *testing.T) {
			handler := &fakeHandler{}
			adapter := NewAdapter(handler)
			attrs := map[string]string{
				"sub":   "sub-3",
				"email": "user3@example.com",
				"name":  "User Three",
			}

			err := adapter.Handle(context.Background(), postConfirmationEvent(source, attrs))
			if !errors.Is(err, ErrUnsupportedTriggerSource) {
				t.Fatalf("expected ErrUnsupportedTriggerSource for %q, got %v", source, err)
			}
			if len(handler.received) != 0 {
				t.Errorf("handler must not be invoked for %q, got %d invocations", source, len(handler.received))
			}
			assertNoEventLeak(t, err, attrs)
		})
	}
}

var errBoom = errors.New("handler boom")

func TestAdapter_PropagatesHandlerErrorUnchanged(t *testing.T) {
	attrs := map[string]string{
		"sub":            "sub-4",
		"email":          "user4@example.com",
		"name":           "User Four",
		"cognito:groups": `["recruiters"]`,
	}
	handler := &fakeHandler{err: errBoom}
	adapter := NewAdapter(handler)

	err := adapter.Handle(context.Background(), postConfirmationEvent("PostConfirmation_ConfirmSignUp", attrs))
	if !errors.Is(err, errBoom) {
		t.Fatalf("expected the handler error unchanged, got %v", err)
	}
	if err != errBoom {
		t.Errorf("error identity changed: got %v, want the exact sentinel", err)
	}
	if len(handler.received) != 1 {
		t.Errorf("expected 1 invocation, got %d", len(handler.received))
	}
	assertNoEventLeak(t, err, attrs)
}
