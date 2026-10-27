// EasyPost calls this when a package's status changes. The HMAC signature
// proves the message came from EasyPost; only "delivered" changes anything.
import { adminClient } from "../_shared/supabase.ts";

const encoder = new TextEncoder();

async function validSignature(body: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get("EASYPOST_WEBHOOK_SECRET");
  if (!secret || !header) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret.normalize("NFKD")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  const expected = "hmac-sha256-hex=" + [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Use POST.", { status: 405 });
  const body = await req.text();
  if (!(await validSignature(body, req.headers.get("X-Hmac-Signature")))) {
    return new Response("Signature check failed.", { status: 401 });
  }
  let event: { description?: string; result?: { id?: string; status?: string } };
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Bad JSON.", { status: 400 });
  }
  if (event.description?.startsWith("tracker.") && event.result?.status === "delivered" && event.result.id) {
    const { error } = await adminClient().rpc("mark_delivered", { p_tracker: event.result.id });
    if (error) {
      console.error("mark_delivered failed", error);
      return new Response("Couldn't record the delivery.", { status: 500 });
    }
  }
  return new Response("ok", { status: 200 });
}
