import type { Cv, CvLibrary } from "./model";
export const cv: Cv = { id: "a12b3456-1234-4234-8234-123456789abc", name: "CV Desarrollo", size: 348160, content_type: "application/pdf", uploaded_at: "2026-03-10T12:00:00Z", in_use: true };
export const library: CvLibrary = { items: [cv], limits: { max_cvs: 10, max_bytes: 5242880, content_types: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] } };
