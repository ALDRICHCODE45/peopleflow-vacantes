import { expect, it } from "vitest";
import { cvFailure, cvFailureMessage } from "./cv-model";

it("explains the owner's restriction when a base CV upload hits talent_base_restricted", () => {
 const failure = cvFailure(403, { error: "private", code: "talent_base_restricted" });
 expect(failure).toEqual({ ok: false, reason: "talent_base_restricted", reference: { status: 403, code: "talent_base_restricted" } });
 expect(cvFailureMessage(failure)).toBe("El owner limitó el acceso a la Base de talento. Sigues viendo a los candidatos de tus vacantes desde su tablero.");
 expect(cvFailure(403, { code: "forbidden" })).toMatchObject({ reason: "forbidden" });
});
