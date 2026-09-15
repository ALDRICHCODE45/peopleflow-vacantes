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
// would force horizontal overflow on narrow viewports.
const longContentJob = {
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d90",
  title:
    "Ingeniería de Plataformas de Datos y Observabilidad para la plataformaoperativadedatosyobservabilidadintegraldistribuida",
  description:
    "Descripción extensa de prueba para el escenario de contenido largo.",
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

    // Task 8.3 GREEN — fixture-only sentinel dataset for the conjunctive
    // every-predicate USD proof. The target matches all six supported
    // predicates and each decoy fails exactly one, so an OR evaluation over
    // the fully-conjunctive URL would leak at least one decoy while AND
    // must return only the target.
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

    // Deterministic fixture-only conjunctive evaluator: every present
    // supported predicate (`q`, `seniority`, `work_mode`,
    // `employment_type`, `location`, `currency`) must match. `cursor`
    // stays pagination, never a predicate.
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
  if (url.pathname === "/__visibility") {
    const id = url.searchParams.get("id");
    const visible = url.searchParams.get("visible");
    if (id === null || (visible !== "true" && visible !== "false"))
      return send(response, 400, { error: "bad visibility control" });
    // Task 8.4 RED — the control only validates and acknowledges the
    // request; no hidden state exists yet, so list and detail requests
    // keep serving the vacancy as visible.
    return send(response, 200, { ok: true, visible });
  }
  if (url.pathname === "/__recover") {
    // Recovery keeps the request history: tests assert on the fresh
    // same-query request issued after the failure was armed.
    failureState.kind = null;
    return send(response, 200, { ok: true });
  }
  // Detail requests target `/jobs/{id}` and log the exact pathname; list
  // requests keep logging only the search text, as the list specs assert.
  const detailId = url.pathname.match(/^\/jobs\/([^/]+)$/)?.[1];
  if (detailId === undefined && url.pathname !== "/jobs")
    return send(response, 404, { error: "not found" });

  requests.push(detailId === undefined ? url.search : url.pathname);
  // First-page requests advertise the opaque next cursor; a cursor
  // request models the nonempty final page: items are present but
  // `next_cursor` is absent, so the frontend must omit pagination. A
  // detail request's payload is the bare job, or `undefined` for an
  // unknown identifier, which is answered with a backend 404 below.
  const payload =
    detailId !== undefined
      ? detailJobs[detailId]
      : url.searchParams.has("cursor")
        ? { items: [job] }
        : { items: [job], next_cursor: "opaque a+b/c=" };
  if (url.searchParams.get("q") === "error") {
    return send(response, 503, { error: "unavailable" });
  }
  if (url.searchParams.get("q") === "empty")
    return send(response, 200, { items: [] });
  if (url.searchParams.get("q") === "long-content")
    return send(response, 200, { items: [longContentJob] });
  // Armed failure kinds reproduce the guarded failure classes: a 5xx
  // status, valid JSON that violates the item schema (invalid UUID),
  // and a delayed response beyond the production API timeout (its timer
  // is cleared when the aborted response closes).
  if (failureState.kind === "5xx")
    return send(response, 500, { error: "internal server error" });
  if (failureState.kind === "schema") {
    const bad = { ...job, id: "not-a-uuid" };
    return send(response, 200, detailId !== undefined ? bad : { items: [bad] });
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
        return send(response, 200, { items: [currencyProofJob] });
      // Task 8.3 GREEN — the sentinel query serves the dedicated dataset
      // evaluated conjunctively over every present supported predicate.
      if (url.searchParams.get("q") === usdConjunctiveQ)
        return send(response, 200, {
          items: usdConjunctiveJobs.filter((item) =>
            matchesUsdConjunctive(item, url.searchParams),
          ),
          // Pagination stays pagination: a cursor request answers the
          // nonempty final page, a first page advertises the next cursor.
          ...(url.searchParams.has("cursor")
            ? {}
            : { next_cursor: "opaque a+b/c=" }),
        });
  if (
    url.searchParams.has("cursor") ||
    url.searchParams.get("q") === "pending-search" ||
    url.searchParams.get("currency") === "USD"
  )
    return setTimeout(() => send(response, 200, payload), 300);
  if (detailId !== undefined && payload === undefined)
    return send(response, 404, { error: "not found" });
  return send(response, 200, payload);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`jobs fixture listening on ${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
