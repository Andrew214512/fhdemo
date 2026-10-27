// Starts a fee-balance top-up on Stripe's own checkout page. Card numbers are
// typed into Stripe, never into Worm, and Apple Pay / Google Pay / Link work
// there automatically. The balance is only credited later, by the signed
// Stripe webhook, never by this function or the browser.
import Stripe from "npm:stripe@16.12.0";
import { endpoint, HttpError, json, readJson } from "../_shared/http.ts";
import { adminClient, dbError, requireUser } from "../_shared/supabase.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

export const handler = endpoint(async (req) => {
  const { db, user } = await requireUser(req);
  const { amount } = await readJson<{ amount: number }>(req);

  const config = await db.rpc("app_config");
  dbError(config.error);
  const allowed: number[] = config.data.topupAmounts;
  if (!Number.isInteger(amount) || !allowed.includes(amount)) {
    throw new HttpError(400, "Choose one of the top-up amounts shown.");
  }

  // One Stripe customer per reader, so Stripe (not Worm) can offer their saved card next time.
  const admin = adminClient();
  const existing = await admin.rpc("stripe_customer_for", { p_user: user.id });
  dbError(existing.error);
  let customer: string | null = existing.data;
  if (!customer) {
    const created = await stripe.customers.create(
      { email: user.email ?? undefined, metadata: { worm_user_id: user.id } },
      { idempotencyKey: `worm-customer-${user.id}` },
    );
    const saved = await admin.rpc("set_stripe_customer", { p_user: user.id, p_customer: created.id });
    dbError(saved.error);
    const reread = await admin.rpc("stripe_customer_for", { p_user: user.id });
    dbError(reread.error);
    customer = reread.data ?? created.id;
  }

  const appUrl = Deno.env.get("APP_URL")!;
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customer!,
    client_reference_id: user.id,
    payment_method_types: ["card", "link"],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: amount,
        product_data: {
          name: "Worm fee balance",
          description: "Covers marketplace fees for book exchanges. Fees are only taken when a book arrives.",
        },
      },
    }],
    metadata: { kind: "topup", worm_user_id: user.id },
    payment_intent_data: { metadata: { kind: "topup", worm_user_id: user.id } },
    saved_payment_method_options: { payment_method_save: "enabled" },
    success_url: `${appUrl}?topup=success`,
    cancel_url: `${appUrl}?topup=cancelled`,
  });

  return json(req, { url: session.url });
});
