import { createServer } from "node:http";

const port = Number(process.env.JOBS_FIXTURE_PORT ?? 4010);
const requests = [];
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
    return send(response, 200, { ok: true });
  }
  if (url.pathname !== "/jobs")
    return send(response, 404, { error: "not found" });

  requests.push(url.search);
  if (url.searchParams.get("q") === "error") {
    return send(response, 503, { error: "unavailable" });
  }
  if (url.searchParams.get("q") === "empty")
    return send(response, 200, { items: [] });
  const payload = { items: [job], next_cursor: "opaque a+b/c=" };
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
