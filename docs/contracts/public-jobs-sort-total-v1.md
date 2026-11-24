# Public vacancy listing: sort and total v1

Status: **implemented by the backend** (branch `feat/public-jobs-sort-total`, not merged). Additive to
`GET /v2/jobs`. Feature document: `odd/tasks/public-jobs-sort-total.md`. Full backend contract:
`backend/docs/public-jobs-v2.md` § «Sort and total». The salary-privacy rule (S3) and the cap of 1000 are backend
decisions pending the user's confirmation (L2).

## Request

New optional, single-valued query key on `GET /v2/jobs`; every existing key is unchanged and combines with it.

| `sort` | Order |
| --- | --- |
| absent or `recent` | Today's order, byte-for-byte: rank (with `q`), `published_at` desc, source, id |
| `salary_desc` | Public salary, highest first; hidden or absent salaries last |
| `salary_asc` | Public salary, lowest first; hidden or absent salaries last |

Any other value (`sort=`, `SALARY_DESC`, `price`, a repeated key) →
`400 {"error":"invalid request","code":"invalid_request"}`.

Keep `sort` on every page: `next_cursor` is valid only with the sort (and filters) it was issued with; a cursor from
another sort → the same `400 invalid_request`. Changing the sort means starting without a cursor.

## Response

```jsonc
{
  "items": [ /* unchanged 25-key items */ ],
  "next_cursor": "opaque or null",
  "total": { "count": 137, "capped": false }
}
```

- `total` is always present, also on an empty page and on a page past the end.
- It counts the rows matching the same filters as the page, independently of `sort`, `cursor` and `limit`.
- More than 1000 matches → `{"count": 1000, "capped": true}`; render «Más de 1000 vacantes» (or «1000+»).
  Exactly 1000 → `capped: false`.
- `items` keys and `next_cursor` are unchanged.

## Salary order (what the frontend can rely on)

- Only the salary the card already shows is used. A vacancy with a hidden or absent salary always sorts after every
  vacancy with a public salary, in both directions, in recent order; its position reveals nothing.
- Amounts are compared only in the same units. First come salaries in **MXN · mensual · bruto** (the UI's default
  units), then each other unit combination as its own block (fixed order, see the backend doc), then legacy rows with a
  salary (no period/basis), then hidden/absent. Within a block:
  - `salary_desc` uses the offer's top: range `max`, fixed `amount` (the figure `salary_min` compares);
  - `salary_asc` uses the offer's bottom: range `min`, fixed `amount` (the figure `salary_max` compares).
- Ties keep the recent order.
- With an active salary filter (`salary_min`/`salary_max` + units) every result is in one block, so the order is purely
  by amount.
