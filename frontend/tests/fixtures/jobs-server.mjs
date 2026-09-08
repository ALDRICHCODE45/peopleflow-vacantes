import { createServer } from "node:http";

const port = Number(process.env.JOBS_FIXTURE_PORT ?? 4010);
const requests = [];
// Persistent out-of-band failure for `/jobs` requests, armed by `/__failure`
// and cleared only by `/__recover` or `/__reset`, so a prefetch or an aborted
// timeout request can never silently consume a one-shot failure.
const failureState = { kind: null };
const job = {
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e",
  title: "Ingeniera Frontend",
  description: "Construye experiencias accesibles.",
  work_mode: "remote",
  employment_type: "full_time",
  seniority: "senior",
  salary_currency: "MXN",
  company: {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f",
    name: "Acme",
  },
};

function send(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (url.pathname === "/__health") return send(response, 200, { ok: true });
  if (url.pathname === "/__requests") return send(response, 200, requests);
  if (url.pathname === "/__reset") {
    requests.length = 0;
    failureState.kind = null;
    return send(response, 200, { ok: true });
  }
  if (url.pathname === "/__failure") {
    const kind = url.searchParams.get("kind");
    if (kind !== "5xx" && kind !== "schema" && kind !== "timeout")
      return send(response, 400, { error: "unknown failure kind" });
    failureState.kind = kind;
    return send(response, 200, { ok: true, kind });
  }
  if (url.pathname === "/__recover") {
    // Recovery keeps the request history: tests assert on the fresh
    // same-query request issued after the failure was armed.
    failureState.kind = null;
    return send(response, 200, { ok: true });
  }
  if (url.pathname !== "/jobs")
    return send(response, 404, { error: "not found" });

  requests.push(url.search);
  // First-page requests advertise the opaque next cursor; a cursor
  // request models the nonempty final page: items are present but
  // `next_cursor` is absent, so the frontend must omit pagination.
  const payload = url.searchParams.has("cursor")
    ? { items: [job] }
    : { items: [job], next_cursor: "opaque a+b/c=" };
  if (url.searchParams.get("q") === "error") {
    return send(response, 503, { error: "unavailable" });
  }
  if (url.searchParams.get("q") === "empty")
    return send(response, 200, { items: [] });
  // Armed failure kinds reproduce the guarded failure classes: a 5xx
  // status, valid JSON that violates the item schema (invalid UUID),
  // and a delayed response beyond the production API timeout (its timer
  // is cleared when the aborted response closes).
  if (failureState.kind === "5xx")
    return send(response, 500, { error: "internal server error" });
  if (failureState.kind === "schema")
    return send(response, 200, { items: [{ ...job, id: "not-a-uuid" }] });
  if (failureState.kind === "timeout") {
    const timer = setTimeout(() => send(response, 200, payload), 1500);
    response.on("close", () => clearTimeout(timer));
    return;
  }
  if (
    url.searchParams.has("cursor") ||
    url.searchParams.get("q") === "pending-search" ||
    url.searchParams.get("currency") === "USD"
  )
    return setTimeout(() => send(response, 200, payload), 300);
  return send(response, 200, payload);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`jobs fixture listening on ${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
