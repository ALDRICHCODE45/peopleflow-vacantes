// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, middleware } from "./middleware";

const origin = "http://localhost:3100";
const id = "11111111-1111-4111-8111-111111111111";
const request = (path: string) => new NextRequest(new URL(path, origin));

describe("public vacancy HTTP decisions before streaming", () => {
  it.each(["/vacantes/not-a-uuid", "/vacantes/not-a-uuid/postular"])("rewrites %s outside the loading ancestry to the branded 404", (path) => {
    const response = middleware(request(path));
    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-rewrite")).toBe(`${origin}/vacante-no-encontrada`);
  });

  it.each(["/vacantes", "/vacantes?q=React", `/vacantes/${id}`, `/vacantes/${id}/postular`])("passes through %s", (path) => {
    expect(middleware(request(path)).headers.get("x-middleware-next")).toBe("1");
  });

  it.each([
    ["/vacantes?q=", "/vacantes"],
    ["/vacantes?currency=mxn&unknown=drop-me", "/vacantes"],
    ["/vacantes?q=%20React%20&unknown=drop", "/vacantes?q=React"],
  ])("redirects %s with the exact canonical Location", (path, canonical) => {
    const response = middleware(request(path));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${origin}${canonical}`);
  });

  it.each(["host", "x-forwarded-host"])("does not derive redirect authority from %s", (header) => {
    const incoming = new NextRequest(`${origin}/vacantes?q=`, {
      headers: { [header]: "evil.com", "x-forwarded-proto": "https" },
    });
    const response = middleware(incoming);
    const location = response.headers.get("location");
    expect(location).toBe(`${incoming.nextUrl.origin}/vacantes`);
    expect(location).not.toContain("evil.com");
  });

  it.each(["/", "/vacante-no-encontrada", "/api/jobs", "/candidato", "/vacantes/a/other", "/vacantes/a/postular/extra", "/vacantes-extra"])("does not match unrelated %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(false);
  });

  it.each(["/vacantes", `/vacantes/${id}`, `/vacantes/${id}/postular`])("matches %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
  });
});
