# Rich draft links

`ValidateHref(string) (string, error)` validates a link destination and returns
its original bytes on success. On rejection it returns an empty string and
`ErrInvalidHref`. It performs no network requests or persistence.

## Accepted policy

- Explicit absolute `https://` prefix (ASCII case-insensitive), nonempty host.
- Valid UTF-8, at most 2048 Unicode codepoints.
- No raw C0/C1 controls, DEL, Unicode White_Space, backslash or U+FEFF.
- No credentials, including an empty userinfo marker (`https://@host/`).
- International domains and paths remain supported.
- URL interpretation uses `github.com/nlnwa/whatwg-url` v0.6.2 with default
  options. Do not enable lax parsing or replace the returned raw href with the
  parser's normalized serialization.

This policy supersedes the earlier HTTP-or-HTTPS allowance for rich draft links
only. It does not change other string fields or existing URL validators.

## Accepted compatibility limitation

The backend accepts `https://xn--.com/`, while the observed frontend WHATWG
validator rejects it. This known malformed-punycode discrepancy was explicitly
accepted to unblock development; exact browser acceptance parity is not promised.
The regression test deliberately records backend acceptance, not an exception
that recognizes this particular string. Browser-compatible numeric IP forms,
empty ports and malformed percent escapes in paths are not additionally banned.

## Security and integration boundary

HTTPS does not establish destination trust. This is not phishing, malware or
adult-content detection, an HTML sanitizer, or an SSRF destination policy.
Render links through the editor's structured attributes and appropriate escaping;
do not concatenate untrusted HTML. Do not use this validator to authorize
server-side fetching.

## Document validation

`ValidateDocument(any) (*Document, error)` accepts a decoded description envelope
with `schema_version: int64(1)` and a restricted ProseMirror `document`, or nil.
Use the strict `draftjson` decoder first; float64 numbers are not accepted.
A null description returns nil; an empty paragraph returns a nonnil result with
empty `Plain`. Errors return no partial result. `ErrDocumentVersion` identifies
an unsupported version; other failures return `ErrInvalidDocument`.

The validator permits paragraphs, bullet/ordered lists and list items, with text
and hard breaks inline. Marks are unique bold, italic, fontSizePreset and link;
every link calls `ValidateHref`. Unknown keys/attrs are rejected. Depth is at most
16 (doc = 1), with at most 2000 node occurrences. Marks do not count as nodes.
Strings, mark order, empty arrays and omitted properties are preserved.

`Canonical` owns the complete envelope encoded by `draftjson` go-json-v1, limited
to 65536 bytes. Only after full validation, `Plain` concatenates paragraph inline
content, translates hard breaks to newlines and joins block children with newlines.
It never trims, adds list markers, or substitutes link destinations for labels.
Link rel values preserve ASCII-space separators and repeated allowlisted tokens;
empty/space-only values contain no disallowed tokens. Rendering must still enforce
its own protections. Callers must not mutate input concurrently and must enforce
request-body limits before decoding.

Draft save endpoints are not implemented by this change. Frontend HTTPS
enforcement and live editor integration still require coordination.

Run the focused tests from `backend/`:

```sh
go test ./internal/features/jobs/application/draftrich -count=1
```
