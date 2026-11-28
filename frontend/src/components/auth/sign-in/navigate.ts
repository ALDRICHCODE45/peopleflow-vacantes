/** Full navigation after sign-in, so every server component and SessionProvider reads the new session cookie. */
export function navigateTo(url: string): void {
  window.location.assign(url);
}
