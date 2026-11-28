import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

// Local e2e stack (A4.7, tests/fixtures/README.md «E2e stack»). Without
// PLAYWRIGHT_APP_ORIGIN, Playwright starts (or reuses, when already listening)
// the mock Cognito on :4599, the fixture API on :4010 and Next on :3100 with
// NODE_ENV=test, so the Cognito endpoint override is accepted (it is refused in
// production). Setting PLAYWRIGHT_APP_ORIGIN keeps the old behaviour: an app
// server started by hand, nothing started here. Every value below is a
// test-only fixture value, never a real credential.
const APP_ORIGIN = process.env.PLAYWRIGHT_APP_ORIGIN;
const COGNITO_MOCK_ORIGIN = "http://127.0.0.1:4599";
const FIXTURE_API_ORIGIN = "http://127.0.0.1:4010";
const E2E_APP_ORIGIN = "http://127.0.0.1:3100";
const reuseExistingServer = !process.env.CI;

const e2eStack: NonNullable<PlaywrightTestConfig["webServer"]> = [
  {
    command: "node tests/fixtures/cognito-mock.mjs",
    url: `${COGNITO_MOCK_ORIGIN}/__cognito/public-key`,
    env: { COGNITO_MOCK_PORT: "4599" },
    reuseExistingServer,
    timeout: 30_000,
  },
  {
    command: "node tests/fixtures/jobs-server.mjs",
    url: `${FIXTURE_API_ORIGIN}/__health`,
    env: { JOBS_FIXTURE_PORT: "4010", COGNITO_MOCK_ORIGIN },
    reuseExistingServer,
    timeout: 60_000,
  },
  {
    command: "pnpm exec next dev --hostname 127.0.0.1 --port 3100",
    url: `${E2E_APP_ORIGIN}/empresa/login`,
    env: {
      // With NODE_ENV=test Next loads `.env` but not `.env.local`; every key the
      // auth flows read is pinned here so a local file cannot change the stack.
      NODE_ENV: "test",
      PEOPLEFLOW_API_BASE_URL: FIXTURE_API_ORIGIN,
      PEOPLEFLOW_SITE_URL: E2E_APP_ORIGIN,
      PEOPLEFLOW_LOCAL_PREVIEW: "false",
      PEOPLEFLOW_LOCAL_BOOTSTRAP_ENABLED: "false",
      PEOPLEFLOW_SAMPLE_JOBS: "false",
      NEXTAUTH_URL: E2E_APP_ORIGIN,
      NEXTAUTH_SECRET: "peopleflow-e2e-nextauth-secret-not-a-real-secret",
      COGNITO_CLIENT_ID: "peopleflow-e2e",
      COGNITO_CLIENT_SECRET: "peopleflow-e2e-secret",
      COGNITO_ISSUER: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_e2emock",
      COGNITO_DOMAIN: "https://peopleflow-e2e.auth.us-east-1.amazoncognito.com",
      COGNITO_IDP_ENDPOINT: COGNITO_MOCK_ORIGIN,
      AUTH_SOCIAL_GOOGLE: "off",
      AUTH_SOCIAL_MICROSOFT: "off",
      AUTH_SOCIAL_LINKEDIN: "off",
    },
    reuseExistingServer,
    // First compile of the login route in dev mode.
    timeout: 240_000,
  },
];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: APP_ORIGIN ?? E2E_APP_ORIGIN,
    trace: "on-first-retry",
  },
  webServer: APP_ORIGIN ? undefined : e2eStack,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
