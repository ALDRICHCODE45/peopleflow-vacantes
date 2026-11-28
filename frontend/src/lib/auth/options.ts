import "server-only";

import { recordSessionEvent } from "@/lib/audit/session";
import { serverEnv } from "@/lib/env/server";
import { cognitoConfigFromEnv, createCognitoClient, type CognitoClient } from "./cognito";
import { validateAuthEnv } from "./env";
import { buildAuthOptions } from "./callbacks";
import { createDevelopmentRefreshObserver } from "./refresh-observer";
import { createCognitoServiceErrorLogger } from "./service-log";

const SESSION_EVENT_TIMEOUT_MS = 2000;

export const authEnv = validateAuthEnv(process.env);

const onServiceError = createCognitoServiceErrorLogger();
let cognitoClient: CognitoClient | undefined;

// Built on first use: a Cognito endpoint misconfiguration then fails only the
// password sign-in/refresh (as `unavailable`), never the module or OAuth login.
function cognito(): CognitoClient {
  cognitoClient ??= createCognitoClient({ ...cognitoConfigFromEnv(process.env), onServiceError });
  return cognitoClient;
}

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
