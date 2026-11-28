import type { RefreshError, SessionKind } from "./refresh";

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
    /** How the session was established; absent on cookies issued before A4.2 (= OAuth). */
    authKind?: SessionKind;
    error?: RefreshError;
  }
}
