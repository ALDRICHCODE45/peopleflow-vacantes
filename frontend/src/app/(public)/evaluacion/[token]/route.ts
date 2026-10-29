import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Shape check only: no backend lookup and no token validity oracle.
 * 256-bit base64url tokens are 43 characters; bounded headroom allows rotation.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const response = NextResponse.redirect(new URL("/evaluacion", request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    response.cookies.set("pf_assessment", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/evaluacion",
    });
  }
  // A malformed link must not clear a candidate's existing valid assessment.
  return response;
}
