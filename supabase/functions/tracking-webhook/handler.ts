// EasyPost calls this whenever the carrier scans a package. The HMAC signature proves the
// message came from EasyPost. Each update is saved on the exchange (status, latest scan, where,
// expected date) so both readers can follow the book; "delivered" starts the confirm window.
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
  let event: {
    description?: string;
    result?: {
      id?: string;
      status?: string;
      est_delivery_date?: string | null;
      tracking_details?: { message?: string; tracking_location?: { city?: string | null; state?: string | null } }[];
    };
  };
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Bad JSON.", { status: 400 });
  }
  const t = event.result;
  if (event.description?.startsWith("tracker.") && t?.id) {
    const latest = t.tracking_details?.at(-1);
    const where = [latest?.tracking_location?.city, latest?.tracking_location?.state].filter(Boolean).join(", ");
    const eta = t.est_delivery_date && !Number.isNaN(Date.parse(t.est_delivery_date)) ? t.est_delivery_date : null;
    const { error } = await adminClient().rpc("set_tracking_status", {
      p_tracker: t.id, p_status: t.status ?? "unknown", p_detail: latest?.message ?? null, p_where: where || null, p_eta: eta,
    });
    if (error) {
      console.error("set_tracking_status failed", error);
      return new Response("Couldn't record the update.", { status: 500 });
    }
  }
  return new Response("ok", { status: 200 });
}
