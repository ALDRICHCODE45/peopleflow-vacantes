import "server-only";

import { recordSessionEvent } from "@/lib/audit/session";
import { serverEnv } from "@/lib/env/server";
import { cognitoServiceErrorLog as onServiceError, sharedCognitoClient as cognito } from "./cognito-shared";
import { validateAuthEnv } from "./env";
import { buildAuthOptions } from "./callbacks";
import { createDevelopmentRefreshObserver } from "./refresh-observer";

const SESSION_EVENT_TIMEOUT_MS = 2000;

export const authEnv = validateAuthEnv(process.env);

// The Cognito client is built on first use (cognito-shared.ts): a Cognito
// endpoint misconfiguration then fails only the password sign-in/refresh (as
// `unavailable`), never the module or OAuth login.

// The refresh signal is wired only for NODE_ENV=development. In test,
// production, or when NODE_ENV is unset the factory returns undefined and the
// server emits no marker at all.
export const authOptions = buildAuthOptions(
  authEnv,
  createDevelopmentRefreshObserver(process.env),
  {
    onSignIn: (accessToken) => recordSessionEvent("start", accessToken, {
      fetchImpl: fetch, apiBaseUrl: serverEnv.apiBaseUrl, timeoutMs: SESSION_EVENT_TIMEOUT_MS,
    }),
  },
  { cognito, onServiceError },
);
