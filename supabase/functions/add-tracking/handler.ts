// The sender adds their tracking number. The database checks they're the
// sender, the format fits the carrier, and the number isn't already used.
// Then, if a tracking service is set up, we subscribe to delivery updates.
import { endpoint, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, dbError, rateLimit, requireUser } from "../_shared/supabase.ts";

export const handler = endpoint(async (req) => {
  const { db, user } = await requireUser(req);
  await rateLimit(user.id, "tracking");
  const { request_id, carrier, tracking } = await readJson<{ request_id: string; carrier: string; tracking: string }>(req);
  if (!request_id || !carrier || !tracking) throw new HttpError(400, "Add the carrier and tracking number.");

  const shipped = await db.rpc("ship_exchange", { p_req: request_id, p_carrier: carrier, p_tracking: tracking });
  dbError(shipped.error);

  const key = Deno.env.get("EASYPOST_API_KEY");
  let tracked = false;
  if (key) {
    try {
      const res = await fetch("https://api.easypost.com/v2/trackers", {
        method: "POST",
        headers: { Authorization: "Basic " + btoa(key + ":"), "Content-Type": "application/json" },
        body: JSON.stringify({ tracker: { tracking_code: tracking.replace(/[^A-Za-z0-9]/g, "").toUpperCase(), carrier } }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const tracker = await res.json();
        const saved = await adminClient().rpc("set_tracker", { p_req: request_id, p_tracker: tracker.id });
        tracked = !saved.error;
      } else {
        console.warn("EasyPost tracker failed", res.status, await res.text());
      }
    } catch (e) {
      // Shipping still counts. The recipient can confirm by hand when it arrives.
      console.warn("EasyPost unreachable", e);
    }
  }
  return json(req, { ok: true, tracked });
});
