// Stripe calls this after a payment. The signature check proves the message
// really came from Stripe; credit_topup() is safe to run twice for the same
// Checkout Session, because Stripe retries webhooks.
import Stripe from "npm:stripe@16.12.0";
import { adminClient } from "../_shared/supabase.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

// Stripe's one-way ID for the card number. Used only to stop one card from
// unlocking welcome credits on many accounts. Best effort: a top-up still
// counts if Stripe can't be reached.
async function cardFingerprint(paymentIntent: string | null): Promise<string | null> {
  if (!paymentIntent) return null;
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntent, { expand: ["payment_method"] });
    const pm = pi.payment_method as Stripe.PaymentMethod | null;
    return pm?.card?.fingerprint ?? null;
  } catch (e) {
    console.warn("Couldn't read card fingerprint", e);
    return null;
  }
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Use POST.", { status: 405 });
  const signature = req.headers.get("Stripe-Signature");
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, signature ?? "", Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "", undefined, cryptoProvider,
    );
  } catch {
    return new Response("Signature check failed.", { status: 400 });
  }

  const admin = adminClient();
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.kind === "topup" && session.payment_status === "paid" && session.currency === "usd") {
      const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
      const { error } = await admin.rpc("credit_topup", {
        p_user: session.client_reference_id,
        p_cents: session.amount_total,
        p_session: session.id,
        p_payment_intent: intent,
        p_fingerprint: await cardFingerprint(intent),
      });
      // A non-2xx answer makes Stripe retry later, which is what we want if the database hiccupped.
      if (error) {
        console.error("credit_topup failed", error);
        return new Response("Couldn't record the top-up.", { status: 500 });
      }
    }
  } else if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const intent = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    if (intent) {
      const { error } = await admin.rpc("record_refund", { p_payment_intent: intent, p_refunded_total: charge.amount_refunded });
      if (error) {
        console.error("record_refund failed", error);
        return new Response("Couldn't record the refund.", { status: 500 });
      }
    }
  }
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
}
