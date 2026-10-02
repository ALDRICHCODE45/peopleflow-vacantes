import { createServer } from "node:http";

const port = Number(process.env.JOBS_FIXTURE_PORT ?? 4010);
const requests = [];
// Persistent out-of-band failure for `/jobs` requests, armed by `/__failure`
// and cleared only by `/__recover` or `/__reset`, so a prefetch or an aborted
// timeout request can never silently consume a one-shot failure.
const failureState = { kind: null };
// Task 8.4 — request-time visibility. `hiddenJobs` is the id-keyed contract
// (`/__visibility?id=&visible=`) applied to every later list or detail read;
// `visibilityState.hidden` is the C2 contract (`/__visibility?hidden=0|1`)
// that hides the main fixture vacancy from both reads.
const hiddenJobs = new Set();
const visibilityState = { hidden: false };
// Task 8.4 / C2 — armed response delay so buffering assertions can await
// completed responses. It applies only to `/jobs` data responses, never to
// the control endpoints.
const delayState = { ms: 0 };
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
// Detail-only vacancy: markup-like description text plus present optional
// metadata fields, so the safe-description detail rendering is observable.
const richDetailJob = {
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92",
  title: "Desarrolladora Go",
  description:
    "Primer párrafo de la vacante.\n\n<script>alert('xss')</script>\n\nSegundo párrafo con <img src=x onerror=alert(1)> incrustado.\n\nLínea uno\nLínea dos.",
  work_mode: "hybrid",
  employment_type: "contract",
  seniority: "lead",
  salary_currency: "MXN",
  location: "Monterrey, Nuevo León",
  salary_min: 30000,
  salary_max: 45000,
  published_at: "2026-02-14T09:30:00Z",
  company: {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d93",
    name: "Acme",
  },
};

// Isolated long-content vacancy for the wrapping/readability scenario: every
// field is schema-valid, and the title contains one uninterrupted segment
// that natural word wrapping cannot break, so a row without `overflow-wrap`
// would force horizontal overflow on narrow viewports. The description stays
// long enough that a pre-render character budget would be observable.
const longContentJob = {
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d90",
  title:
    "Ingeniería de Plataformas de Datos y Observabilidad para la plataformaoperativadedatosyobservabilidadintegraldistribuida",
  description:
    "Contexto del equipo de plataforma.\n\n\tResponsabilidades del rol: <script>alert('xss')</script> construir  flujos   de datos confiables; revisar <img src=x onerror=alert(1)> tableros operativos; documentar decisiones de arquitectura y acompañar a otras personas en el diseño de servicios de observabilidad distribuida de extremo a extremo. 🙂 Cierre del anuncio de prueba.",
  work_mode: "hybrid",
  employment_type: "contract",
  seniority: "lead",
  salary_currency: "MXN",
  location:
    "San Nicolás de los Garza, Nuevo León, Zona Metropolitana Extendida Noreste",
  salary_min: 1234567,
  salary_max: 98765432,
  published_at: "2026-02-14T09:30:00Z",
  company: {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d91",
    name: "Consultoría Integral de Ingeniería de Software y Datos Confiables",
  },
};

// Task 6.2 GREEN — dedicated USD currency-proof vacancy for exact title/salary
// evidence profile. Returns only this vacancy with no next_cursor for the
// specific query that the cross-cutting.spec.ts USD test exercises.
const currencyProofJob = {
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d94",
  title: "Ingeniera Currency Proof",
  description: "Prueba de salario en dólares.",
  work_mode: "remote",
  employment_type: "full_time",
  seniority: "senior",
  salary_currency: "USD",
  salary_min: 100000,
  salary_max: 120000,
  published_at: "2026-02-14T09:30:00Z",
  company: {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d95",
    name: "Acme",
  },
};

// Task 8.3 / C1 — mixed and-proof pool for the combined scalar-filter
// proof: one exact six-predicate match plus three single-predicate near
// misses (hybrid mode, junior seniority, USD currency), so only a strict
// AND evaluation of every active predicate yields a single exact result.
const andProofCompany = {
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d97",
  name: "Acme",
};
const andProofExactJob = {
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d96",
  title: "Ingeniera And Proof",
  description:
    "Vacante de prueba AND: senior, remota, tiempo completo, Monterrey, MXN.",
  work_mode: "remote",
  employment_type: "full_time",
  seniority: "senior",
  salary_currency: "MXN",
  location: "Monterrey, Nuevo León",
  salary_min: 50000,
  salary_max: 80000,
  published_at: "2026-02-14T09:30:00Z",
  company: andProofCompany,
};
const andProofHybridMissJob = {
  ...andProofExactJob,
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d98",
  title: "Ingeniera And Proof Híbrida",
  work_mode: "hybrid",
};
const andProofJuniorMissJob = {
  ...andProofExactJob,
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d99",
  title: "Ingeniera And Proof Junior",
  seniority: "junior",
};
const andProofUsdMissJob = {
  ...andProofExactJob,
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d9a",
  title: "Ingeniera And Proof Dólares",
  salary_currency: "USD",
};
const andProofPool = [
  andProofExactJob,
  andProofHybridMissJob,
  andProofJuniorMissJob,
  andProofUsdMissJob,
];
// Currency-only requests evaluate over this mixed MXN/USD pool, so
// `currency=USD` renders only the actual USD vacancy and never the
// ordinary MXN fallback job.
const currencyPool = [job, currencyProofJob];

// Task 8.3 GREEN — fixture-only sentinel dataset for the conjunctive
// every-predicate USD proof. The target matches all six supported predicates
// and each decoy fails exactly one, so an OR evaluation over the fully
// conjunctive URL would leak at least one decoy while AND must return only the
// target.
const usdConjunctiveQ = "conjuntiva";
const usdConjunctiveTarget = {
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d96",
  title: "Analista Conjuntiva de Datos",
  description: "Prueba conjuntiva de todos los predicados en dólares.",
  work_mode: "remote",
  employment_type: "full_time",
  seniority: "senior",
  salary_currency: "USD",
  salary_min: 100000,
  salary_max: 120000,
  location: "Monterrey",
  company: {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d97",
    name: "Acme",
  },
};
const usdConjunctiveDecoys = [
  // Fails only `q`: the search term is absent from the title.
  {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d98",
    title: "Desarrolladora Senior de Plataformas",
    description: "Decoy que falla solo la búsqueda.",
    work_mode: "remote",
    employment_type: "full_time",
    seniority: "senior",
    salary_currency: "USD",
    salary_min: 100000,
    salary_max: 120000,
    location: "Monterrey",
    company: {
      id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d99",
      name: "Acme",
    },
  },
  // Fails only `seniority`.
  {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d9a",
    title: "Ingeniera Conjuntiva Lead",
    description: "Decoy que falla solo la seniority.",
    work_mode: "remote",
    employment_type: "full_time",
    seniority: "lead",
    salary_currency: "USD",
    salary_min: 100000,
    salary_max: 120000,
    location: "Monterrey",
    company: {
      id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7da2",
      name: "Acme",
    },
  },
  // Fails only `work_mode`.
  {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d9b",
    title: "Diseñadora Conjuntiva Híbrida",
    description: "Decoy que falla solo la modalidad.",
    work_mode: "hybrid",
    employment_type: "full_time",
    seniority: "senior",
    salary_currency: "USD",
    salary_min: 100000,
    salary_max: 120000,
    location: "Monterrey",
    company: {
      id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7da3",
      name: "Acme",
    },
  },
  // Fails only `employment_type`.
  {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d9c",
    title: "Scrum Master Conjuntiva",
    description: "Decoy que falla solo el tipo de empleo.",
    work_mode: "remote",
    employment_type: "contract",
    seniority: "senior",
    salary_currency: "USD",
    salary_min: 100000,
    salary_max: 120000,
    location: "Monterrey",
    company: {
      id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d9d",
      name: "Acme",
    },
  },
  // Fails only `location`.
  {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d9e",
    title: "QA Conjuntiva Guadalajara",
    description: "Decoy que falla solo la ubicación.",
    work_mode: "remote",
    employment_type: "full_time",
    seniority: "senior",
    salary_currency: "USD",
    salary_min: 100000,
    salary_max: 120000,
    location: "Guadalajara",
    company: {
      id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d9f",
      name: "Acme",
    },
  },
  // Fails only `currency`.
  {
    id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7da0",
    title: "DevOps Conjuntiva MXN",
    description: "Decoy que falla solo la moneda.",
    work_mode: "remote",
    employment_type: "full_time",
    seniority: "senior",
    salary_currency: "MXN",
    salary_min: 100000,
    salary_max: 120000,
    location: "Monterrey",
    company: {
      id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7da1",
      name: "Acme",
    },
  },
];
const usdConjunctiveJobs = [usdConjunctiveTarget, ...usdConjunctiveDecoys];

// Task 8.3 / C1 — strict scalar-filter evaluation: `q` matches every
// token case-insensitively across title/description, enum filters are
// exact, `location` is a case-insensitive substring, and `currency` is
// the exact single wire value. Every active predicate must match (AND).
function qTokens(value) {
  return (value ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}
function matchesEveryPredicate(vacancy, searchParams) {
  const haystack = `${vacancy.title} ${vacancy.description}`.toLowerCase();
  const q = searchParams.get("q");
  if (q && !qTokens(q).every((token) => haystack.includes(token))) return false;
  for (const key of ["seniority", "work_mode", "employment_type"]) {
    const value = searchParams.get(key);
    if (value && vacancy[key] !== value) return false;
  }
  const location = searchParams.get("location");
  if (
    location &&
    !(vacancy.location ?? "").toLowerCase().includes(location.toLowerCase())
  )
    return false;
  const currency = searchParams.get("currency");
  if (currency && vacancy.salary_currency !== currency) return false;
  return true;
}

// Deterministic fixture-only conjunctive evaluator: every present supported
// predicate (`q`, `seniority`, `work_mode`, `employment_type`, `location`,
// `currency`) must match. `cursor` stays pagination, never a predicate.
function matchesUsdConjunctive(item, searchParams) {
  const q = searchParams.get("q");
  if (q !== null && !item.title.toLowerCase().includes(q.toLowerCase()))
    return false;
  for (const [param, field] of [
    ["seniority", "seniority"],
    ["work_mode", "work_mode"],
    ["employment_type", "employment_type"],
    ["location", "location"],
    ["currency", "salary_currency"],
  ]) {
    const value = searchParams.get(param);
    if (value !== null && item[field] !== value) return false;
  }
  return true;
}

// Detail map: known ids answer `/jobs/{id}` with their bare job shape.
const detailJobs = {
  [job.id]: job,
  [longContentJob.id]: longContentJob,
  [richDetailJob.id]: richDetailJob,
  [currencyProofJob.id]: currencyProofJob,
  [usdConjunctiveTarget.id]: usdConjunctiveTarget,
};

function send(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  // Task 8.4 — a vacancy is hidden when it is id-hidden (source contract) or
  // when the C2 toggle hides the main fixture vacancy.
  const isHidden = (id) =>
    hiddenJobs.has(id) || (visibilityState.hidden && id === job.id);
  if (url.pathname === "/__health") return send(response, 200, { ok: true });
  if (url.pathname === "/__requests") return send(response, 200, requests);
  if (url.pathname === "/__reset") {
    requests.length = 0;
    failureState.kind = null;
    hiddenJobs.clear();
    visibilityState.hidden = false;
    delayState.ms = 0;
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
  if (url.pathname === "/__visibility") {
    const id = url.searchParams.get("id");
    const visible = url.searchParams.get("visible");
    // Id-keyed contract: `/__visibility?id=<id>&visible=true|false` toggles
    // one vacancy's visibility through the fixture's hidden set.
    if (id !== null || visible !== null) {
      if (id === null || (visible !== "true" && visible !== "false"))
        return send(response, 400, { error: "bad visibility control" });
      if (visible === "false") hiddenJobs.add(id);
      else hiddenJobs.delete(id);
      return send(response, 200, { ok: true, visible });
    }
    // C2 contract: `/__visibility?hidden=0|1` hides the main vacancy.
    const hidden = url.searchParams.get("hidden");
    if (hidden !== "0" && hidden !== "1")
      return send(response, 400, { error: "hidden must be 0 or 1" });
    visibilityState.hidden = hidden === "1";
    return send(response, 200, { ok: true, hidden: visibilityState.hidden });
  }
  if (url.pathname === "/__delay") {
    const ms = Number(url.searchParams.get("ms") ?? "0");
    if (!Number.isInteger(ms) || ms < 0 || ms > 5000)
      return send(response, 400, {
        error: "ms must be an integer between 0 and 5000",
      });
    delayState.ms = ms;
    return send(response, 200, { ok: true, ms });
  }
  // Detail requests target `/jobs/{id}` and log the exact pathname; list
  // requests keep logging only the search text, as the list specs assert.
  const detailId = url.pathname.match(/^\/jobs\/([^/]+)$/)?.[1];
  if (detailId === undefined && url.pathname !== "/jobs")
    return send(response, 404, { error: "not found" });

  requests.push(detailId === undefined ? url.search : url.pathname);
  // Task 8.4 / C2 — the armed delay applies only to data responses (every
  // request reaching this point is a `/jobs` request), never to control
  // endpoints, so health/readiness polling stays immediate.
  const respond = (target, status, payload) => {
    if (delayState.ms > 0)
      return setTimeout(() => send(target, status, payload), delayState.ms);
    return send(target, status, payload);
  };
  // First-page requests advertise the opaque next cursor; a cursor
  // request models the nonempty final page: items are present but
  // `next_cursor` is absent, so the frontend must omit pagination. A
  // detail request's payload is the bare job, or `undefined` for an
  // unknown or hidden identifier, which is answered with a backend 404 below.
  // Task 8.4 — hidden vacancies leave both the list payload and the detail
  // lookup, mirroring the backend visibility boundary.
  const listItems = [job].filter((item) => !isHidden(item.id));
  const payload =
    detailId !== undefined
      ? isHidden(detailId)
        ? undefined
        : detailJobs[detailId]
      : url.searchParams.has("cursor")
        ? { items: listItems }
        : { items: listItems, next_cursor: "opaque a+b/c=" };
  if (url.searchParams.get("q") === "error") {
    return respond(response, 503, { error: "unavailable" });
  }
  if (url.searchParams.get("q") === "empty")
    return respond(response, 200, { items: [] });
  if (url.searchParams.get("q") === "long-content")
    return respond(response, 200, { items: [longContentJob] });
  // Armed failure kinds reproduce the guarded failure classes: a 5xx
  // status, valid JSON that violates the item schema (invalid UUID),
  // and a delayed response beyond the production API timeout (its timer
  // is cleared when the aborted response closes).
  if (failureState.kind === "5xx")
    return respond(response, 500, { error: "internal server error" });
  if (failureState.kind === "schema") {
    const bad = { ...job, id: "not-a-uuid" };
    return respond(
      response,
      200,
      detailId !== undefined ? bad : { items: [bad] },
    );
  }
  if (failureState.kind === "timeout") {
    const timer = setTimeout(() => send(response, 200, payload), 1500);
    response.on("close", () => clearTimeout(timer));
    return;
  }
  // Task 6.2 GREEN — dedicated USD currency-proof vacancy for exact title/salary
  // evidence profile. Returns only this vacancy with no next_cursor.
  if (
    url.searchParams.get("q") === "currency-proof" &&
    url.searchParams.get("currency") === "USD"
  )
    return respond(response, 200, { items: [currencyProofJob] });
  // Task 8.3 / C1 — dedicated and-proof marker query evaluates every
  // active predicate with strict AND semantics over the mixed pool, so a
  // forwarding-only response, an OR match, or the MXN fallback cannot
  // satisfy the focused combined-filter assertions.
  if (!detailId && url.searchParams.get("q") === "and-proof") {
    const items = andProofPool.filter((vacancy) =>
      matchesEveryPredicate(vacancy, url.searchParams),
    );
    const filtered = url.searchParams.has("cursor")
      ? { items }
      : { items, next_cursor: "opaque a+b/c=" };
    return respond(response, 200, filtered);
  }
  // Task 8.3 GREEN — the conjunctive sentinel query serves the dedicated
  // dataset evaluated conjunctively over every present supported predicate.
  if (url.searchParams.get("q") === usdConjunctiveQ)
    return respond(response, 200, {
      items: usdConjunctiveJobs.filter((item) =>
        matchesUsdConjunctive(item, url.searchParams),
      ),
      // Pagination stays pagination: a cursor request answers the nonempty
      // final page, a first page advertises the next cursor.
      ...(url.searchParams.has("cursor")
        ? {}
        : { next_cursor: "opaque a+b/c=" }),
    });
  // Task 8.3 / C1 — currency-only requests evaluate the exact single
  // currency over the mixed MXN/USD pool; `currency=USD` keeps the 300ms
  // delay so the pending announcement stays observable.
  if (
    detailId === undefined &&
    !url.searchParams.has("q") &&
    !url.searchParams.has("cursor") &&
    url.searchParams.has("currency")
  ) {
    const currency = url.searchParams.get("currency");
    const items = currencyPool.filter(
      (vacancy) => vacancy.salary_currency === currency,
    );
    if (currency === "USD")
      return setTimeout(
        () => send(response, 200, { items, next_cursor: "opaque a+b/c=" }),
        300,
      );
    return respond(response, 200, { items, next_cursor: "opaque a+b/c=" });
  }
  if (
    url.searchParams.has("cursor") ||
    url.searchParams.get("q") === "pending-search" ||
    url.searchParams.get("currency") === "USD"
  )
    return setTimeout(() => send(response, 200, payload), 300);
  if (detailId !== undefined && payload === undefined)
    return respond(response, 404, { error: "not found" });
  return respond(response, 200, payload);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`jobs fixture listening on ${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
