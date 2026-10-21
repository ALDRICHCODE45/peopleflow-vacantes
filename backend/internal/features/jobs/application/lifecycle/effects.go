package lifecycle

// ProcessFinished carries the current view for every blocked configuration write.
type ProcessFinished struct {
	Lifecycle View `json:"lifecycle"`
}

func (e *ProcessFinished) Error() string { return "process finished" }
