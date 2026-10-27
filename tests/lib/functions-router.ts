// Test-only: serves every Worm edge function from one Deno process, routed by
// name, the way Supabase's edge runtime does in production.
import { handler as addBook } from "../../supabase/functions/add-book/handler.ts";
import { handler as addTracking } from "../../supabase/functions/add-tracking/handler.ts";
import { handler as createCheckout } from "../../supabase/functions/create-checkout/handler.ts";
import { handler as deleteAccount } from "../../supabase/functions/delete-account/handler.ts";
import { handler as stripeWebhook } from "../../supabase/functions/stripe-webhook/handler.ts";
import { handler as trackingWebhook } from "../../supabase/functions/tracking-webhook/handler.ts";

const routes: Record<string, (req: Request) => Promise<Response>> = {
  "add-book": addBook,
  "add-tracking": addTracking,
  "create-checkout": createCheckout,
  "delete-account": deleteAccount,
  "stripe-webhook": stripeWebhook,
  "tracking-webhook": trackingWebhook,
};

const port = Number(Deno.env.get("FUNCTIONS_PORT") ?? "54330");
Deno.serve({ port, onListen: () => console.log(`functions ready on ${port}`) }, (req) => {
  const name = new URL(req.url).pathname.split("/")[1];
  const route = routes[name];
  return route ? route(req) : new Response("Not found", { status: 404 });
});
