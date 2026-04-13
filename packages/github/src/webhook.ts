import { createHmac, timingSafeEqual } from "node:crypto";

export function validateWebhookSignature(
  body: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const expectedBuffer = Buffer.from(`sha256=${expected}`, "utf8");
  const receivedBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== receivedBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function parseWebhookEvent(
  headers: Record<string, string>,
  body: Record<string, unknown>,
): { event: string; action: string; payload: Record<string, unknown> } {
  const event =
    headers["x-github-event"] ?? headers["X-GitHub-Event"] ?? "unknown";
  const action = (body.action as string) ?? "";

  return { event, action, payload: body };
}
