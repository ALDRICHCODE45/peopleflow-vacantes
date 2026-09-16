// Command archguard is the gate-arch repository validator (Task 7.2 REFACTOR,
// design §9): it runs the gate-level archguard suite — cross-feature import,
// error-catalog usage, locked non-goal, and traceability structure/coverage
// guards — against the real repository and exits non-zero on any violation.
// The route topology guard is delegated to the pinned router-owner test
// TestRouteTopology_ExactRegistrations by the gate-arch target itself.
package main

import (
	"fmt"
	"os"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/tools/archguard"
)

func main() {
	layout, err := archguard.DetectLayout(".")
	if err != nil {
		fmt.Fprintf(os.Stderr, "gate-arch: %v\n", err)
		os.Exit(2)
	}
	violations, err := archguard.CheckRepository(layout)
	if err != nil {
		fmt.Fprintf(os.Stderr, "gate-arch: %v\n", err)
		os.Exit(2)
	}
	for _, v := range violations {
		fmt.Printf("gate-arch: %s %s: %s\n", v.Rule, v.File, v.Detail)
	}
	if len(violations) > 0 {
		first := violations[0]
		fmt.Printf("gate-arch: FAILED: %d archguard violation(s); first: %s %s: %s\n",
			len(violations), first.Rule, first.File, first.Detail)
		os.Exit(1)
	}
	fmt.Println("gate-arch: archguard repository guards pass; zero unexplained traceability-manifest rows")
}
