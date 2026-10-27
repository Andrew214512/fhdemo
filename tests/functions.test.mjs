// Wormy edge function tests. Runs the real function code in Deno against the
// local Supabase stand-in and the real test database. Stripe and EasyPost
// webhooks are sent with genuine signatures made from test secrets.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import Stripe from "stripe";
import { freshDatabase, pool, rpc } from "./lib/db.mjs";
import { startMock, ANON_KEY, SERVICE_KEY, userToken } from "./lib/mock-supabase.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DENO = process.env.DENO_BIN || "deno";
const MOCK_PORT = 54321, FN_PORT = 54330, CLAUDE_PORT = 54341;
const STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
const EASYPOST_SECRET = "easypost-test-secret";
const stripe = new Stripe("sk_test_dummy");

let db, mock, deno, claudeServer;
// A stand-in for the Claude API: records each request and answers with whatever `claude.reply` says.
const claude = { calls: [], reply: { status: 200, text: "" } };
function startClaude() {
  claudeServer = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      claude.calls.push({ path: req.url, headers: req.headers, body: JSON.parse(raw || "{}") });
      const { status, text } = claude.reply;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status === 200
        ? { id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }],
            stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 60, output_tokens: 40 } }
        : { type: "error", error: { type: "api_error", message: "busy" } }));
    });
  });
  return new Promise((resolve) => claudeServer.listen(CLAUDE_PORT, resolve));
}
const A = crypto.randomUUID(), B = crypto.randomUUID(), C = crypto.randomUUID();
const sql = (t, p) => db.query(t, p).then((r) => r.rows);
const rejects = (p, re) => assert.rejects(p, (e) => { assert.match(e.message, re); return true; });

async function call(name, body, token, raw = false) {
  const res = await fetch(`${mock.url}/functions/v1/${name}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* plain text */ }
  return { status: res.status, body: json ?? text };
}
function stripeEvent(type, object) {
  const payload = JSON.stringify({ id: "evt_" + crypto.randomUUID(), object: "event", type, data: { object }, api_version: "2024-06-20", created: Math.floor(Date.now() / 1000) });
  return { payload, header: stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_WEBHOOK_SECRET }) };
}
async function postStripe({ payload, header }) {
  const res = await fetch(`${mock.url}/functions/v1/stripe-webhook`, { method: "POST", headers: { "Stripe-Signature": header, "Content-Type": "application/json" }, body: payload });
  return res.status;
}
function easypostSig(body, secret = EASYPOST_SECRET) {
  return "hmac-sha256-hex=" + crypto.createHmac("sha256", secret.normalize("NFKD")).update(body).digest("hex");
}

before(async () => {
  db = pool(await freshDatabase("worm_fn_test"));
  for (const u of [A, B, C]) await sql("insert into auth.users (id, email) values ($1, $2)", [u, u.slice(0, 6) + "@example.com"]);
  mock = await startMock({ db, port: MOCK_PORT, functionsUrl: `http://localhost:${FN_PORT}` });
  await startClaude();
  deno = spawn(DENO, ["run", "--allow-net", "--allow-env", "--allow-read", path.join(here, "lib", "functions-router.ts")], {
    env: {
      ...process.env,
      SUPABASE_URL: mock.url, SUPABASE_ANON_KEY: ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET, EASYPOST_WEBHOOK_SECRET: EASYPOST_SECRET,
      APP_URL: mock.url + "/", APP_ORIGINS: mock.url, FUNCTIONS_PORT: String(FN_PORT),
      ANTHROPIC_API_KEY: "sk-ant-test", ANTHROPIC_BASE_URL: `http://localhost:${CLAUDE_PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  deno.stderr.on("data", (d) => process.env.DEBUG && process.stderr.write(d));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Deno functions didn't start")), 120000);
    deno.stdout.on("data", (d) => { if (String(d).includes("functions ready")) { clearTimeout(t); resolve(); } });
  });
  // Two readers with profiles, addresses and books.
  for (const [u, h] of [[A, "ann"], [B, "bo.reads"], [C, "cee"]]) {
    await rpc(db, u, "save_profile", { p_handle: h, p_display_name: h, p_city: "Austin", p_state: "TX", p_genres: [], p_avatar_path: null });
    await rpc(db, u, "save_address", { p_name: h, p_line1: "1 Main St", p_line2: null, p_city: "Austin", p_state: "TX", p_zip: "78701" });
  }
});

after(async () => {
  deno?.kill();
  mock?.close();
  claudeServer?.close();
  await db?.end();
});

test("functions refuse callers who aren't signed in", async () => {
  for (const name of ["create-checkout", "add-book", "add-tracking", "delete-account", "book-summary"]) {
    const r = await call(name, {}, null);
    assert.equal(r.status, 401, name);
  }
  const forged = (await call("add-book", { isbn: "9780441172719" }, userToken(A).slice(0, -4) + "AAAA")).status;
  assert.equal(forged, 401, "a tampered sign-in token is rejected");
});

test("create-checkout only accepts the configured top-up amounts", async () => {
  for (const amount of [1, 499, 100000, "500", null]) {
    const r = await call("create-checkout", { amount }, userToken(A));
    assert.equal(r.status, 400, `amount ${amount}`);
    assert.match(r.body.error, /top-up amounts/);
  }
});

test("add-book checks ISBNs, converts ISBN-10, and looks up new books", async () => {
  let r = await call("add-book", { isbn: "12345" }, userToken(A));
  assert.equal(r.status, 400);
  r = await call("add-book", { isbn: "9780441172718" }, userToken(A));
  assert.equal(r.status, 400, "bad check digit");
  await rpc(db, "service", "upsert_book", { p_isbn: "9780441172719", p_title: "Dune", p_author: "Frank Herbert", p_year: 1965, p_genre: "Sci-fi & Fantasy", p_cover_url: null, p_source: "test" });
  r = await call("add-book", { isbn: "0-441-17271-7" }, userToken(A));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.book.isbn, "9780441172719", "ISBN-10 converted to ISBN-13");
  // A real lookup (Google Books is reachable from this test machine).
  r = await call("add-book", { isbn: "9780593135204" }, userToken(A));
  // Without an API key Google often refuses (shared quota), so either outcome is acceptable,
  // as long as a refusal is reported as "busy" rather than "no such book".
  if (r.status === 200) {
    assert.match(r.body.book.title, /Project Hail Mary/i);
    assert.equal((await sql("select count(*)::int n from books where isbn = '9780593135204'"))[0].n, 1);
  } else {
    assert.equal(r.status, 503, JSON.stringify(r.body));
    assert.match(r.body.error, /busy/);
  }
  r = await call("add-book", { q: "x" }, userToken(A));
  assert.equal(r.status, 400);
  r = await call("add-book", { q: "piranesi clarke" }, userToken(A));
  assert.ok(r.status === 200 ? Array.isArray(r.body.results) : r.status === 503, JSON.stringify(r.body));
});

test("book-summary: Claude writes it once from the title and author, then everyone gets the saved copy", async () => {
  const isbn = "9780525657606";
  await rpc(db, "service", "upsert_book", { p_isbn: isbn, p_title: "Hamnet", p_author: "Maggie O'Farrell", p_year: 2020, p_genre: "Historical", p_cover_url: null, p_source: "test" });
  assert.equal((await call("book-summary", { isbn: "123" }, userToken(A))).status, 400);
  assert.equal((await call("book-summary", { isbn: "9780000000002" }, userToken(A))).status, 404);
  claude.reply = { status: 200, text: "A novel imagining Shakespeare's family in Stratford, centred on his wife Agnes and their children. Lyrical and intimate." };
  const before = claude.calls.length;
  const r = await call("book-summary", { isbn }, userToken(A));
  assert.equal(r.status, 200);
  assert.match(r.body.summary, /^A novel imagining Shakespeare's family/);
  assert.equal(claude.calls.length, before + 1);
  const sent = claude.calls.at(-1);
  assert.match(sent.path, /^\/v1\/messages/);
  assert.equal(sent.headers["x-api-key"], "sk-ant-test");
  assert.equal(sent.body.model, "claude-opus-5-5");
  assert.equal(sent.body.fallbacks, "default");
  assert.match(sent.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.match(sent.body.system, /own words/);
  assert.match(sent.body.system, /UNKNOWN/);
  assert.equal(sent.body.messages.length, 1);
  assert.equal(sent.body.messages[0].content, "Title: Hamnet\nAuthor: Maggie O'Farrell\nFirst published: 2020\nISBN: " + isbn, "only the title, author, year and ISBN are sent");
  // A second reader gets the saved summary; Claude isn't asked again.
  const again = await call("book-summary", { isbn }, userToken(B));
  assert.equal(again.body.summary, r.body.summary);
  assert.equal(claude.calls.length, before + 1);
});

test("book-summary: a book Claude doesn't know shows no summary and isn't asked about again soon", async () => {
  const isbn = "9780000000019";
  await rpc(db, "service", "upsert_book", { p_isbn: isbn, p_title: "Pamphlet", p_author: "Anonymous", p_year: null, p_genre: null, p_cover_url: null, p_source: "test" });
  claude.reply = { status: 200, text: "UNKNOWN" };
  const before = claude.calls.length;
  assert.equal((await call("book-summary", { isbn }, userToken(A))).body.summary, null);
  assert.equal((await call("book-summary", { isbn }, userToken(A))).body.summary, null);
  assert.equal(claude.calls.length, before + 1);
  const row = (await sql("select summary, summary_at from books where isbn = $1", [isbn]))[0];
  assert.equal(row.summary, null);
  assert.ok(row.summary_at, "the 'don't know' answer is remembered");
});

test("book-summary: when Claude is unavailable nothing is saved, and the next visit tries again", async () => {
  const isbn = "9780000000026";
  await rpc(db, "service", "upsert_book", { p_isbn: isbn, p_title: "Dune Messiah", p_author: "Frank Herbert", p_year: 1969, p_genre: null, p_cover_url: null, p_source: "test" });
  claude.reply = { status: 500, text: "" };
  const r = await call("book-summary", { isbn }, userToken(A));
  assert.equal(r.status, 200);
  assert.equal(r.body.summary, null);
  assert.equal((await sql("select summary_at from books where isbn = $1", [isbn]))[0].summary_at, null);
  claude.reply = { status: 200, text: "The second Dune novel follows Paul Atreides years into his rule, as conspiracies gather around his empire." };
  assert.match((await call("book-summary", { isbn }, userToken(A))).body.summary, /Paul Atreides/);
});

test("stripe-webhook rejects unsigned or tampered events", async () => {
  const session = { id: "cs_test_forged", object: "checkout.session", currency: "usd", payment_status: "paid", amount_total: 2000, client_reference_id: A, payment_intent: null, metadata: { kind: "topup" } };
  const ev = stripeEvent("checkout.session.completed", session);
  const bad = await fetch(`${mock.url}/functions/v1/stripe-webhook`, { method: "POST", body: ev.payload });
  assert.equal(bad.status, 400);
  const tampered = await postStripe({ payload: ev.payload.replace("2000", "100000"), header: ev.header });
  assert.equal(tampered, 400);
  const wrongSecret = stripe.webhooks.generateTestHeaderString({ payload: ev.payload, secret: "whsec_attacker" });
  assert.equal(await postStripe({ payload: ev.payload, header: wrongSecret }), 400);
  assert.equal((await sql("select count(*)::int n from payments where user_id = $1", [A]))[0].n, 0);
});

test("a paid Checkout Session credits the fee balance exactly once", async () => {
  const session = { id: "cs_test_1", object: "checkout.session", currency: "usd", payment_status: "paid", amount_total: 500, client_reference_id: A, payment_intent: null, metadata: { kind: "topup" } };
  assert.equal(await postStripe(stripeEvent("checkout.session.completed", session)), 200);
  assert.equal(await postStripe(stripeEvent("checkout.session.completed", session)), 200, "Stripe retries are fine");
  const rows = await sql("select amount_cents from payments where user_id = $1 and kind = 'topup'", [A]);
  assert.deepEqual(rows.map((r) => r.amount_cents), [500]);
  const unpaid = { ...session, id: "cs_test_unpaid", payment_status: "unpaid" };
  assert.equal(await postStripe(stripeEvent("checkout.session.completed", unpaid)), 200);
  const other = { ...session, id: "cs_test_other", metadata: { kind: "something-else" } };
  assert.equal(await postStripe(stripeEvent("checkout.session.completed", other)), 200);
  const euros = { ...session, id: "cs_test_eur", currency: "eur" };
  assert.equal(await postStripe(stripeEvent("checkout.session.completed", euros)), 200, "other currencies are ignored");
  const odd = { ...session, id: "cs_test_odd", amount_total: 777 };
  assert.equal(await postStripe(stripeEvent("checkout.session.completed", odd)), 500, "unexpected amounts aren't credited");
  assert.equal((await sql("select count(*)::int n from payments where user_id = $1", [A]))[0].n, 1);
});

test("refund events reduce the balance", async () => {
  await rpc(db, "service", "credit_topup", { p_user: B, p_cents: 1000, p_session: "cs_test_b", p_payment_intent: "pi_test_b", p_fingerprint: null });
  const charge = { id: "ch_1", object: "charge", payment_intent: "pi_test_b", amount_refunded: 1000 };
  assert.equal(await postStripe(stripeEvent("charge.refunded", charge)), 200);
  assert.equal(await postStripe(stripeEvent("charge.refunded", charge)), 200);
  const refunds = await sql("select amount_cents from payments where user_id = $1 and kind = 'refund'", [B]);
  assert.deepEqual(refunds.map((r) => r.amount_cents), [1000]);
});

test("add-tracking: only the sender, only valid numbers; tracking-webhook needs EasyPost's signature", async () => {
  // A lists 3 books and has a top-up, so A gets a welcome credit; B lists and tops up too.
  for (const isbn of ["9780441172719"]) {
    for (const u of [A, B]) for (let i = 0; i < 3; i++) await rpc(db, u, "add_copy", { p_isbn: isbn, p_condition: "vg", p_format: "Paperback" });
  }
  await rpc(db, "service", "credit_topup", { p_user: B, p_cents: 500, p_session: "cs_test_b2", p_payment_intent: null, p_fingerprint: "fp_b" });
  const listing = (await sql("select l.id from listings l join copies c on c.id = l.copy_id where c.owner_id = $1 and l.closed_at is null limit 1", [A]))[0].id;
  const req = await rpc(db, B, "request_book", { p_listing: listing });
  await rpc(db, A, "accept_request", { p_req: req });

  let r = await call("add-tracking", { request_id: req, carrier: "USPS", tracking: "9400 1118 9922 3456 7781 20" }, userToken(B));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /couldn't find that exchange/);
  r = await call("add-tracking", { request_id: req, carrier: "USPS", tracking: "123" }, userToken(A));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /doesn't look like a USPS tracking number/);
  r = await call("add-tracking", { request_id: req, carrier: "USPS", tracking: "9400 1118 9922 3456 7781 20" }, userToken(A));
  assert.equal(r.status, 200);
  assert.equal(r.body.tracked, false, "no EasyPost key in tests, so no tracker");

  await rpc(db, "service", "set_tracker", { p_req: req, p_tracker: "trk_123" });
  const body = JSON.stringify({ description: "tracker.updated", result: { id: "trk_123", status: "delivered" } });
  let res = await fetch(`${mock.url}/functions/v1/tracking-webhook`, { method: "POST", body, headers: { "X-Hmac-Signature": easypostSig(body, "wrong") } });
  assert.equal(res.status, 401);
  res = await fetch(`${mock.url}/functions/v1/tracking-webhook`, { method: "POST", body });
  assert.equal(res.status, 401);
  assert.equal((await sql("select status from exchanges where request_id = $1", [req]))[0].status, "shipped");
  res = await fetch(`${mock.url}/functions/v1/tracking-webhook`, { method: "POST", body, headers: { "X-Hmac-Signature": easypostSig(body) } });
  assert.equal(res.status, 200);
  assert.equal((await sql("select status from exchanges where request_id = $1", [req]))[0].status, "delivered");
});

test("database errors meant for readers pass through; internal ones don't leak", async () => {
  const r = await call("add-tracking", { request_id: "not-a-uuid", carrier: "USPS", tracking: "9400111899223456778120" }, userToken(A));
  assert.equal(r.status, 500);
  assert.doesNotMatch(r.body.error, /uuid|syntax/i);
});

test("rate limits stop one reader from hammering a function", async () => {
  await sql(`update settings set value = jsonb_set(value, '{add-book,max}', '3') where key = 'rate_limits'`);
  await sql("delete from rate_hits");
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await call("add-book", { isbn: "9780441172719" }, userToken(B))).status);
  assert.deepEqual(statuses, [200, 200, 200, 429]);
  assert.equal((await call("add-book", { isbn: "9780441172719" }, userToken(A))).status, 200, "other readers aren't affected");
  await rejects(rpc(db, A, "rate_limit", { p_user: A, p_bucket: "add-book" }), /permission denied/);
  await sql(`update settings set value = jsonb_set(value, '{add-book,max}', '200') where key = 'rate_limits'`);
});

test("delete-account waits for open exchanges, then removes the sign-in", async () => {
  let r = await call("delete-account", {}, userToken(A));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Finish your open exchanges/);
  r = await call("delete-account", {}, userToken(C));
  assert.equal(r.status, 200);
  assert.equal((await sql("select count(*)::int n from auth.users where id = $1", [C]))[0].n, 0);
  assert.equal((await sql("select display_name from profiles where id = $1", [C]))[0].display_name, "Deleted reader");
  r = await call("add-book", { isbn: "9780441172719" }, userToken(C));
  assert.equal(r.status, 401, "a deleted reader's old token no longer works");
});
