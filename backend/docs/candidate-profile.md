# Candidate profile API

Authenticated candidate-only `GET /me/profile` and `PUT /me/profile` retain their
existing subject-to-user resolution, no-store policy and profile ownership rules.
No user ID is accepted as the profile owner. Missing profile → 404.

## Replace a profile

PUT is a **full replacement** of client-owned fields. Omitted or null nullable
fields become SQL NULL. Skills are normalized; omitted/null skills become `[]`;
omitted/null salary currency defaults to `MXN`. Reserved CV storage fields and
server-managed identity/timestamps are not client-writable.

```json
{"professional_title":"Backend engineer",
 "skills":["Go","SQL"],
 "location":{"country":"MX","state":"14","municipality":"14039"}}
```

`location` replaces the former `city`/`country` text fields. It is optional: omit
it or send null to clear it. A present object requires a known country; state
and municipality are optional but consistent. Subdivisions are MX-only today.
Sending **any** postal_code key (including empty/null) → 422 `invalid_location`
with `location.postal_code` / `not_allowed`. Unknown nested keys → 400.

GET and successful PUT return the expanded [G3 location read shape](geo-profiles.md)
with catalog `{id,name}` references and a server-built `label`, or `location:null`.
Other profile fields, education/salary enums and separate language routes are
unchanged. PUT does not replace languages or overwrite reserved CV data.

## Review checklist

- Save country only, then MX state, then municipality; reload each depth.
- Clear location with null and with a PUT that omits it.
- Reject unknown country/state, missing parent, mismatched municipality and postal.
- With G4/00033, check new applications freeze location codes and board/detail expand
  them; profile edits never update prior snapshots. Country is required only when
  applying to a remote country-restricted vacancy; see [G4](geo-apply.md).

See [G3 migration, errors and tests](geo-profiles.md) and
[candidate identity/onboarding](candidate-identity.md).
