import type { RefreshError } from "./refresh";

declare module "next-auth" {
  interface Session {
    error?: RefreshError;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    idToken?: string;
    error?: RefreshError;
  }
}
