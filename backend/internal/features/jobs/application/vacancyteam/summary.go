package vacancyteam

// Summary is the team projection shared by fresh v2 draft and list responses.
type Summary struct {
	Mode           string         `json:"mode"`
	Responsible    *SummaryPerson `json:"responsible"`
	MembersCount   int            `json:"members_count"`
	ViewerFunction *string        `json:"viewer_function"`
}
type SummaryPerson struct {
	ID   string  `json:"id"`
	Name *string `json:"name"`
}
