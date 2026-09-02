// Package lambdapostconfirmation adapts the AWS Cognito PostConfirmation
// Lambda trigger onto the identity application's PostConfirmationHandler.
// The adapter owns AWS event translation only; all business logic (group
// mapping, enablement flag, idempotency) lives in the application layer.
package lambdapostconfirmation

import (
	"context"
	"errors"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application"
	"github.com/aws/aws-lambda-go/events"
)

// PostConfirmationHandler is the consumer-side port the adapter invokes.
// It is satisfied by *application.PostConfirmationHandler; defining it
// here (not in application) keeps the dependency pointing inward.
type PostConfirmationHandler interface {
	Handle(ctx context.Context, event application.PostConfirmationEvent) error
}

// Compile-time assertion that the application handler satisfies the port.
var _ PostConfirmationHandler = (*application.PostConfirmationHandler)(nil)

// ErrUnsupportedTriggerSource is returned when the Cognito event's trigger
// source is not an official PostConfirmation source. The message carries
// no event data (trigger source, attributes) by design: it must never
// leak user identifiers into Lambda invocation logs.
var ErrUnsupportedTriggerSource = errors.New("lambdapostconfirmation: unsupported cognito trigger source")

// triggerSource constants are the only official PostConfirmation sources.
const (
	triggerConfirmSignUp = "PostConfirmation_ConfirmSignUp"
	// pi-lens-ignore: go-hardcoded-secrets
	triggerConfirmForgotPassword = "PostConfirmation_ConfirmForgotPassword"
)

// Adapter translates Cognito PostConfirmation events into the application
// event shape and forwards them to the consumed handler.
type Adapter struct {
	handler PostConfirmationHandler
}

// NewAdapter builds the adapter around the consumer-side handler port.
func NewAdapter(handler PostConfirmationHandler) *Adapter {
	return &Adapter{handler: handler}
}

// Handle accepts exactly the official PostConfirmation trigger sources,
// copies the user attributes out of the AWS event (never retaining or
// mutating the input map), and forwards a fresh application event.
// Handler errors propagate unchanged. The adapter performs no logging.
func (a *Adapter) Handle(ctx context.Context, event events.CognitoEventUserPoolsPostConfirmation) error {
	switch event.TriggerSource {
	case triggerConfirmSignUp, triggerConfirmForgotPassword:
	default:
		return ErrUnsupportedTriggerSource
	}

	attrs := make(map[string]string, len(event.Request.UserAttributes))
	for k, v := range event.Request.UserAttributes {
		attrs[k] = v
	}

	return a.handler.Handle(ctx, application.PostConfirmationEvent{UserAttributes: attrs})
}
