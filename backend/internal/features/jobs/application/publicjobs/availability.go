package publicjobs

import "github.com/google/uuid"

// Unavailable deliberately carries only the public tombstone, never content.
type Unavailable struct {
	ID      uuid.UUID `json:"id"`
	Title   string    `json:"title"`
	Company struct {
		ID   uuid.UUID `json:"id"`
		Name string    `json:"name"`
	} `json:"company"`
	Availability string `json:"availability"`
}

func (e *Unavailable) Error() string { return "vacancy unavailable" }
