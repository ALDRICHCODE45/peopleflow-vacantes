# Delivery fulfillment cut (frontend)
Show delivery progress and the frozen fulfillment result on the board and in the Entrega configuration, preview and confirm edits that would fulfill the delivery, and keep the Entrega configuration read-only once fulfilled.
Branch feat/pipeline-delivery-fulfillment-ui stacked on feat/pipeline-substates-active-ui; not merged to main until the user's browser review. Frontend only; backend session 01a1420b-ba06-7632 implements feat/pipeline-delivery-fulfillment (migration 00027). Contract: `git show feat/pipeline-delivery-fulfillment:docs/pipeline-customization-design.md` §16 incl. §16.6 — authoritative over this summary.

## Specs
- S1. Standing instructions: docs/frontend-ui-design-rules.md (§9 checklist, §11, §12 toast copy, §13.10, §14, §15, §16) and shadcn first (never edit components/ui/*, never install packages); test-first; strict decoders; no automatic retries; add learned patterns to the rules.
- S2. User decisions (§16.5): once fulfilled, the Entrega configuration is read-only (409 delivery_fulfilled). The result is on time / late plus whole business days of difference. An edit that would fulfill the delivery shows a preview and requires confirmation.
- S3. GET `…/pipeline/delivery/status` → {state pending|fulfilled, delivered, target, cutoff_stage_id, commitment_date, business_days_remaining (pending only; negative when past; null when fulfilled), fulfillment: null | {fulfilled_at, result on_time|late, business_days_delta (positive early, negative late, 0 on the date), target, cutoff_stage_id, cutoff_stage_name, commitment_date, candidates[{participation_id, candidate{id,full_name}, reached_at}] (first `target`, reached_at asc then participation_id)}}; unpublished → 409 vacancy_not_published.
- S4. POST `…/delivery/preview` with the PUT body (no If-Match) → {would_fulfill, delivered, target, candidates (all delivered with the proposed values, same shape and order)}; same body validation as PUT (400 invalid_request / validation_error / non_business_date), 409 delivery_fulfilled, 409 vacancy_not_published; never writes.
- S5. PUT delivery gains optional `confirm_fulfillment`; an edit that would fulfill without it → 409 fulfillment_confirmation_required; after fulfillment → 409 delivery_fulfilled. GET/PUT delivery gain `fulfilled: boolean`.
- S6. Board gains `delivery: {state, delivered, target}` (target never null on published vacancies); 200 responses of move, discard, recover and substate gain the same `delivery`, computed after the write. «Reached the cutoff» = first history entry into the cutoff stage; later moves/discards keep it.

## Tasks
- T1 [pending] S1-S6 | writer | Contracts, board header delivery indicator + fulfillment toast, Entrega editor read-only with frozen result, preview + confirmation flow; tests. | commit: -
- T2 [pending] S1-S6 | parent | Commits, guide steps, review queue item 9. | commit: -

## Log
- L1. Backend proposal c09ddb0 §16; frontend asked for delivery in write responses, a fulfilled flag on GET/PUT delivery, published non-null guarantees, preview validation parity and candidate ordering; backend agreed all in §16.6 (msg 1f8b1b17).
