import "server-only";

import { validateAuthEnv } from "./env";
import { buildAuthOptions } from "./callbacks";
import { createDevelopmentRefreshObserver } from "./refresh-observer";

// The refresh signal is wired only for NODE_ENV=development. In test,
// production, or when NODE_ENV is unset the factory returns undefined and the
// server emits no marker at all.
export const authOptions = buildAuthOptions(
  validateAuthEnv(process.env),
  createDevelopmentRefreshObserver(process.env),
);
