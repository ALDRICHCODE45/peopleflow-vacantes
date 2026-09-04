import "server-only";

import { validateServerEnv } from "./validate";

export { DEFAULT_API_TIMEOUT_MS, validateServerEnv } from "./validate";

export const serverEnv = validateServerEnv(process.env);
