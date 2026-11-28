import "server-only";

export {
  PASSWORD_REQUIREMENTS,
  createCognitoClient,
  type CognitoClient,
  type CognitoClientOptions,
  type CognitoFailure,
  type CognitoFailureReason,
  type CognitoOkResult,
  type CognitoTokens,
  type PasswordRequirement,
  type RefreshResult,
  type SignInChallenge,
  type SignInResult,
  type SignUpResult,
} from "./client";
export { COGNITO_IDP_ENDPOINT_KEY, cognitoConfigFromEnv, resolveCognitoEndpoint, type CognitoClientConfig } from "./config";
export { computeSecretHash } from "./secret-hash";
