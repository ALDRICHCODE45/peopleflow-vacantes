import type { Cv, CvLimits } from "@/features/candidate-cvs/model";

const DECIMAL = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
/** Long date for the «Subido» fact; UTC so a server timestamp reads the same day everywhere. */
export const LONG_DATE = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" });
/** Short date for the row meta («10 mar 2026»). */
export const SHORT_DATE = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "UTC" });

export const formatSize = (bytes: number) => bytes >= 1048576 ? `${DECIMAL.format(bytes / 1048576)} MB` : `${DECIMAL.format(Math.round(bytes / 1024))} KB`;
export const isPdf = (cv: Pick<Cv, "content_type">) => cv.content_type === "application/pdf";
/** Short format word used in metas: «PDF» or «Word». */
export const formatWord = (cv: Pick<Cv, "content_type">) => isPdf(cv) ? "PDF" : "Word";
/** Full format name for the «Formato» fact. */
export const formatName = (cv: Pick<Cv, "content_type">) => isPdf(cv) ? "PDF" : "Word (.docx)";
/** Upload limit in MB from the server limits (5 today). */
export const maxMegabytes = (limits: CvLimits) => limits.max_bytes / 1048576;
/** «PDF o Word» from the formats the server accepts. */
export const acceptedFormats = (limits: CvLimits) => limits.content_types.map(type => type === "application/pdf" ? "PDF" : "Word").join(" o ");
