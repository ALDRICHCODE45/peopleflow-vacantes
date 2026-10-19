package httpjson

const (
	CodeDeliveryFulfilled               Code = "delivery_fulfilled"
	CodeFulfillmentConfirmationRequired Code = "fulfillment_confirmation_required"
)

func FulfillmentErrorCodes() []Code {
	return []Code{CodeDeliveryFulfilled, CodeFulfillmentConfirmationRequired}
}
func resolveFulfillmentError(code Code) (Definition, bool) {
	switch code {
	case CodeDeliveryFulfilled:
		return Definition{code, 409, "delivery fulfilled"}, true
	case CodeFulfillmentConfirmationRequired:
		return Definition{code, 409, "fulfillment confirmation required"}, true
	default:
		return Definition{}, false
	}
}
