import { beforeEach, expect, it } from "vitest";
import { PENDING_EMAIL_KEY, rememberPendingEmail, takePendingEmail } from "./pending-email";

beforeEach(() => window.sessionStorage.clear());

it("carries a trimmed email once, then forgets it", () => {
  rememberPendingEmail("  ximena@correo.com ");
  expect(window.sessionStorage.getItem(PENDING_EMAIL_KEY)).toBe("ximena@correo.com");
  expect(takePendingEmail()).toBe("ximena@correo.com");
  expect(takePendingEmail()).toBeNull();
});
