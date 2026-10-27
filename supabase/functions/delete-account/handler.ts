// Deletes a reader's account: first the database clears their personal data
// (refusing if they're mid-exchange), then their photos and sign-in are removed.
import { endpoint, json } from "../_shared/http.ts";
import { adminClient, dbError, requireUser } from "../_shared/supabase.ts";

export const handler = endpoint(async (req) => {
  const { db, user } = await requireUser(req);

  const cleared = await db.rpc("delete_account");
  dbError(cleared.error);

  const admin = adminClient();
  const files = await admin.storage.from("avatars").list(user.id, { limit: 100 });
  if (files.data?.length) {
    await admin.storage.from("avatars").remove(files.data.map((f) => `${user.id}/${f.name}`));
  }
  const removed = await admin.auth.admin.deleteUser(user.id);
  if (removed.error) console.error("deleteUser failed", removed.error);

  return json(req, { ok: true });
});
