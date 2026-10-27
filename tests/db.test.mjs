// Worm database tests: the full exchange loop, plus attempts to cheat, snoop,
// double-spend and break the rules. Run with: npm test (from this folder).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { freshDatabase, pool, rpc, asRole } from "./lib/db.mjs";

let db;
const id = () => crypto.randomUUID();
const A = id(), B = id(), C = id(), D = id(), ADMIN = id();
const ISBN = {
  dune: "9780441172719", babel: "9780063021426", circe: "9780316556347", pachinko: "9781455563920",
  piranesi: "9781635577808", klara: "9780593318171", hamnet: "9780525657606", educated: "9780399590504",
};
const sql = (text, params) => db.query(text, params).then((r) => r.rows);
const rejects = (p, re) => assert.rejects(p, (e) => { assert.match(e.message, re); return true; });
const state = (u) => rpc(db, u, "get_state");
const balances = async (u) => {
  const s = await state(u);
  const move = { grant: [1, 0], earn: [1, 0], reserve: [-1, 1], release: [1, -1], spend: [0, -1], reverse: [-1, 0] };
  return s.ledger.reduce((b, e) => ({ available: b.available + move[e.type][0], reserved: b.reserved + move[e.type][1] }), { available: 0, reserved: 0 });
};
const listingOf = async (copyId) => (await sql("select id from listings where copy_id = $1 and closed_at is null", [copyId]))[0]?.id;
const address = { p_name: "Test Reader", p_line1: "1 Main St", p_line2: null, p_city: "Springfield", p_state: "IL", p_zip: "62701" };
const profile = (handle, name, state = "NY") => ({ p_handle: handle, p_display_name: name, p_city: "Brooklyn", p_state: state, p_genres: ["Literary"], p_avatar_url: null });
let topupN = 0;
const topup = (u, cents = 500, fp = null) => rpc(db, "service", "credit_topup", { p_user: u, p_cents: cents, p_session: "cs_test_" + ++topupN, p_payment_intent: "pi_test_" + topupN, p_fingerprint: fp });
const copies = {};

// A brand-new reader with a profile, an address, 3 listed books, a top-up and a welcome credit.
let readerN = 0;
async function newReader(handle) {
  const u = id();
  await sql("insert into auth.users (id) values ($1)", [u]);
  await rpc(db, u, "save_profile", profile(handle, handle[0].toUpperCase() + handle.slice(1) + " Reader"));
  await rpc(db, u, "save_address", address);
  const books = [];
  for (const isbn of [ISBN.dune, ISBN.circe, ISBN.educated]) books.push(await rpc(db, u, "add_copy", { p_isbn: isbn, p_condition: "vg", p_format: "Paperback" }));
  await topup(u, 1000, "fp_new_" + ++readerN);
  return { id: u, books };
}

before(async () => {
  db = pool(await freshDatabase());
  for (const u of [A, B, C, D, ADMIN]) await sql("insert into auth.users (id, email) values ($1, $2)", [u, u.slice(0, 6) + "@example.com"]);
  for (const [k, isbn] of Object.entries(ISBN)) {
    await rpc(db, "service", "upsert_book", { p_isbn: isbn, p_title: k[0].toUpperCase() + k.slice(1), p_author: "Author", p_year: 2020, p_genre: "Literary", p_cover_url: null, p_source: "test" });
  }
});
after(async () => { await db.end(); });

test("the public API can't be used without signing in", async () => {
  await rejects(rpc(db, "anon", "get_state"), /permission denied/);
  await rejects(rpc(db, "anon", "request_book", { p_listing: id() }), /permission denied/);
});

test("signed-in readers can't touch tables directly", async () => {
  await rejects(asRole(db, A, "select * from public.profiles"), /permission denied/);
  await rejects(asRole(db, A, "select * from public.addresses"), /permission denied/);
  await rejects(asRole(db, A, "insert into public.credit_entries (user_id, type, note) values ($1, 'grant', 'free money')", [A]), /permission denied/);
  await rejects(asRole(db, A, "insert into public.payments (user_id, kind, amount_cents) values ($1, 'topup', 100000)", [A]), /permission denied/);
  await rejects(asRole(db, A, "update public.settings set value = '{}'"), /permission denied/);
});

test("signed-in readers can't call server-only or internal functions", async () => {
  await rejects(rpc(db, A, "credit_topup", { p_user: A, p_cents: 500, p_session: "cs_fake", p_payment_intent: null, p_fingerprint: null }), /permission denied/);
  await rejects(rpc(db, A, "worm_tick"), /permission denied/);
  await rejects(rpc(db, A, "upsert_book", { p_isbn: ISBN.dune, p_title: "Hacked", p_author: "x", p_year: 1, p_genre: null, p_cover_url: null, p_source: "x" }), /permission denied/);
  await rejects(rpc(db, A, "_post", { p_user: A, p_type: "grant", p_req: null, p_note: "x" }), /permission denied/);
  await rejects(rpc(db, A, "mark_delivered", { p_tracker: "trk" }), /permission denied/);
  await rejects(rpc(db, A, "_complete", { p_ex: id(), p_how: "x" }), /permission denied/);
});

test("profile setup validates handles, names, states and photo locations", async () => {
  const s = await state(A);
  assert.equal(s.me.onboarded, false);
  await rejects(rpc(db, A, "request_book", { p_listing: id() }), /Finish setting up your profile/);
  await rejects(rpc(db, A, "save_profile", profile("A!", "Ann")), /Handles are 3 to 20/);
  await rejects(rpc(db, A, "save_profile", profile("admin", "Ann")), /taken/);
  await rejects(rpc(db, A, "save_profile", profile("annreads", "")), /Add your name/);
  await rejects(rpc(db, A, "save_profile", profile("annreads", "Ann", "ON")), /US only/);
  await rejects(rpc(db, A, "save_profile", { ...profile("annreads", "Ann"), p_avatar_url: `https://x.supabase.co/storage/v1/object/public/avatars/${B}/me.jpg` }), /Upload your photo again/);
  await rpc(db, A, "save_profile", { ...profile("AnnReads", "Ann Lee"), p_avatar_url: `https://x.supabase.co/storage/v1/object/public/avatars/${A}/a.jpg` });
  assert.equal((await state(A)).me.handle, "annreads");
  await rejects(rpc(db, B, "save_profile", profile("annreads", "Bo")), /taken/);
  assert.equal(await rpc(db, B, "handle_available", { p_handle: "annreads" }), false);
  assert.equal(await rpc(db, B, "handle_available", { p_handle: "bo.reads" }), true);
  await rpc(db, B, "save_profile", profile("bo.reads", "Bo Park"));
  await rpc(db, C, "save_profile", profile("cee", "Cee Day"));
  await rpc(db, D, "save_profile", profile("dee", "Dee Eve"));
  await rpc(db, ADMIN, "save_profile", profile("worm_support", "Support"));
  await sql("update profiles set is_admin = true where id = $1", [ADMIN]);
});

test("adding books lists them; the welcome credit needs 3 listings and a first top-up", async () => {
  await rejects(rpc(db, A, "add_copy", { p_isbn: "9780000000000", p_condition: "vg", p_format: "Paperback" }), /couldn't find that book/);
  await rejects(rpc(db, A, "add_copy", { p_isbn: ISBN.dune, p_condition: "mint", p_format: "Paperback" }), /Choose a condition/);
  copies.aDune = await rpc(db, A, "add_copy", { p_isbn: ISBN.dune, p_condition: "vg", p_format: "Paperback" });
  copies.aBabel = await rpc(db, A, "add_copy", { p_isbn: ISBN.babel, p_condition: "ln", p_format: "Hardcover" });
  copies.aCirce = await rpc(db, A, "add_copy", { p_isbn: ISBN.circe, p_condition: "good", p_format: "Paperback" });
  assert.ok(await listingOf(copies.aDune));
  assert.deepEqual(await balances(A), { available: 0, reserved: 0 }, "no welcome credit before a top-up");
  assert.equal(await topup(A, 500, "fp_card_A"), true);
  assert.equal((await rpc(db, "service", "credit_topup", { p_user: A, p_cents: 500, p_session: "cs_test_" + topupN, p_payment_intent: null, p_fingerprint: null })), false, "same Stripe session can't be credited twice");
  assert.deepEqual(await balances(A), { available: 1, reserved: 0 });
  const payments = (await state(A)).payments;
  assert.equal(payments.length, 1);
  await rejects(rpc(db, "service", "credit_topup", { p_user: A, p_cents: 123, p_session: "cs_odd", p_payment_intent: null, p_fingerprint: null }), /Unexpected top-up amount/);
});

test("one card can't unlock welcome credits on several accounts", async () => {
  copies.bPachinko = await rpc(db, B, "add_copy", { p_isbn: ISBN.pachinko, p_condition: "vg", p_format: "Paperback" });
  copies.bPiranesi = await rpc(db, B, "add_copy", { p_isbn: ISBN.piranesi, p_condition: "vg", p_format: "Paperback" });
  copies.bKlara = await rpc(db, B, "add_copy", { p_isbn: ISBN.klara, p_condition: "vg", p_format: "Paperback" });
  await topup(B, 500, "fp_card_A");
  assert.deepEqual(await balances(B), { available: 0, reserved: 0 }, "card already used for A's welcome credit");
  await topup(B, 500, "fp_card_B");
  assert.deepEqual(await balances(B), { available: 1, reserved: 0 });
});

test("requesting needs an address, a credit and fee balance, and can't target your own book", async () => {
  const dune = await listingOf(copies.aDune);
  await rejects(rpc(db, B, "request_book", { p_listing: dune }), /shipping address/);
  await rejects(rpc(db, B, "save_address", { ...address, p_zip: "ABCDE" }), /ZIP/);
  await rejects(rpc(db, B, "save_address", { ...address, p_state: "XX" }), /Check the address/);
  await rpc(db, B, "save_address", address);
  await rpc(db, A, "save_address", { ...address, p_name: "Ann Lee" });
  await rejects(rpc(db, A, "request_book", { p_listing: dune }), /your own book/);
  await rejects(rpc(db, B, "request_book", { p_listing: id() }), /no longer available/);
});

test("a request reserves exactly one credit and can't be duplicated", async () => {
  const dune = await listingOf(copies.aDune);
  const babel = await listingOf(copies.aBabel);
  copies.rDune = await rpc(db, B, "request_book", { p_listing: dune });
  assert.deepEqual(await balances(B), { available: 0, reserved: 1 });
  await rejects(rpc(db, B, "request_book", { p_listing: babel }), /You need 1 credit/);
  const s = await state(B);
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].status, "pending");
});

test("other readers can't see or act on someone else's exchange", async () => {
  await rejects(rpc(db, C, "accept_request", { p_req: copies.rDune }), /couldn't find that request/);
  await rejects(rpc(db, C, "decline_request", { p_req: copies.rDune }), /couldn't find that request/);
  await rejects(rpc(db, C, "withdraw_request", { p_req: copies.rDune }), /couldn't find that request/);
  await rejects(rpc(db, B, "accept_request", { p_req: copies.rDune }), /couldn't find that request/, "recipient can't accept their own request");
  const s = await state(C);
  assert.equal(s.requests.length, 0);
  assert.equal(JSON.stringify(s).includes("1 Main St"), false, "no addresses leak to bystanders");
});

test("accepting opens a 3-day ship window and shares the address with the sender only", async () => {
  await rpc(db, C, "save_address", { ...address, p_name: "Cee Day" });
  await topup(C, 1000, "fp_card_C");
  copies.cHamnet = await rpc(db, C, "add_copy", { p_isbn: ISBN.hamnet, p_condition: "vg", p_format: "Paperback" });
  await rpc(db, C, "add_copy", { p_isbn: ISBN.educated, p_condition: "vg", p_format: "Paperback" });
  await rpc(db, C, "add_copy", { p_isbn: ISBN.klara, p_condition: "good", p_format: "Paperback" });
  assert.equal((await balances(C)).available, 1, "C got a welcome credit");
  const before = (await state(A)).exchanges.length;
  await rpc(db, A, "accept_request", { p_req: copies.rDune });
  const ex = (await state(A)).exchanges.find((x) => x.requestId === copies.rDune);
  assert.equal((await state(A)).exchanges.length, before + 1);
  assert.equal(ex.status, "accepted");
  assert.equal(ex.shipTo.line1, "1 Main St", "sender sees where to ship");
  assert.ok(ex.shipBy - ex.acceptedAt >= 3 * 864e5 - 1000);
  const recipientView = (await state(B)).exchanges.find((x) => x.requestId === copies.rDune);
  assert.equal(recipientView.shipTo, null);
  await rejects(rpc(db, C, "request_book", { p_listing: await listingOf(copies.aDune) }), /Someone else is getting this copy/);
  await rejects(rpc(db, A, "accept_request", { p_req: copies.rDune }), /no longer open/);
  await rejects(rpc(db, A, "remove_copy", { p_copy: copies.aDune }), /in an exchange/);
  await rejects(rpc(db, A, "update_copy", { p_copy: copies.aDune, p_condition: "new", p_format: "Paperback", p_flags: [] }), /in an exchange/);
});

test("tracking numbers are checked and can only prove one shipment", async () => {
  await rejects(rpc(db, B, "ship_exchange", { p_req: copies.rDune, p_carrier: "USPS", p_tracking: "9400111899223456778120" }), /couldn't find that exchange/, "recipient can't mark it shipped");
  await rejects(rpc(db, A, "ship_exchange", { p_req: copies.rDune, p_carrier: "USPS", p_tracking: "12345" }), /doesn't look like a USPS tracking number/);
  await rejects(rpc(db, A, "ship_exchange", { p_req: copies.rDune, p_carrier: "DHL", p_tracking: "9400111899223456778120" }), /USPS, UPS or FedEx/);
  await rpc(db, A, "ship_exchange", { p_req: copies.rDune, p_carrier: "USPS", p_tracking: "9400 1118 9922 3456 7781 20" });
  const ex = (await state(A)).exchanges.find((x) => x.requestId === copies.rDune);
  assert.equal(ex.status, "shipped");
  assert.equal(ex.tracking, "9400111899223456778120");
  assert.equal(ex.shipTo, null, "address hidden again once shipped");
  assert.equal((await balances(A)).available, 1, "shipping alone earns nothing");
  // C requests B's Pachinko, B accepts, then B tries to reuse A's tracking number.
  copies.rPach = await rpc(db, C, "request_book", { p_listing: await listingOf(copies.bPachinko) });
  await rpc(db, B, "accept_request", { p_req: copies.rPach });
  await rejects(rpc(db, B, "ship_exchange", { p_req: copies.rPach, p_carrier: "USPS", p_tracking: "9400111899223456778120" }), /already used/);
});

test("confirming settles credits and fees exactly once and moves the book", async () => {
  await rejects(rpc(db, C, "confirm_received", { p_req: copies.rDune }), /couldn't find that exchange/);
  await rejects(rpc(db, A, "confirm_received", { p_req: copies.rDune }), /couldn't find that exchange/, "sender can't confirm for the recipient");
  await rpc(db, B, "confirm_received", { p_req: copies.rDune });
  assert.deepEqual(await balances(B), { available: 0, reserved: 0 });
  assert.deepEqual(await balances(A), { available: 2, reserved: 0 });
  await rejects(rpc(db, B, "confirm_received", { p_req: copies.rDune }), /isn't on its way/);
  const earns = await sql("select count(*)::int n from credit_entries where request_id = $1 and type = 'earn'", [copies.rDune]);
  assert.equal(earns[0].n, 1);
  const fees = await sql("select user_id, amount_cents from payments where request_id = $1 and kind = 'fee' order by user_id", [copies.rDune]);
  assert.equal(fees.length, 2);
  const owner = await sql("select owner_id from copies where id = $1", [copies.aDune]);
  assert.equal(owner[0].owner_id, B);
  assert.equal(await listingOf(copies.aDune), undefined, "received copy starts unlisted");
});

test("ledgers can't be edited or deleted, even by the database owner", async () => {
  await rejects(sql("update credit_entries set type = 'grant' where user_id = $1", [A]), /cannot be changed or deleted/);
  await rejects(sql("delete from payments where user_id = $1", [A]), /cannot be changed or deleted/);
});

test("ratings: once per reader per exchange, only by the two readers", async () => {
  await rejects(rpc(db, C, "rate_exchange", { p_req: copies.rDune, p_stars: 1 }), /couldn't find that exchange/);
  await rejects(rpc(db, B, "rate_exchange", { p_req: copies.rDune, p_stars: 9 }), /1 to 5/);
  await rpc(db, B, "rate_exchange", { p_req: copies.rDune, p_stars: 5 });
  await rejects(rpc(db, B, "rate_exchange", { p_req: copies.rDune, p_stars: 1 }), /already rated/);
  await rpc(db, A, "rate_exchange", { p_req: copies.rDune, p_stars: 4 });
  const theirB = await rpc(db, A, "get_state");
  assert.equal(theirB.users[B].rating, 4);
  // C can see A's public profile (A has books in Discover) but nothing private.
  const s = await state(C);
  assert.deepEqual(Object.keys(s.users[A]).sort(), ["avatar", "city", "handle", "name", "rating", "ratings"]);
});

test("two requests fired at the same moment can't spend one credit twice", async () => {
  // A has 2 credits and fires 4 requests at once. Exactly 2 may succeed.
  const targets = [copies.bPiranesi, copies.bKlara, copies.cHamnet, (await sql("select id from copies where owner_id = $1 and isbn = $2", [C, ISBN.educated]))[0].id];
  const listings = await Promise.all(targets.map(listingOf));
  const results = await Promise.allSettled(listings.map((l) => rpc(db, A, "request_book", { p_listing: l })));
  const ok = results.filter((r) => r.status === "fulfilled");
  assert.equal(ok.length, 2, results.map((r) => r.reason?.message).join(" | "));
  assert.deepEqual(await balances(A), { available: 0, reserved: 2 });
  copies.aReqs = ok.map((r) => r.value);
});

test("accepting one request declines the others for that copy and returns their credits", async () => {
  // D wants the same Hamnet copy (if A got it) or a fresh one.
  await rpc(db, D, "save_address", address);
  copies.dBooks = [];
  for (const isbn of [ISBN.circe, ISBN.babel, ISBN.dune]) copies.dBooks.push(await rpc(db, D, "add_copy", { p_isbn: isbn, p_condition: "vg", p_format: "Paperback" }));
  await topup(D, 500, "fp_card_D");
  assert.equal((await balances(D)).available, 1);
  const hamnet = await listingOf(copies.cHamnet);
  const dReq = await rpc(db, D, "request_book", { p_listing: hamnet });
  const s = await state(C);
  const pending = s.requests.filter((r) => r.listingId === hamnet && r.status === "pending");
  assert.ok(pending.length >= 1);
  await rpc(db, C, "accept_request", { p_req: dReq });
  assert.deepEqual(await balances(D), { available: 0, reserved: 1 });
  const others = (await state(C)).requests.filter((r) => r.listingId === hamnet && r.id !== dReq);
  for (const r of others) assert.equal(r.status, "declined");
  copies.dReq = dReq;
});

test("fee balance must cover the fee, and fees for open exchanges are set aside", async () => {
  const fresh = id();
  await sql("insert into auth.users (id) values ($1)", [fresh]);
  await rpc(db, fresh, "save_profile", profile("broke", "Bea Roke"));
  await rpc(db, fresh, "save_address", address);
  for (const isbn of [ISBN.pachinko, ISBN.piranesi, ISBN.klara]) await rpc(db, fresh, "add_copy", { p_isbn: isbn, p_condition: "vg", p_format: "Paperback" });
  // A welcome credit needs a top-up, so give credit another way: an earn via a full exchange is long;
  // instead check the sender side: someone requests their book and they have no fee balance.
  const theirs = (await sql("select c.id from copies c where owner_id = $1 limit 1", [fresh]))[0].id;
  await topup(B, 500, "fp_card_B2");
  const before = await balances(B);
  if (before.available < 1) {
    // B earns a credit by sending Pachinko to C first.
    await rpc(db, B, "ship_exchange", { p_req: copies.rPach, p_carrier: "UPS", p_tracking: "1Z999AA10123456784" });
    await rpc(db, C, "confirm_received", { p_req: copies.rPach });
  }
  const req = await rpc(db, B, "request_book", { p_listing: await listingOf(theirs) });
  await rejects(rpc(db, fresh, "accept_request", { p_req: req }), /fee balance/);
  await topup(fresh, 500, "fp_fresh");
  await rpc(db, fresh, "accept_request", { p_req: req });
  copies.freshUser = fresh;
  copies.freshReq = req;
});

test("timers: requests expire after 48 hours and credits come back", async () => {
  const listing = await listingOf(copies.dBooks[0]);
  await topup(A, 500, "fp_card_A");
  // A has 0 available; free one up by withdrawing an open request.
  const open = (await state(A)).requests.filter((r) => r.recipient === A && r.status === "pending");
  await rpc(db, A, "withdraw_request", { p_req: open[0].id });
  await rejects(rpc(db, A, "withdraw_request", { p_req: open[0].id }), /can't be cancelled anymore/);
  const r = await rpc(db, A, "request_book", { p_listing: listing });
  const avail = (await balances(A)).available;
  await sql("update requests set created_at = now() - interval '49 hours' where id = $1", [r]);
  const out = await rpc(db, "service", "worm_tick");
  assert.ok(out.expired >= 1);
  assert.equal((await balances(A)).available, avail + 1);
  assert.equal((await state(A)).requests.find((x) => x.id === r).status, "expired");
});

test("timers: a missed ship window cancels, returns the credit and adds a strike", async () => {
  // C accepted D's Hamnet request. Let the window lapse.
  await sql("update exchanges set ship_by = now() - interval '1 minute' where request_id = $1", [copies.dReq]);
  const out = await rpc(db, "service", "worm_tick");
  assert.equal(out.missed, 1);
  assert.deepEqual(await balances(D), { available: 1, reserved: 0 });
  assert.equal((await state(C)).me.strikes, 1);
  assert.equal(await listingOf(copies.cHamnet), undefined, "listing closed after a missed window");
});

test("timers: reminders, lost packages and auto-confirm", async () => {
  // freshUser accepted B's request. Remind, then ship, then lose it.
  await sql("update exchanges set ship_by = now() + interval '2 hours' where request_id = $1", [copies.freshReq]);
  assert.equal((await rpc(db, "service", "worm_tick")).reminded, 1);
  assert.equal((await rpc(db, "service", "worm_tick")).reminded, 0, "remind only once");
  await rpc(db, copies.freshUser, "ship_exchange", { p_req: copies.freshReq, p_carrier: "FedEx", p_tracking: "123456789012" });
  const bBefore = await balances(B);
  await sql("update exchanges set shipped_at = now() - interval '11 days' where request_id = $1", [copies.freshReq]);
  assert.equal((await rpc(db, "service", "worm_tick")).lost, 1);
  assert.equal((await balances(B)).available, bBefore.available + 1);
  // Auto-confirm: D requests A's Babel, A accepts, ships, tracker reports delivery, 2 days pass.
  const babel = await listingOf(copies.aBabel);
  const r = await rpc(db, D, "request_book", { p_listing: babel });
  await rpc(db, A, "accept_request", { p_req: r });
  await rpc(db, A, "ship_exchange", { p_req: r, p_carrier: "USPS", p_tracking: "9400111899223456770000" });
  await rpc(db, "service", "set_tracker", { p_req: r, p_tracker: "trk_test_1" });
  assert.equal(await rpc(db, "service", "mark_delivered", { p_tracker: "trk_test_1" }), true);
  assert.equal(await rpc(db, "service", "mark_delivered", { p_tracker: "trk_test_1" }), false, "second delivery event changes nothing");
  const aBefore = (await balances(A)).available;
  await sql("update exchanges set delivered_at = now() - interval '3 days' where request_id = $1", [r]);
  assert.equal((await rpc(db, "service", "worm_tick")).confirmed, 1);
  assert.equal((await balances(A)).available, aBefore + 1);
});

test("disputes: only support can decide; upheld returns the credit and strikes the sender", async () => {
  const seller = await newReader("seller"), buyer = await newReader("buyer");
  const r = await rpc(db, buyer.id, "request_book", { p_listing: await listingOf(seller.books[0]) });
  await rpc(db, seller.id, "accept_request", { p_req: r });
  await rpc(db, seller.id, "ship_exchange", { p_req: r, p_carrier: "USPS", p_tracking: "EA123456789US" });
  await rejects(rpc(db, buyer.id, "report_problem", { p_req: r, p_reason: "I changed my mind" }), /Choose what went wrong/);
  await rpc(db, buyer.id, "report_problem", { p_req: r, p_reason: "Wrong book or edition" });
  await rejects(rpc(db, buyer.id, "confirm_received", { p_req: r }), /isn't on its way/, "a disputed exchange waits for support");
  await rejects(rpc(db, buyer.id, "resolve_dispute", { p_req: r, p_upheld: true, p_note: null }), /Only Worm support/);
  await rejects(rpc(db, seller.id, "resolve_dispute", { p_req: r, p_upheld: false, p_note: null }), /Only Worm support/);
  assert.ok((await state(ADMIN)).notes.some((n) => n.title === "Dispute to review"), "support is alerted");
  await rpc(db, ADMIN, "resolve_dispute", { p_req: r, p_upheld: true, p_note: "Photos show a different edition." });
  assert.deepEqual(await balances(buyer.id), { available: 1, reserved: 0 });
  assert.equal((await state(seller.id)).me.strikes, 1);
  const earned = await sql("select count(*)::int n from credit_entries where request_id = $1 and type = 'earn'", [r]);
  assert.equal(earned[0].n, 0);
  // Rejected disputes complete the exchange normally.
  const r2 = await rpc(db, buyer.id, "request_book", { p_listing: await listingOf(seller.books[1]) });
  await rpc(db, seller.id, "accept_request", { p_req: r2 });
  await rpc(db, seller.id, "ship_exchange", { p_req: r2, p_carrier: "USPS", p_tracking: "EB123456789US" });
  await rpc(db, buyer.id, "report_problem", { p_req: r2, p_reason: "Condition is worse than listed" });
  await rpc(db, "service", "resolve_dispute", { p_req: r2, p_upheld: false, p_note: null });
  assert.deepEqual(await balances(seller.id), { available: 2, reserved: 0 });
});

test("3 strikes in 6 months pause requests and new listings", async () => {
  const g = await newReader("striker");
  const other = await newReader("other");
  for (let i = 0; i < 3; i++) await sql("insert into strikes (user_id, reason) values ($1, 'test')", [g.id]);
  assert.equal((await state(g.id)).me.paused, true);
  await rejects(rpc(db, g.id, "request_book", { p_listing: await listingOf(other.books[0]) }), /paused/);
  const extra = await rpc(db, g.id, "add_copy", { p_isbn: ISBN.dune, p_condition: "vg", p_format: "Paperback" });
  assert.equal(await listingOf(extra), undefined, "paused readers can add books but not list them");
  await rejects(rpc(db, g.id, "set_available", { p_copy: extra, p_available: true }), /paused/);
  // Old strikes stop counting after 6 months.
  await sql("update strikes set created_at = now() - interval '7 months' where user_id = $1", [g.id]);
  assert.equal((await state(g.id)).me.paused, false);
});

test("wishlist alerts and notifications stay private", async () => {
  assert.equal(await rpc(db, B, "toggle_wish", { p_isbn: ISBN.hamnet }), true);
  const fresh = await rpc(db, D, "add_copy", { p_isbn: ISBN.hamnet, p_condition: "ln", p_format: "Hardcover" });
  const notes = (await state(B)).notes.filter((n) => n.title.startsWith("Hamnet is available"));
  assert.equal(notes.length, 1);
  await rpc(db, D, "set_available", { p_copy: fresh, p_available: false });
  await rpc(db, D, "set_available", { p_copy: fresh, p_available: true });
  assert.equal((await state(B)).notes.filter((n) => n.title.startsWith("Hamnet is available")).length, 1, "no repeat alert within a day");
  await rpc(db, B, "mark_read", { p_ids: null });
  assert.equal((await state(B)).notes.some((n) => !n.read), false);
  assert.ok((await state(A)).notes.some((n) => !n.read), "marking read only affects your own alerts");
});

test("refunds reduce the fee balance once per refunded amount", async () => {
  const pi = (await sql("select stripe_payment_intent from payments where user_id = $1 and kind = 'topup' limit 1", [D]))[0].stripe_payment_intent;
  await rpc(db, "service", "record_refund", { p_payment_intent: pi, p_refunded_total: 200 });
  await rpc(db, "service", "record_refund", { p_payment_intent: pi, p_refunded_total: 200 });
  await rpc(db, "service", "record_refund", { p_payment_intent: pi, p_refunded_total: 500 });
  const refunds = await sql("select amount_cents from payments where stripe_payment_intent = $1 and kind = 'refund' order by id", [pi]);
  assert.deepEqual(refunds.map((r) => r.amount_cents), [200, 300]);
});

test("deleting an account: blocked during open exchanges, then anonymizes and frees everyone else", async () => {
  // A has an open exchange? Make one: B requests A's Circe and A accepts.
  const circe = await listingOf(copies.aCirce);
  const bal = await balances(B);
  if (bal.available < 1) await sql("select 1"); // B should have credits from earlier refunds of lost/missed exchanges
  const r = await rpc(db, B, "request_book", { p_listing: circe });
  await rpc(db, A, "accept_request", { p_req: r });
  await rejects(rpc(db, A, "delete_account"), /Finish your open exchanges/);
  await rpc(db, A, "ship_exchange", { p_req: r, p_carrier: "USPS", p_tracking: "9400111899223456779999" });
  await rpc(db, B, "confirm_received", { p_req: r });
  // Someone has a pending request on A's other book when A leaves.
  const aPending = (await state(A)).requests.filter((x) => x.recipient === A && x.status === "pending");
  await rpc(db, A, "delete_account");
  const p = await sql("select handle, display_name, avatar_url, deleted_at from profiles where id = $1", [A]);
  assert.equal(p[0].display_name, "Deleted reader");
  assert.equal(p[0].avatar_url, null);
  assert.ok(p[0].deleted_at);
  assert.equal((await sql("select count(*)::int n from addresses where user_id = $1", [A]))[0].n, 0);
  for (const x of aPending) assert.equal((await sql("select status from requests where id = $1", [x.id]))[0].status, "withdrawn");
  await rejects(rpc(db, A, "request_book", { p_listing: await listingOf(copies.dBooks[1]) }), /Finish setting up your profile/);
  await rejects(rpc(db, A, "save_profile", profile("annagain", "Ann")), /deleted/);
  const discover = (await state(B)).listings.map((l) => l.copyId);
  assert.equal(discover.includes(copies.aBabel), false, "deleted reader's books leave Discover");
});

test("every credit balance is consistent with the ledger and never negative", async () => {
  const rows = await sql(`select user_id,
      sum(case type when 'grant' then 1 when 'earn' then 1 when 'release' then 1 when 'reserve' then -1 when 'reverse' then -1 else 0 end) available,
      sum(case type when 'reserve' then 1 when 'release' then -1 when 'spend' then -1 else 0 end) reserved
    from credit_entries group by user_id`);
  for (const r of rows) {
    assert.ok(Number(r.available) >= 0, `available >= 0 for ${r.user_id}`);
    assert.ok(Number(r.reserved) >= 0, `reserved >= 0 for ${r.user_id}`);
  }
  // Credits are conserved: everything in circulation came from welcome grants.
  const totals = (await sql(`select
      count(*) filter (where type = 'grant')::int grants,
      count(*) filter (where type = 'earn')::int earns,
      count(*) filter (where type = 'spend')::int spends from credit_entries`))[0];
  assert.equal(totals.earns, totals.spends, "every earned credit matches one spent credit");
  const open = (await sql(`select count(*)::int n from requests r left join exchanges x on x.request_id = r.id
      where r.status = 'pending' or x.status in ('accepted','shipped','delivered','disputed')`))[0].n;
  const reservedTotal = rows.reduce((s, r) => s + Number(r.reserved), 0);
  assert.equal(reservedTotal, open, "reserved credits match open requests exactly");
});
