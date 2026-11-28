// Embedded-auth accounts for the e2e (A4.7): the identity and company routes the
// sign-up → onboarding flows call, for access tokens minted by the mock Cognito
// (tests/fixtures/cognito-mock.mjs). In-memory and test-only, NOT an auth
// service: a token is accepted exactly when the mock's own GetUser accepts it
// (RS256 signature, issuer, token_use, expiry, existing user), the same check the
// backend makes in `IDENTITY_PROVIDER=cognito_getuser` mode. Requests whose
// Bearer is not a mock-issued token fall through to the older fixtures, which
// answer any Bearer as the Nexo Labs recruiter (unchanged).
//
// Routes (backend contract embedded-auth-v1, candidate-identity v1):
// - GET  /v2/me                       → {role, user} or {role: null, user: null}
// - POST /v2/me/candidate-account     → 201 created / 200 already candidate / 409 account_exists / 422 email_not_verified
// - POST /v2/me/employer-account      → 201 created / 200 already recruiter / 409 account_exists / 422 email_not_verified
// - GET  /me/company                  → membership (owner) / 404 not_found / 401 without an account
// - POST /companies                   → 201 company / 409 already_exists (own company or RFC taken) / 403 wrong_role
// - GET  /industries                  → small public catalog (anonymous)
// Never logs tokens, emails or names.
import { randomUUID } from "node:crypto";
import { COGNITO_MOCK_DEFAULTS } from "./cognito-mock.mjs";

const MAX_BODY_BYTES = 16 * 1024;
const RFC = /^[A-ZÑ&]{3}\d{6}[A-Z\d]{3}$/;

export const INDUSTRIES = Object.freeze([
  { id: "tecnologia", label_es: "Tecnología", label_en: "Technology", sort_order: 1 },
  { id: "manufactura", label_es: "Manufactura", label_en: "Manufacturing", sort_order: 2 },
  { id: "servicios", label_es: "Servicios", label_en: "Services", sort_order: 3 },
]);

function bearer(request) {
  const header = request.headers.authorization;
  return typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/** Only a JWT whose (unverified) issuer is the mock's is claimed; GetUser verifies it. */
function mockIssued(token, issuer) {
  const parts = token?.split(".");
  if (!parts || parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()).iss === issuer;
  } catch {
    return false;
  }
}

function readJson(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) request.destroy();
      else chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(value && typeof value === "object" && !Array.isArray(value) ? value : null);
      } catch {
        resolve(null);
      }
    });
    request.on("error", () => resolve(null));
  });
}

const normalizedName = (value) => value.normalize("NFC").trim().replace(/\p{White_Space}+/gu, " ");
const validName = (value) => {
  const length = Array.from(value).length;
  return length >= 2 && length <= 120 && !/\p{Cc}/u.test(value);
};

export function createEmbeddedAuthAccounts({
  cognitoOrigin = process.env.COGNITO_MOCK_ORIGIN ?? "http://127.0.0.1:4599",
  issuer = process.env.COGNITO_MOCK_ISSUER || COGNITO_MOCK_DEFAULTS.issuer,
  fetchImpl = fetch,
} = {}) {
  let accounts = new Map(); // sub → { id, role, email, full_name }
  let companies = new Map(); // sub → company
  const send = (response, status, body) => {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
  };
  const envelope = (response, status, code, error) => send(response, status, { error, code });

  /** The mock's GetUser, exactly as the backend's provider calls it (contract §GetUser stub). */
  async function getUser(token) {
    try {
      const answer = await fetchImpl(new URL("/", cognitoOrigin), {
        method: "POST",
        headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "AWSCognitoIdentityProviderService.GetUser" },
        body: JSON.stringify({ AccessToken: token }),
        redirect: "error",
      });
      if (answer.status !== 200) return answer.status === 400 ? { ok: false, kind: "unauthenticated" } : { ok: false, kind: "unavailable" };
      const body = await answer.json();
      const attribute = (name) => body.UserAttributes?.find((entry) => entry.Name === name)?.Value;
      return { ok: true, sub: attribute("sub"), email: attribute("email"), emailVerified: attribute("email_verified") === "true" };
    } catch {
      return { ok: false, kind: "unavailable" };
    }
  }

  const identity = (account) =>
    account ? { role: account.role, user: { id: account.id, email: account.email, full_name: account.full_name } } : { role: null, user: null };

  async function onboard(request, response, user, role) {
    const body = await readJson(request);
    const keys = body ? Object.keys(body) : [];
    if (!body || keys.length !== 1 || typeof body.full_name !== "string" || !validName(normalizedName(body.full_name)))
      return envelope(response, 400, "validation_error", "invalid full_name");
    const existing = accounts.get(user.sub);
    if (existing) {
      if (existing.role === role) return send(response, 200, identity(existing));
      return envelope(response, 409, "account_exists", "account already exists with another role");
    }
    if (!user.emailVerified) return envelope(response, 422, "email_not_verified", "email not verified");
    if ([...accounts.values()].some((account) => account.email === user.email.toLowerCase()))
      return envelope(response, 409, "email_in_use", "email in use");
    const account = { id: randomUUID(), role, email: user.email.toLowerCase(), full_name: normalizedName(body.full_name) };
    accounts.set(user.sub, account);
    return send(response, 201, identity(account));
  }

  async function createCompany(request, response, sub) {
    const account = accounts.get(sub);
    if (!account) return envelope(response, 401, "account_required", "account required");
    if (account.role !== "recruiter") return envelope(response, 403, "wrong_role", "account role not allowed");
    const body = await readJson(request);
    if (!body) return envelope(response, 400, "invalid_request", "invalid body");
    if (companies.has(sub)) return envelope(response, 409, "already_exists", "user already has a company membership");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const rfc = typeof body.rfc === "string" ? body.rfc.trim().toUpperCase() : "";
    if (name.length < 4 || !RFC.test(rfc)) return envelope(response, 400, "validation_error", "invalid company");
    if (!INDUSTRIES.some((industry) => industry.id === body.industry_id))
      return envelope(response, 409, "industry_unavailable", "industry unavailable");
    if ([...companies.values()].some((company) => company.rfc === rfc)) return envelope(response, 409, "already_exists", "rfc already registered");
    const company = {
      id: randomUUID(),
      name,
      rfc,
      industry_id: body.industry_id,
      status: "active",
      location: null,
      updated_at: new Date().toISOString(),
    };
    companies.set(sub, company);
    return send(response, 201, company);
  }

  async function serve(request, response, url, token) {
    const user = await getUser(token);
    if (!user.ok)
      return user.kind === "unauthenticated"
        ? envelope(response, 401, "unauthenticated", "unauthenticated")
        : envelope(response, 503, "identity_unavailable", "identity provider unavailable");
    const { pathname } = url;
    const method = request.method;
    if (pathname === "/v2/me" && method === "GET") return send(response, 200, identity(accounts.get(user.sub)));
    if (pathname === "/v2/me/candidate-account" && method === "POST") return onboard(request, response, user, "candidate");
    if (pathname === "/v2/me/employer-account" && method === "POST") return onboard(request, response, user, "recruiter");
    if (pathname === "/me/company" && method === "GET") {
      const account = accounts.get(user.sub);
      if (!account) return envelope(response, 401, "account_required", "account required");
      if (account.role !== "recruiter") return envelope(response, 403, "wrong_role", "account role not allowed");
      const company = companies.get(user.sub);
      if (!company) return envelope(response, 404, "not_found", "company not found");
      return send(response, 200, { company_id: company.id, role: "owner", company, can: { view_talent_base: true, view_metrics: true } });
    }
    if (pathname === "/companies" && method === "POST") return createCompany(request, response, user.sub);
    // Session audit (best effort in the app): acknowledged without recording anything.
    if (/^\/v2\/me\/session\/(?:start|end)$/.test(pathname) && method === "POST") {
      response.writeHead(204, { "cache-control": "no-store" });
      return response.end();
    }
    return null;
  }

  const OWN_PATHS = new Set(["/v2/me", "/v2/me/candidate-account", "/v2/me/employer-account", "/me/company", "/companies", "/v2/me/session/start", "/v2/me/session/end"]);

  /**
   * Claims the request synchronously (true) and answers it asynchronously, or
   * returns false so the caller's older fixtures handle it.
   */
  function handle(request, response, url) {
    if (url.pathname === "/industries" && request.method === "GET") {
      send(response, 200, INDUSTRIES);
      return true;
    }
    if (url.pathname === "/__embedded-auth/reset" && request.method === "POST") {
      reset();
      send(response, 200, { ok: true });
      return true;
    }
    if (!OWN_PATHS.has(url.pathname)) return false;
    const token = bearer(request);
    if (!mockIssued(token, issuer)) return false;
    serve(request, response, url, token)
      .then((answered) => {
        if (answered === null && !response.headersSent) envelope(response, 405, "invalid_request", "method not allowed");
      })
      .catch(() => {
        if (!response.headersSent) envelope(response, 500, "internal_error", "internal error");
      });
    return true;
  }

  function reset() {
    accounts = new Map();
    companies = new Map();
  }

  return { handle, reset };
}
