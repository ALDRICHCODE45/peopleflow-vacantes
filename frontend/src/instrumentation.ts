export async function register() {
  // Audit forwarding wraps the Node server fetch; the edge middleware never calls the API.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installAuditForwarding } = await import("@/lib/audit/install");
  await installAuditForwarding();
}
