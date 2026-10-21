package v2

// NotAcceptingApplications precedes country, screening, CV and duplicate checks.
type NotAcceptingApplications struct {
	Availability string `json:"availability"`
}

func (e *NotAcceptingApplications) Error() string { return "vacancy not accepting applications" }
