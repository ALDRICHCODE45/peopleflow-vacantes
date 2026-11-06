import "server-only";

import { recordSessionEvent } from "@/lib/audit/session";
import { serverEnv } from "@/lib/env/server";
import { validateAuthEnv } from "./env";
import { buildAuthOptions } from "./callbacks";
import { createDevelopmentRefreshObserver } from "./refresh-observer";

const SESSION_EVENT_TIMEOUT_MS = 2000;

// The refresh signal is wired only for NODE_ENV=development. In test,
// production, or when NODE_ENV is unset the factory returns undefined and the
// server emits no marker at all.
export const authOptions = buildAuthOptions(
  validateAuthEnv(process.env),
  createDevelopmentRefreshObserver(process.env),
  {
    onSignIn: (accessToken) => recordSessionEvent("start", accessToken, {
      fetchImpl: fetch, apiBaseUrl: serverEnv.apiBaseUrl, timeoutMs: SESSION_EVENT_TIMEOUT_MS,
    }),
  },
);
