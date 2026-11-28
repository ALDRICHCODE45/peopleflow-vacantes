import { createHmac } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createEmbeddedAuthAccounts } from "./embedded-auth-accounts.mjs";

// The e2e accounts fixture against the real mock Cognito: tokens are accepted only
// through the mock's GetUser, and non-mock Bearers fall through to older fixtures.
const CLIENT_ID = "peopleflow-e2e";
const CLIENT_SECRET = "peopleflow-e2e-secret";
const PASSWORD = "Sup3r-secret-pass!";

let cognito: ChildProcess;
let cognitoOrigin: string;
let api: Server;
let apiOrigin: string;
let accounts: ReturnType<typeof createEmbeddedAuthAccounts>;

beforeAll(async () => {
  cognito = spawn(process.execPath, ["tests/fixtures/cognito-mock.mjs"], { env: { ...process.env, COGNITO_MOCK_PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  const [chunk] = await once(cognito.stdout!, "data");
  cognitoOrigin = `http://127.0.0.1:${String(chunk).match(/cognito mock listening on (\d+)/)![1]}`;
  accounts = createEmbeddedAuthAccounts({ cognitoOrigin });
  api = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (!accounts.handle(request, response, url)) {
      response.writeHead(418, { "content-type": "application/json" });
      response.end(JSON.stringify({ fallthrough: true }));
    }
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  apiOrigin = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});
afterAll(async () => {
  api.close();
  const closed = once(cognito, "exit");
  cognito.kill("SIGTERM");
  await closed;
});
beforeEach(async () => {
  await fetch(`${cognitoOrigin}/__cognito/reset`, { method: "POST" });
  accounts.reset();
});

async function tokenFor(email: string, extra: Record<string, unknown> = {}): Promise<string> {
  expect((await fetch(`${cognitoOrigin}/__cognito/users`, { method: "POST", body: JSON.stringify({ email, password: PASSWORD, name: "Ana Ruiz", ...extra }) })).status).toBe(201);
  const response = await fetch(cognitoOrigin, {
    method: "POST",
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "AWSCognitoIdentityProviderService.InitiateAuth" },
    body: JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: email, PASSWORD, SECRET_HASH: createHmac("sha256", CLIENT_SECRET).update(email + CLIENT_ID).digest("base64") },
    }),
  });
  return ((await response.json()) as { AuthenticationResult: { AccessToken: string } }).AuthenticationResult.AccessToken;
}

async function call(path: string, token: string | null, method = "GET", body?: unknown) {
  const response = await fetch(`${apiOrigin}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: response.status === 204 ? null : ((await response.json()) as Record<string, unknown>) };
}

test("leaves every non-mock Bearer (and anonymous identity reads) to the older fixtures", async () => {
  expect((await call("/v2/me", "any-fixture-token")).status).toBe(418);
  expect((await call("/v2/me", null)).status).toBe(418);
  expect((await call("/me/company", "a.b.c")).status).toBe(418);
  expect((await call("/industries", null)).json).toEqual(expect.arrayContaining([expect.objectContaining({ id: "tecnologia" })]));
});

test("candidate onboarding: no account → 201 created → 200 again; the other role is 409 account_exists", async () => {
  const token = await tokenFor("ana@correo.com");
  expect(await call("/v2/me", token)).toEqual({ status: 200, json: { role: null, user: null } });
  expect((await call("/v2/me/candidate-account", token, "POST", { full_name: "x" })).json).toMatchObject({ code: "validation_error" });
  const created = await call("/v2/me/candidate-account", token, "POST", { full_name: "  Ana   Ruiz " });
  expect(created).toMatchObject({ status: 201, json: { role: "candidate", user: { email: "ana@correo.com", full_name: "Ana Ruiz" } } });
  expect((await call("/v2/me/candidate-account", token, "POST", { full_name: "Ana Ruiz" })).status).toBe(200);
  expect((await call("/v2/me/employer-account", token, "POST", { full_name: "Ana Ruiz" })).json).toMatchObject({ code: "account_exists" });
  expect((await call("/v2/me", token)).json).toMatchObject({ role: "candidate" });
});

test("an unverified email gets 422 and a tampered token 401, never an account", async () => {
  const unverified = await tokenFor("nov@correo.com", { emailVerified: false });
  expect(await call("/v2/me/employer-account", unverified, "POST", { full_name: "Ana Ruiz" })).toMatchObject({ status: 422, json: { code: "email_not_verified" } });
  const token = await tokenFor("ok@correo.com");
  const [header, payload] = token.split(".");
  expect((await call("/v2/me", `${header}.${payload}.AAAA`)).status).toBe(401);
});

test("employer: account, then «Tu empresa» (404 → 201), membership as owner, one company per account and per RFC", async () => {
  const token = await tokenFor("laura@empresa.mx");
  expect((await call("/me/company", token)).status).toBe(401);
  expect((await call("/companies", token, "POST", { name: "Andamios", rfc: "ADN200101AB1", industry_id: "tecnologia" })).status).toBe(401);
  expect((await call("/v2/me/employer-account", token, "POST", { full_name: "Laura Méndez" })).json).toMatchObject({ role: "recruiter" });
  expect(await call("/me/company", token)).toMatchObject({ status: 404, json: { code: "not_found" } });
  expect((await call("/companies", token, "POST", { name: "Andamios", rfc: "ADN200101AB1", industry_id: "otra" })).json).toMatchObject({ code: "industry_unavailable" });
  const company = await call("/companies", token, "POST", { name: "Andamios", rfc: "adn200101ab1", industry_id: "tecnologia" });
  expect(company).toMatchObject({ status: 201, json: { name: "Andamios", rfc: "ADN200101AB1", status: "active", location: null } });
  expect(await call("/me/company", token)).toMatchObject({ status: 200, json: { role: "owner", company: { id: company.json!.id } } });
  expect((await call("/companies", token, "POST", { name: "Otra", rfc: "OTR200101AB1", industry_id: "tecnologia" })).json).toMatchObject({ code: "already_exists" });
  const other = await tokenFor("otro@empresa.mx");
  await call("/v2/me/employer-account", other, "POST", { full_name: "Otro Dueño" });
  expect((await call("/companies", other, "POST", { name: "Copia", rfc: "ADN200101AB1", industry_id: "tecnologia" })).json).toMatchObject({ code: "already_exists" });
  expect((await call("/v2/me/session/start", token, "POST")).status).toBe(204);
});
