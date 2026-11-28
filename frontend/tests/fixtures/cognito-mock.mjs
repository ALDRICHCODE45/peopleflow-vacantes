// In-memory mock of the Cognito user pools API (awsJson1_1) for the embedded auth e2e.
// Test-only: loopback, deterministic rules, no persistence, never logs passwords, codes or tokens.
// Implements InitiateAuth (USER_PASSWORD_AUTH, REFRESH_TOKEN_AUTH), SignUp, ConfirmSignUp,
// ResendConfirmationCode, ForgotPassword, ConfirmForgotPassword and the backend's GetUser
// (docs/contracts/embedded-auth-v1.md §e2e in the backend repo). See README.md «Mock Cognito».
import { createServer } from "node:http";
import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  generateKeyPairSync,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TARGET_PREFIX = "AWSCognitoIdentityProviderService.";
const OPERATIONS = new Set([
  "InitiateAuth",
  "SignUp",
  "ConfirmSignUp",
  "ResendConfirmationCode",
  "ForgotPassword",
  "ConfirmForgotPassword",
  "GetUser",
]);
const MAX_BODY_BYTES = 64 * 1024;
const TOKEN_TTL_SECONDS = 3600;
const MAX_CODE_FAILURES = 5;
const FAULT_NAME = /^(?:[A-Z][A-Za-z]*Exception|ServiceUnavailable)$/;

export const COGNITO_MOCK_DEFAULTS = Object.freeze({
  clientId: "peopleflow-e2e",
  clientSecret: "peopleflow-e2e-secret",
  issuer: "https://e2e.peopleflow.test/identity",
  audience: "peopleflow-e2e",
});

class CognitoError extends Error {
  constructor(name, message) {
    super(message);
    this.errorName = name;
  }
}
const fail = (name, message) => {
  throw new CognitoError(name, message);
};

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new CognitoError("SerializationException", "mock: body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function parseObject(text) {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const base64url = (value) => Buffer.from(value).toString("base64url");

function meetsPolicy(password) {
  return (
    typeof password === "string" &&
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

function maskEmail(email) {
  const [local = "", domain = ""] = String(email).split("@");
  return `${local.slice(0, 1)}***@${domain.slice(0, 1)}***`;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Creates the mock. `privateKeyPem` is optional: without it an ephemeral RSA-2048
 * pair is generated, so no private key is ever committed. Only the SPKI public key
 * is exposed (GET /__cognito/public-key).
 */
export function createCognitoMock(options = {}) {
  const given = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
  const config = { ...COGNITO_MOCK_DEFAULTS, ...given };
  const privateKey = config.privateKeyPem
    ? createPrivateKey(config.privateKeyPem)
    : generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const publicKey = createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const now = config.now ?? (() => Date.now());

  let users = new Map(); // exact username → user
  let refreshTokens = new Map(); // token → sub
  let faults = new Map(); // operation → error name (one-shot)

  const secretHash = (username) =>
    createHmac("sha256", config.clientSecret).update(String(username) + config.clientId).digest("base64");
  const userBySub = (sub) => [...users.values()].find((user) => user.sub === sub);
  // Exact usernames: no trimming or case folding, so a client that forgets to normalize fails loudly.
  const findUser = (username) => (typeof username === "string" ? users.get(username) : undefined);

  function sign(payload) {
    const header = { alg: "RS256", typ: "JWT", kid: "e2e" };
    const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
    const signer = createSign("RSA-SHA256");
    signer.update(input);
    return `${input}.${signer.sign(privateKey).toString("base64url")}`;
  }

  function issueTokens(user, { withRefresh }) {
    const iat = Math.floor(now() / 1000);
    const exp = iat + TOKEN_TTL_SECONDS;
    const accessToken = sign({
      iss: config.issuer,
      aud: config.audience,
      sub: user.sub,
      iat,
      exp,
      token_use: "access",
      client_id: config.clientId,
      username: user.sub,
      scope: "aws.cognito.signin.user.admin",
    });
    const idToken = sign({
      iss: config.issuer,
      aud: config.clientId,
      sub: user.sub,
      iat,
      exp,
      token_use: "id",
      email: user.email,
      email_verified: user.emailVerified,
      ...(user.name ? { name: user.name } : {}),
    });
    const result = { AccessToken: accessToken, ExpiresIn: TOKEN_TTL_SECONDS, IdToken: idToken, TokenType: "Bearer" };
    if (withRefresh) {
      const refreshToken = randomBytes(32).toString("base64url");
      refreshTokens.set(refreshToken, user.sub);
      result.RefreshToken = refreshToken;
    }
    return { AuthenticationResult: result, ChallengeParameters: {} };
  }

  function verifyAccessToken(token) {
    if (typeof token !== "string") return undefined;
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    try {
      const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
      if (header.alg !== "RS256") return undefined;
      const verifier = createVerify("RSA-SHA256");
      verifier.update(`${parts[0]}.${parts[1]}`);
      if (!verifier.verify(publicKey, Buffer.from(parts[2], "base64url"))) return undefined;
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      if (payload.token_use !== "access" || payload.iss !== config.issuer) return undefined;
      if (typeof payload.exp !== "number" || payload.exp * 1000 <= now()) return undefined;
      return payload;
    } catch {
      return undefined;
    }
  }

  function issueCode(user, kind) {
    user.codes[kind] = { value: String(randomInt(0, 1_000_000)).padStart(6, "0"), expired: false, failures: 0 };
  }

  function useCode(user, kind, code) {
    const entry = user.codes[kind];
    if (!entry) fail("CodeMismatchException", "Invalid verification code provided, please try again.");
    if (entry.failures >= MAX_CODE_FAILURES) fail("TooManyFailedAttemptsException", "Too many failed attempts.");
    if (!safeEqual(entry.value, code)) {
      entry.failures += 1;
      fail("CodeMismatchException", "Invalid verification code provided, please try again.");
    }
    if (entry.expired) fail("ExpiredCodeException", "Invalid code provided, please request a code again.");
    delete user.codes[kind];
  }

  const delivery = (email) => ({
    CodeDeliveryDetails: { Destination: maskEmail(email), DeliveryMedium: "EMAIL", AttributeName: "email" },
  });

  function requireClient(body) {
    if (body.ClientId !== config.clientId) fail("ResourceNotFoundException", "User pool client does not exist.");
  }
  function requireSecretHash(given, username) {
    if (typeof given !== "string" || !safeEqual(given, secretHash(username)))
      fail("NotAuthorizedException", "Unable to verify secret hash for client.");
  }
  function requireUsername(body) {
    if (typeof body.Username !== "string" || body.Username.trim() === "")
      fail("InvalidParameterException", "Username is required.");
    requireSecretHash(body.SecretHash, body.Username);
    return body.Username;
  }

  const operations = {
    InitiateAuth(body) {
      requireClient(body);
      const params = body.AuthParameters !== null && typeof body.AuthParameters === "object" ? body.AuthParameters : {};
      if (body.AuthFlow === "USER_PASSWORD_AUTH") {
        requireSecretHash(params.SECRET_HASH, params.USERNAME);
        const user = findUser(params.USERNAME);
        if (!user || !safeEqual(user.password, params.PASSWORD ?? ""))
          fail("NotAuthorizedException", "Incorrect username or password.");
        if (!user.confirmed) fail("UserNotConfirmedException", "User is not confirmed.");
        return issueTokens(user, { withRefresh: true });
      }
      if (body.AuthFlow === "REFRESH_TOKEN_AUTH") {
        const sub = typeof params.REFRESH_TOKEN === "string" ? refreshTokens.get(params.REFRESH_TOKEN) : undefined;
        const user = sub === undefined ? undefined : userBySub(sub);
        if (!user) fail("NotAuthorizedException", "Invalid Refresh Token");
        requireSecretHash(params.SECRET_HASH, user.sub);
        return issueTokens(user, { withRefresh: false });
      }
      fail("InvalidParameterException", "mock: unsupported AuthFlow");
    },

    SignUp(body) {
      requireClient(body);
      const username = requireUsername(body);
      if (!meetsPolicy(body.Password))
        fail("InvalidPasswordException", "Password did not conform with policy: Password not long enough");
      if (findUser(username)) fail("UsernameExistsException", "An account with the given email already exists.");
      const attributes = Array.isArray(body.UserAttributes) ? body.UserAttributes : [];
      const name = attributes.find((attribute) => attribute?.Name === "name")?.Value;
      // The real pool requires the `name` attribute (L20); Cognito answers this exact schema error.
      if (typeof name !== "string" || name.trim() === "")
        fail("InvalidParameterException", "Attributes did not conform to the schema: name: The attribute is required");
      const user = {
        sub: randomUUID(),
        email: username,
        password: body.Password,
        name,
        confirmed: false,
        emailVerified: false,
        codes: {},
      };
      users.set(user.email, user);
      issueCode(user, "confirmation");
      return { UserConfirmed: false, UserSub: user.sub, ...delivery(user.email) };
    },

    ConfirmSignUp(body) {
      requireClient(body);
      const user = findUser(requireUsername(body));
      if (!user) fail("CodeMismatchException", "Invalid verification code provided, please try again.");
      if (user.confirmed) fail("NotAuthorizedException", "User cannot be confirmed. Current status is CONFIRMED");
      useCode(user, "confirmation", body.ConfirmationCode);
      user.confirmed = true;
      user.emailVerified = true;
      return {};
    },

    ResendConfirmationCode(body) {
      requireClient(body);
      const username = requireUsername(body);
      const user = findUser(username);
      if (!user) return delivery(username);
      if (user.confirmed) fail("InvalidParameterException", "User is already confirmed.");
      issueCode(user, "confirmation");
      return delivery(user.email);
    },

    ForgotPassword(body) {
      requireClient(body);
      const username = requireUsername(body);
      const user = findUser(username);
      if (user) issueCode(user, "reset");
      return delivery(username);
    },

    ConfirmForgotPassword(body) {
      requireClient(body);
      const user = findUser(requireUsername(body));
      if (!user) fail("CodeMismatchException", "Invalid verification code provided, please try again.");
      if (!meetsPolicy(body.Password))
        fail("InvalidPasswordException", "Password did not conform with policy: Password not long enough");
      useCode(user, "reset", body.ConfirmationCode);
      user.password = body.Password;
      return {};
    },

    // Contract §GetUser stub: success / unverified email / NotAuthorizedException.
    // Always 200 for success and email_verified always carries a Value (L12).
    GetUser(body) {
      if (Object.keys(body).length !== 1 || typeof body.AccessToken !== "string")
        fail("SerializationException", "stub: unexpected request");
      const claims = verifyAccessToken(body.AccessToken);
      const user = claims && userBySub(claims.sub);
      if (!user) fail("NotAuthorizedException", "Invalid Access Token");
      return {
        Username: user.sub,
        UserAttributes: [
          { Name: "sub", Value: user.sub },
          { Name: "email_verified", Value: user.emailVerified ? "true" : "false" },
          { Name: "email", Value: user.email },
        ],
      };
    },
  };

  function sendJson(response, status, body, headers = {}) {
    response.writeHead(status, { "content-type": "application/x-amz-json-1.1", "cache-control": "no-store", ...headers });
    response.end(JSON.stringify(body));
  }
  function sendError(response, error) {
    const status = error.errorName === "InternalErrorException" || error.errorName === "ServiceUnavailable" ? 500 : 400;
    sendJson(response, status, { __type: error.errorName, message: error.message }, { "x-amzn-ErrorType": error.errorName });
  }
  function sendControl(response, status, body) {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
  }

  function reset() {
    users = new Map();
    refreshTokens = new Map();
    faults = new Map();
  }

  async function handleControl(request, response, url) {
    const path = url.pathname.slice("/__cognito".length);
    if (request.method === "GET" && path === "/public-key") {
      response.writeHead(200, { "content-type": "application/x-pem-file", "cache-control": "no-store" });
      response.end(publicKeyPem);
      return;
    }
    if (request.method === "GET" && path === "/codes") {
      const email = url.searchParams.get("email");
      if (!email) return sendControl(response, 400, { error: "email is required" });
      const user = findUser(email);
      return sendControl(response, 200, {
        confirmation: user?.codes.confirmation?.value ?? null,
        reset: user?.codes.reset?.value ?? null,
      });
    }
    if (request.method !== "POST") return sendControl(response, 404, { error: "not found" });
    if (path === "/reset") {
      reset();
      return sendControl(response, 200, { ok: true });
    }
    const body = parseObject(await readBody(request));
    if (!body) return sendControl(response, 400, { error: "JSON object body required" });
    if (path === "/users") {
      if (typeof body.email !== "string" || body.email.trim() === "" || typeof body.password !== "string" || body.password === "")
        return sendControl(response, 400, { error: "email and password are required" });
      if (findUser(body.email)) return sendControl(response, 409, { error: "user exists" });
      const user = {
        sub: typeof body.sub === "string" && body.sub !== "" ? body.sub : randomUUID(),
        email: body.email,
        password: body.password,
        name: typeof body.name === "string" ? body.name : undefined,
        confirmed: body.confirmed !== false,
        emailVerified: body.emailVerified !== false,
        codes: {},
      };
      if (userBySub(user.sub)) return sendControl(response, 409, { error: "sub exists" });
      users.set(user.email, user);
      return sendControl(response, 201, { sub: user.sub });
    }
    if (path === "/expire-code") {
      const entry = findUser(body.email)?.codes[body.kind];
      if (!entry) return sendControl(response, 404, { error: "no such code" });
      entry.expired = true;
      return sendControl(response, 200, { ok: true });
    }
    if (path === "/fault") {
      if (!OPERATIONS.has(body.operation) || typeof body.error !== "string" || !FAULT_NAME.test(body.error))
        return sendControl(response, 400, { error: "operation and error name required" });
      faults.set(body.operation, body.error);
      return sendControl(response, 200, { ok: true });
    }
    return sendControl(response, 404, { error: "not found" });
  }

  async function handle(request, response) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (url.pathname.startsWith("/__cognito/")) return await handleControl(request, response, url);

      const target = String(request.headers["x-amz-target"] ?? "");
      const operation = target.startsWith(TARGET_PREFIX) ? target.slice(TARGET_PREFIX.length) : "";
      if (
        request.method !== "POST" ||
        url.pathname !== "/" ||
        url.search !== "" ||
        request.headers["content-type"] !== "application/x-amz-json-1.1" ||
        request.headers.authorization !== undefined ||
        !OPERATIONS.has(operation)
      ) {
        request.resume();
        fail("SerializationException", "stub: unexpected request");
      }
      const body = parseObject(await readBody(request));
      if (!body) fail("SerializationException", "stub: unexpected request");
      const fault = faults.get(operation);
      if (fault) {
        faults.delete(operation);
        fail(fault, "mock: injected fault");
      }
      sendJson(response, 200, operations[operation](body));
    } catch (error) {
      if (response.headersSent) return;
      if (error instanceof CognitoError) sendError(response, error);
      else sendError(response, new CognitoError("InternalErrorException", "mock: internal error"));
    }
  }

  return { handle, reset, publicKeyPem, config: { clientId: config.clientId, issuer: config.issuer, audience: config.audience } };
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const env = process.env;
  const keyFile = env.COGNITO_MOCK_PRIVATE_KEY_FILE;
  const mock = createCognitoMock({
    clientId: env.COGNITO_MOCK_CLIENT_ID || undefined,
    clientSecret: env.COGNITO_MOCK_CLIENT_SECRET || undefined,
    issuer: env.COGNITO_MOCK_ISSUER || undefined,
    audience: env.COGNITO_MOCK_AUDIENCE || undefined,
    privateKeyPem: keyFile ? readFileSync(keyFile, "utf8") : undefined,
  });
  const port = Number(env.COGNITO_MOCK_PORT ?? 4599);
  const server = createServer((request, response) => void mock.handle(request, response));
  server.listen(port, "127.0.0.1", () => {
    console.log(`cognito mock listening on ${server.address().port}`);
  });
}
