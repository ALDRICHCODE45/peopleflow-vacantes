package board

// RecordCoverageMilestone preserves the first hire reaching current headcount,
// then records only new below-to-full crossings. Authoring headcount alone
// never creates a milestone; a subsequent hire may establish the first one.
func RecordCoverageMilestone(hire bool, before, after int64, required *int64, hasMilestone bool) bool {
	return hire && required != nil && after >= *required && (!hasMilestone || before < *required)
}
