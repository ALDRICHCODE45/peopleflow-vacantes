import { locationReadToValue, locationValueToWrite, remoteScopeReadToWrite } from "@/features/geo/model";
import { draftPostBodySchema } from "../fields";
import type { DraftModel } from "../model";
import type { DraftReadEnvelopeV2 } from "../read-v2";
import type { ScreeningQuestionV2 } from "../screening-v2/model";

/** Editor input for a saved v2 draft. */
export type DraftEditSeed = {
  lifecycle: DraftReadEnvelopeV2["lifecycle"];
  model: DraftModel;
  screeningQuestionsV2: ScreeningQuestionV2[];
};

/**
 * Split a decoded v2 read envelope into what the editor needs: a draft model
 * carrying every other write field (with an empty v1 screening list, because
 * the v2 questions travel separately) and the v2 questions themselves.
 *
 * The read decoder already requires all 17 fields, so the POST schema here only
 * re-normalizes values that are already normalized; it never fills a default.
 * The derived `requester.name` and `description_plain` stay beside the fields
 * as display values and are never written back. The seed shares no mutable
 * structure with `read`.
 */
export function draftEditSeedFromRead(read: DraftReadEnvelopeV2): DraftEditSeed {
  const {
    description_plain: descriptionPlain,
    requester,
    screening_questions: screeningQuestionsV2,
    ...rest
  } = read.fields;
  const fields = draftPostBodySchema.parse({
    fields: {
      ...rest,
      location: locationValueToWrite(locationReadToValue(rest.location)),
      remote_scope: remoteScopeReadToWrite(rest.remote_scope),
      screening_questions: [],
      requester: requester === null ? null : { kind: requester.kind, id: requester.id },
    },
  }).fields;
  return {
    lifecycle: structuredClone(read.lifecycle),
    model: {
      fields: structuredClone(fields),
      locationRead: structuredClone(rest.location),
      remoteScopeRead: structuredClone(rest.remote_scope),
      requesterName: requester === null ? null : requester.name,
      descriptionPlain,
    },
    screeningQuestionsV2: structuredClone(screeningQuestionsV2),
  };
}
