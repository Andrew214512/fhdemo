// Wormy end-to-end test: a real browser runs the real app in live mode against the
// local Supabase stand-in, the real database, and the real edge functions in Deno.
// Stripe's hosted checkout is the only thing faked: the test plays Stripe by sending
// a correctly signed webhook to the real stripe-webhook function.
//
// Needs: Postgres (PG_ADMIN_URL), Deno (DENO_BIN), and Playwright with Chromium.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import { freshDatabase, pool, rpc } from "./lib/db.mjs";
import { startMock, ANON_KEY, SERVICE_KEY, userToken } from "./lib/mock-supabase.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const MOCK_PORT = 54322, FN_PORT = 54331;
const WEBHOOK_SECRET = "whsec_e2e_secret";
const stripe = new Stripe("sk_test_dummy");
const SHOTS = process.env.E2E_SHOTS || null;

let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name + (detail ? " :: " + detail : "")); }
}

const db = pool(await freshDatabase("worm_e2e"));
const sql = (t, p) => db.query(t, p).then((r) => r.rows);
const BOOKS = {
  dune: ["9780441172719", "Dune", "Frank Herbert"],
  babel: ["9780063021426", "Babel", "R. F. Kuang"],
  circe: ["9780316556347", "Circe", "Madeline Miller"],
  piranesi: ["9781635577808", "Piranesi", "Susanna Clarke"],
  klara: ["9780593318171", "Klara and the Sun", "Kazuo Ishiguro"],
  hamnet: ["9780525657606", "Hamnet", "Maggie O'Farrell"],
};
for (const [isbn, title, author] of Object.values(BOOKS)) {
  await rpc(db, "service", "upsert_book", { p_isbn: isbn, p_title: title, p_author: author, p_year: 2020, p_genre: "Literary", p_cover_url: null, p_source: "test" });
}

// Another reader, Maya, already has books on Wormy.
const MAYA = crypto.randomUUID();
await sql("insert into auth.users (id, email) values ($1, 'maya@example.com')", [MAYA]);
await rpc(db, MAYA, "save_profile", { p_handle: "mayareads", p_display_name: "Maya Rivera", p_city: "Portland", p_state: "OR", p_genres: ["Literary"], p_avatar_path: null });
await rpc(db, MAYA, "save_address", { p_name: "Maya Rivera", p_line1: "88 Alder St", p_line2: null, p_city: "Portland", p_state: "OR", p_zip: "97204" });
for (const k of ["babel", "piranesi", "hamnet"]) await rpc(db, MAYA, "add_copy", { p_isbn: BOOKS[k][0], p_condition: "vg", p_format: "Paperback" });
await rpc(db, "service", "credit_topup", { p_user: MAYA, p_cents: 1000, p_session: "cs_maya", p_payment_intent: "pi_maya", p_fingerprint: "fp_maya" });

// Edge functions, for real, in Deno.
const deno = spawn(process.env.DENO_BIN || "deno", ["run", "--allow-net", "--allow-env", "--allow-read", path.join(here, "lib", "functions-router.ts")], {
  env: {
    ...process.env, DENO_NO_UPDATE_CHECK: "1",
    SUPABASE_URL: `http://localhost:${MOCK_PORT}`, SUPABASE_ANON_KEY: ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, EASYPOST_WEBHOOK_SECRET: "unused",
    APP_URL: `http://localhost:${MOCK_PORT}/`, APP_ORIGINS: `http://localhost:${MOCK_PORT}`, FUNCTIONS_PORT: String(FN_PORT),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("Deno functions didn't start")), 120000);
  deno.stdout.on("data", (d) => { if (String(d).includes("functions ready")) { clearTimeout(t); resolve(); } });
});

// Plays Stripe: the app gets a checkout URL, and Stripe's signed webhook arrives shortly after.
const fakeFunctions = {
  "create-checkout": async ({ claims, body }) => {
    const session = { id: "cs_e2e_" + crypto.randomUUID(), object: "checkout.session", currency: "usd", payment_status: "paid", amount_total: body.amount, client_reference_id: claims.sub, payment_intent: null, metadata: { kind: "topup" } };
    const payload = JSON.stringify({ id: "evt_" + crypto.randomUUID(), object: "event", type: "checkout.session.completed", data: { object: session } });
    setTimeout(() => fetch(`http://localhost:${FN_PORT}/stripe-webhook`, {
      method: "POST", body: payload,
      headers: { "Stripe-Signature": stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) },
    }), 800);
    return { body: { url: `http://localhost:${MOCK_PORT}/?topup=success` } };
  },
};
const mock = await startMock({
  db, port: MOCK_PORT, functionsUrl: `http://localhost:${FN_PORT}`, staticRoot: root, fakeFunctions,
  configJs: `window.WORM_CONFIG = { supabaseUrl: "http://localhost:${MOCK_PORT}", supabaseAnonKey: "${ANON_KEY}" };`,
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && /Refused to|Content Security Policy|TypeError|ReferenceError/.test(m.text())) problems.push("console: " + m.text()); });
const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png` }); };
const tap = async (sel, n = 0) => { await page.locator(sel).nth(n).click(); await page.waitForTimeout(150); };
const idle = () => page.waitForFunction(() => !document.querySelector(".busy-bar"), null, { timeout: 15000 }).then(() => page.waitForTimeout(150));
const text = (sel) => page.locator(sel).first().textContent({ timeout: 5000 }).catch(() => "");
const credits = async () => Number((await text(".credit-pill b")) || -1);
async function asMaya(fn, args) { return rpc(db, MAYA, fn, args); }
async function mayaFunction(name, body) {
  const res = await fetch(`${mock.url}/functions/v1/${name}`, { method: "POST", headers: { apikey: ANON_KEY, Authorization: `Bearer ${userToken(MAYA)}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

try {
  console.log("Signing in");
  await page.goto(mock.url + "/");
  await page.waitForSelector(".signin .auth-btn.apple");
  check("signed-out readers see the sign-in screen", await page.locator(".auth-btn.google").isVisible());
  await shot("e2e-01-signin");
  const [nav] = await Promise.all([page.waitForURL(/auth\/v1\/authorize/), tap(".auth-btn.google")]);
  const authUrl = new URL(page.url());
  check("Google sign-in starts an OAuth redirect with PKCE", authUrl.searchParams.get("provider") === "google" && !!authUrl.searchParams.get("code_challenge"), page.url());
  await page.goto(mock.url + "/");
  await page.fill("#si-email", "jamie@example.com");
  await tap("#emailForm button[type=submit]");
  await page.waitForSelector("#si-code");
  await page.fill("#si-code", "000000");
  await tap("#otpForm button[type=submit]");
  await idle();
  check("a wrong email code is refused", /didn't work/.test(await text(".toast")));
  await page.fill("#si-code", "123456");
  await tap("#otpForm button[type=submit]");
  await page.waitForSelector(".onboarding", { timeout: 10000 });
  check("a new reader lands in profile setup", true);
  const JAMIE = (await sql("select id from auth.users where email = 'jamie@example.com'"))[0].id;

  console.log("Profile setup");
  await page.fill("#ob-name", "Jamie Reader");
  await page.fill("#ob-handle", "mayareads");
  await page.locator("#ob-city").click();
  await page.waitForFunction(() => /taken/.test(document.querySelector("#handleHint")?.textContent || ""));
  check("a taken handle is flagged before saving", true);
  await page.fill("#ob-handle", "jamie.reads");
  await page.locator("#ob-city").click();
  await page.waitForFunction(() => /is yours/.test(document.querySelector("#handleHint")?.textContent || ""));
  await page.fill("#ob-city", "Tulsa");
  await page.selectOption("#ob-state", "OK");
  // A 1x1 PNG stands in for a phone photo.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.setInputFiles("#photo", { name: "me.png", mimeType: "image/png", buffer: png });
  await page.waitForSelector("img.avatar.lg", { timeout: 10000 });
  check("the photo uploads to the reader's own folder", [...mock.files.keys()].some((k) => k.startsWith(`avatars/${JAMIE}/`)));
  check("the photo shows from Wormy's storage", (await page.locator("img.avatar.lg").getAttribute("src")).startsWith(mock.url + "/storage/v1/object/public/avatars/"));
  await shot("e2e-02-profile");
  await tap('[data-act="obNext"]');
  await idle();
  const prof = (await sql("select handle, display_name, city, state, avatar_path from profiles where id = $1", [JAMIE]))[0];
  check("the profile is saved on the server, with the photo as a path in Wormy's storage", prof?.handle === "jamie.reads" && prof.state === "OK" && (prof.avatar_path || "").startsWith(JAMIE + "/"), JSON.stringify(prof));
  await tap('[data-act="obGenre"]', 0);
  await tap('[data-act="obNext"]');
  await idle();
  await page.waitForSelector('[data-act="obWish"]');
  await tap('[data-act="obWish"]', 0);
  await page.waitForTimeout(400);
  check("wishes from onboarding are saved", (await sql("select count(*)::int n from wishlist where user_id = $1", [JAMIE]))[0].n === 1);
  await tap('[data-act="obNext"]');
  await tap('[data-act="obDone"]');
  await idle();
  check("onboarding ends on the Scan tab", (await page.locator(".tabbar button[aria-current=page]").textContent()).includes("Scan"));

  console.log("Adding books");
  for (const k of ["dune", "circe", "klara"]) {
    await page.fill("#scanq", BOOKS[k][0]);
    await tap('[data-act="lookupIsbn"]');
    await idle();
  }
  check("three books scanned in by ISBN appear under Just added", (await page.locator(".scan-row").count()) === 3);
  check("they're listed on the server", (await sql("select count(*)::int n from listings l join copies c on c.id = l.copy_id where c.owner_id = $1 and l.closed_at is null", [JAMIE]))[0].n === 3);
  await tap('.scan-row [data-act="setCond"][data-c="good"]', 0);
  await idle();
  check("a condition fix saves", (await sql("select count(*)::int n from copies where owner_id = $1 and condition = 'good'", [JAMIE]))[0].n === 1);
  await page.fill("#scanq", "1234567890");
  await tap('[data-act="lookupIsbn"]');
  await idle();
  check("an invalid ISBN gets a clear message", /doesn't look like an ISBN/.test(await text(".toast")));
  await shot("e2e-03-scan");

  console.log("Paying through Stripe (signed webhook)");
  await tap('[data-act="tab"][data-id="discover"]');
  check("the welcome banner shows progress", /3\/3 books available/.test(await text(".welcome")));
  await tap(".welcome");
  await tap('[data-act="pickTopup"][data-id="10"]');
  await Promise.all([page.waitForURL(/topup=success/), tap('[data-act="confirmTopup"]')]);
  await page.waitForSelector(".burst", { timeout: 20000 });
  check("after paying, the webhook credits the balance and unlocks the welcome credit", (await credits()) === 1);
  check("the Stripe session was recorded once", (await sql("select count(*)::int n from payments where user_id = $1 and kind = 'topup' and amount_cents = 1000", [JAMIE]))[0].n === 1);
  check("the URL is cleaned up after returning from Stripe", !page.url().includes("topup="));
  await shot("e2e-04-welcome");
  await tap('[data-act="close"].x');

  console.log("Requesting a book");
  await page.locator(".book", { hasText: "Babel" }).first().click();
  await tap('.sheet [data-act="request"]');
  await tap('[data-act="editAddress"]');
  await page.fill("#a-name", "Jamie Reader");
  await page.fill("#a-line1", "500 Main St");
  await page.fill("#a-city", "Tulsa");
  await page.selectOption("#a-state", "OK");
  await page.fill("#a-zip", "74103");
  await tap("#addrForm button[type=submit]");
  await idle();
  await tap('[data-act="sendRequest"]');
  await idle();
  check("requesting reserves the credit", (await credits()) === 0);
  const reqId = (await sql("select id from requests where recipient_id = $1", [JAMIE]))[0].id;
  check("the request reached the server", !!reqId);
  await shot("e2e-05-requested");

  console.log("Maya ships it");
  await asMaya("accept_request", { p_req: reqId });
  const mayaView = await rpc(db, MAYA, "get_state");
  check("Maya sees Jamie's street address only while shipping", mayaView.exchanges[0].shipTo?.line1 === "500 Main St");
  const shipped = await mayaFunction("add-tracking", { request_id: reqId, carrier: "USPS", tracking: "9400 1118 9922 3456 7781 20" });
  check("Maya adds tracking through the add-tracking function", shipped.status === 200, JSON.stringify(shipped.body));
  await page.reload();
  await idle();
  await tap('[data-act="tab"][data-id="exchanges"]');
  await tap('[data-act="xTab"][data-id="incoming"]');
  await tap('[data-act="openDeal"]');
  check("Jamie sees it on the way", /On its way/.test(await text(".sheet .status")));
  await tap('[data-act="confirmBook"]');
  await idle();
  check("confirming completes the exchange", (await sql("select status from exchanges where request_id = $1", [reqId]))[0].status === "complete");
  check("Maya earned a credit", (await rpc(db, MAYA, "get_state")).ledger.some((e) => e.type === "earn" && e.requestId === reqId));
  await tap('[data-act="rate"][data-n="5"]');
  await idle();
  check("rating saves", (await sql("select stars from ratings where request_id = $1 and rater_id = $2", [reqId, JAMIE]))[0]?.stars === 5);
  await tap('[data-act="close"].x');

  console.log("Jamie sends a book");
  const jamieListing = (await sql("select l.id from listings l join copies c on c.id = l.copy_id where c.owner_id = $1 and l.closed_at is null and c.isbn = $2", [JAMIE, BOOKS.dune[0]]))[0].id;
  const mayaReq = await asMaya("request_book", { p_listing: jamieListing });
  await page.reload();
  await idle();
  await tap('[data-act="tab"][data-id="exchanges"]');
  await tap('[data-act="openDeal"]');
  await tap('[data-act="accept"]');
  await idle();
  check("the ship-to card shows Maya's address", /88 Alder St/.test(await text(".sheet")));
  check("the shared history names readers instead of saying \"you\"", /Maya requested Dune/.test(await text(".sheet .timeline")) && !/You requested/.test(await text(".sheet .timeline")));
  check("countdowns round cleanly", !/24h/.test(await text(".sheet")));
  await shot("e2e-06-ship");
  await tap('[data-act="addTracking"]');
  await page.fill("#t-num", "123");
  await tap("#trackForm button[type=submit]");
  await idle();
  check("a bad tracking number is refused with the server's message", /doesn't look like a USPS tracking number/.test(await text(".toast")));
  await page.fill("#t-num", "9400 1118 9922 3456 7781 20");
  await tap("#trackForm button[type=submit]");
  await idle();
  check("a reused tracking number is refused", /already used/.test(await text(".toast")));
  await page.fill("#t-num", "9400 1118 9922 0000 1111 22");
  await tap("#trackForm button[type=submit]");
  await idle();
  check("good tracking ships it", (await sql("select status from exchanges where request_id = $1", [mayaReq]))[0].status === "shipped");
  check("the address is hidden again once shipped", !/88 Alder St/.test(await text(".sheet")));
  await asMaya("confirm_received", { p_req: mayaReq });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.reload();
  await idle();
  await page.locator('[data-act="tab"][data-id="discover"]').click();
  await page.waitForTimeout(300);
  check("Jamie has 1 credit after sending", (await credits()) === 1);

  console.log("Support rules on a problem report");
  const THEO = crypto.randomUUID();
  await sql("insert into auth.users (id, email) values ($1, 'theo@example.com')", [THEO]);
  await rpc(db, THEO, "save_profile", { p_handle: "theo.t", p_display_name: "Theo Tran", p_city: "Denver", p_state: "CO", p_genres: [], p_avatar_path: null });
  await rpc(db, THEO, "save_address", { p_name: "Theo Tran", p_line1: "9 Elm St", p_line2: null, p_city: "Denver", p_state: "CO", p_zip: "80202" });
  for (const k of ["dune", "circe", "klara"]) await rpc(db, THEO, "add_copy", { p_isbn: BOOKS[k][0], p_condition: "vg", p_format: "Paperback" });
  await rpc(db, "service", "credit_topup", { p_user: THEO, p_cents: 500, p_session: "cs_theo", p_payment_intent: "pi_theo", p_fingerprint: "fp_theo" });
  const piranesi = (await sql("select l.id from listings l join copies c on c.id = l.copy_id where c.owner_id = $1 and c.isbn = $2 and l.closed_at is null", [MAYA, BOOKS.piranesi[0]]))[0].id;
  const theoReq = await rpc(db, THEO, "request_book", { p_listing: piranesi });
  await asMaya("accept_request", { p_req: theoReq });
  await asMaya("ship_exchange", { p_req: theoReq, p_carrier: "USPS", p_tracking: "EA987654321US" });
  await rpc(db, THEO, "report_problem", { p_req: theoReq, p_reason: "Wrong book or edition" });
  await sql("update profiles set is_admin = true where id = $1", [JAMIE]);
  await page.reload();
  await idle();
  await tap('[data-act="tab"][data-id="profile"]');
  check("support accounts see the problem queue", /1 problem report to review/.test(await text('[data-act="support"]')));
  await tap('[data-act="support"]');
  await shot("e2e-07-support");
  await tap('[data-act="rule"][data-upheld="1"]');
  await idle();
  check("ruling for the recipient returns their credit", (await rpc(db, THEO, "get_state")).ledger.some((e) => e.type === "release" && e.requestId === theoReq));
  check("and strikes the sender", (await rpc(db, MAYA, "get_state")).me.strikes === 1);
  await tap('[data-act="close"].x');

  console.log("Alerts, sign out, delete");
  await tap('[data-act="alerts"]');
  check("alerts list server notifications", (await page.locator(".alert").count()) >= 3);
  await tap('[data-act="readAll"]');
  await idle();
  check("mark all read clears the badge", (await page.locator(".icon-btn .badge").count()) === 0);
  await tap('[data-act="close"].x');
  await tap('[data-act="tab"][data-id="profile"]');
  await shot("e2e-08-profile");
  await tap('[data-act="signOut"]');
  await page.waitForSelector(".signin .auth-btn.apple");
  check("sign out returns to the sign-in screen", true);
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("auth-token")));
  check("sign out clears the stored session", stored.length === 0, JSON.stringify(stored));
  await page.fill("#si-email", "jamie@example.com");
  await tap("#emailForm button[type=submit]");
  await page.fill("#si-code", "123456");
  await tap("#otpForm button[type=submit]");
  await page.waitForSelector(".tabbar", { timeout: 10000 });
  check("signing back in skips setup for an existing reader", (await page.locator(".onboarding").count()) === 0);
  await tap('[data-act="tab"][data-id="profile"]');
  await tap('[data-act="deleteAccount"]');
  await tap('[data-act="confirmDelete"]');
  await page.waitForSelector(".signin .auth-btn.apple", { timeout: 10000 });
  const gone = (await sql("select display_name, deleted_at from profiles where id = $1", [JAMIE]))[0];
  check("delete account anonymizes the profile", gone.display_name === "Deleted reader" && !!gone.deleted_at);
  check("delete account removes the sign-in", (await sql("select count(*)::int n from auth.users where id = $1", [JAMIE]))[0].n === 0);
  check("delete account removes the photo", ![...mock.files.keys()].some((k) => k.startsWith(`avatars/${JAMIE}/`)));

  check("no script errors or blocked resources", problems.length === 0, problems.join(" | "));
} catch (e) {
  failed++;
  console.log("  FAIL unexpected error :: " + (e.stack || e.message));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/e2e-error.png` }).catch(() => {});
} finally {
  await browser.close();
  deno.kill();
  mock.close();
  await db.end();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
