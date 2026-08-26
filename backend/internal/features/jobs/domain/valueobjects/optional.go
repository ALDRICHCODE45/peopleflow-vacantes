// Package valueobjects (jobs): tri-state presence type for PATCH fields.
//
// Lifted to internal/shared/valueobjects/optional.go (companies-write D6)
// so the companies slice can reuse the same generic presence codec
// without a cross-feature import. This file is now a generic type alias
// re-export so existing jobs call sites (UpdateJobDto, UpdatePatch, the
// postgres adapter helpers, the optional_test.go test suite) continue
// to compile unchanged.
//
// The PATCH endpoint must distinguish three JSON presence states for the
// three nullable columns (location, salary_min, salary_max):
//
//   - Absent   : key missing from the JSON body   → leave the column untouched
//   - Null     : key present as JSON `null`       → clear the column to SQL NULL
//   - Value    : key present with a value         → set the column to the value
//
// The semantics and the `UnmarshalJSON` implementation live in
// internal/shared/valueobjects/optional.go; this file is purely the
// alias that preserves the existing import path for jobs callers.
package valueobjects

import (
	sharedvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
)

// Optional is the tri-state presence type for PATCH fields, lifted to
// internal/shared/valueobjects (companies-write D6). Kept here as a
// generic type alias so existing jobs call sites (UpdateJobDto,
// UpdatePatch, the postgres adapter helpers, the optional_test.go test
// suite) continue to compile unchanged.
//
// Go 1.26 generic type aliases (stabilized in Go 1.24) preserve the
// underlying type's method set — `UnmarshalJSON` remains callable
// through the alias, no method-shim wrapper is required.
type Optional[T any] = sharedvalueobjects.Optional[T]
