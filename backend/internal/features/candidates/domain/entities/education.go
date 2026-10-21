package entities

// Education is an ordered study record. Nullable values are always emitted;
// absence of a value is distinct from absence of a required record key.
type Education struct {
	Level       string  `json:"level"`
	Institution *string `json:"institution"`
	Field       *string `json:"field"`
	Status      string  `json:"status"`
	StartYear   *int    `json:"start_year"`
	EndYear     *int    `json:"end_year"`
}
