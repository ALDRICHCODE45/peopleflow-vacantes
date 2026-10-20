import type { PublicJobDetail, PublicJobItem } from "../types";

/** Local previews may lack required publication fields. Never weaken the wire decoder. */
type Vacancy = Extract<PublicJobDetail, { source: "vacancy" }>;
type Pending = "work_mode" | "work_schedule" | "contract_type" | "professional_area" | "published_at" | "applicants" | "screening_questions" | "description" | "company";
export type DraftPublicDetail = Omit<Vacancy, Pending> & {
  [Key in Pending]: Vacancy[Key] | null;
};
export type PublicDetailPresentation = PublicJobDetail | DraftPublicDetail;
export type PublicItemPresentation = PublicJobItem | DraftPublicDetail;
