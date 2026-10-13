# Unwired candidate screening v2 projection

`ProjectCandidateScreeningV2` accepts an **already validated** employer
`[]draftfields.ScreeningQuestionV2` and returns a separately allocated candidate
DTO collection. It is not a decoder, validator, authorization check or publisher.
No existing jobs DTO, route, store or publication flow calls it.

The explicit server allowlist is `id`, `type`, `prompt` and, for choices only,
`options: [{id, label}]`. Both `single_choice_informative` and
`single_choice_evaluated` become `single_choice`; `open` stays `open` and omits
options. Answer keys, evaluation flags and scores have no candidate DTO fields.
Absent options are omitted, not null. IDs, text and order are copied verbatim;
option arrays do not alias employer data. Unknown variants return
`ErrCandidateScreeningType` and a nil result without mutating input. Nil/empty
input returns an empty collection encoded as `[]`.

Rules derive from the agreed §6/6.2 projection in the historical contract blob
`7f7c5ff43fae2ccf02f98fa6a01a4ab4b2c1ef9c:docs/contracts/private-vacancy-drafts-v2-screening.md`.
That document is a design proposal, not whole-file approval or API activation
permission; its old sequencing is superseded by the recorded validation-first
agreement. This pure projection proves its own allowlist, not future endpoint
privacy, publication or authorization. Future callers must validate/authorize
upstream and expose only this reduced DTO, never employer envelopes.

From `backend`:

```sh
go test ./internal/features/jobs/application/dtos -run '^TestProjectCandidateScreeningV2' -count=1
go test ./internal/features/jobs/... -count=1
go vet ./internal/features/jobs/application/dtos
```

Tests use the three contract examples to pin exact JSON key sets, option
omission, evaluation indistinguishability, empty collections, no mutation or
aliasing, and all-or-nothing rejection of unknown variants. Existing v1 and
HTTP regressions run in the unchanged jobs suite. No database is needed.
