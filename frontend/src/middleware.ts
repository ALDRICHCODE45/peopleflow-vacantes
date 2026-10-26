import { NextResponse, type NextRequest } from "next/server";
import { isValidJobId } from "./features/jobs/jobId";
import { buildJobsUrl, isCanonicalJobsQuery, parseJobsQuery } from "./features/jobs/url";

/** Decide URL-only outcomes before loading boundaries can commit a 200 shell. */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/vacantes") {
    if (!isCanonicalJobsQuery(search)) {
      return NextResponse.redirect(new URL(buildJobsUrl(parseJobsQuery(search)), request.nextUrl), 307);
    }
  } else {
    const match = /^\/vacantes\/([^/]+)(?:\/postular)?$/.exec(pathname);
    if (match && !isValidJobId(match[1])) {
      // Render outside the vacancy loading ancestry: the destination calls
      // notFound before a loading boundary can flush a successful shell.
      return NextResponse.rewrite(new URL("/vacante-no-encontrada", request.nextUrl), { status: 404 });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/vacantes", "/vacantes/:jobId", "/vacantes/:jobId/postular"],
};
