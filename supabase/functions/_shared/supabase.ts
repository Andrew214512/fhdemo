import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { HttpError } from "./http.ts";

const url = () => Deno.env.get("SUPABASE_URL")!;
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

// Full access. Only for server-only database functions (credit a top-up, mark delivered, ...).
export function adminClient(): SupabaseClient {
  return createClient(url(), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, noSession);
}

// Acts as the signed-in reader, so the database's own permission checks apply.
export async function requireUser(req: Request) {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Please sign in.");
  const db = createClient(url(), Deno.env.get("SUPABASE_ANON_KEY")!, {
    ...noSession,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Please sign in.");
  return { db, user: data.user };
}

// Stops one reader from hammering a function (limits live in settings.rate_limits).
export async function rateLimit(userId: string, bucket: "add-book" | "checkout" | "tracking") {
  const { data, error } = await adminClient().rpc("rate_limit", { p_user: userId, p_bucket: bucket });
  dbError(error);
  if (!data) throw new HttpError(429, "That's a lot in a short time. Try again in a few minutes.");
}

// Errors Wormy's database raises on purpose (SQLSTATE P0001) are written for
// readers, so pass them through. Anything else stays generic.
export function dbError(error: { message: string; code?: string } | null): void {
  if (!error) return;
  if (error.code === "P0001") throw new HttpError(400, error.message);
  console.error(error);
  throw new HttpError(500, "Something went wrong on our side. Try again in a minute.");
}
