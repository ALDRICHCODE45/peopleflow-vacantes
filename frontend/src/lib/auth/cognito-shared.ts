import "server-only";
import { cognitoConfigFromEnv, createCognitoClient, type CognitoClient } from "./cognito";
import { createCognitoServiceErrorLogger } from "./service-log";

/** The value-free operator line for silent and unavailable Cognito outcomes (service-log.ts). */
export const cognitoServiceErrorLog = createCognitoServiceErrorLogger();

let client: CognitoClient | undefined;

/**
 * One server-only Cognito client per process for NextAuth (sign-in, refresh)
 * and the sign-up / verify-code actions. Built on first use: an endpoint or
 * secret misconfiguration then fails only those calls (as `unavailable`),
 * never the module that imports it.
 */
export function sharedCognitoClient(): CognitoClient {
  client ??= createCognitoClient({ ...cognitoConfigFromEnv(process.env), onServiceError: cognitoServiceErrorLog });
  return client;
}
