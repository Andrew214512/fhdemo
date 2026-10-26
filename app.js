/* Shelf Swap prototype. Everything is fake data kept in this browser.
   Exchanges are one-way: a reader spends 1 credit to get a book, the sender earns 1 credit when it arrives.
   The Demo panel (top right) plays the other readers and fast-forwards time. */
(function () {
  "use strict";

  const DAY = 864e5;
  const HOUR = 36e5;
  const START = Date.parse("2026-10-26T10:00:00");
  const REQUEST_TTL = 2 * DAY; // owner must accept within 48 hours
  const SHIP_WINDOW = 3 * DAY; // sender must add tracking within 3 days of accepting
  const CONFIRM_WINDOW = 2 * DAY; // recipient can report a problem for 2 days after delivery
  const LOST_AFTER = 10 * DAY; // shipped but never delivered
  const WELCOME_LISTINGS = 3;
  const PRICING = {
    split: { label: "$1 + $1", sender: 1, recipient: 1 },
    recipient: { label: "Recipient pays $2", sender: 0, recipient: 2 },
  };
  const STORE_KEY = "shelfswap-credits-v1";

  const CONDITIONS = [
    { id: "new", label: "New", short: "NEW", desc: "Unread. No marks, no wear." },
    { id: "ln", label: "Like New", short: "LIKE NEW", desc: "Read once. No creases, no marks." },
    { id: "vg", label: "Very Good", short: "V. GOOD", desc: "Light shelf wear. Spine intact, no writing." },
    { id: "good", label: "Good", short: "GOOD", desc: "Visible wear or spine creases. Any notes disclosed." },
    { id: "acc", label: "Acceptable", short: "ACCEPT.", desc: "Heavy wear, but complete and readable." },
  ];
  const COND = Object.fromEntries(CONDITIONS.map((c) => [c.id, c]));
  const FLAGS = ["Highlighting or notes", "Dust jacket included", "Ex-library", "Signed", "Smoke-free home"];
  const GENRES = ["Literary", "Sci-fi & Fantasy", "Historical", "Mystery", "Romance", "Nonfiction"];
  const US_STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");

  // Cover colors are part of each book's identity, so they stay the same in light and dark.
  const CATALOG = [
    ["b1", "Tomorrow, and Tomorrow, and Tomorrow", "Gabrielle Zevin", 2022, "9780593321201", "#f2c14e", "#1f2a44", 1, 0],
    ["b2", "Project Hail Mary", "Andy Weir", 2021, "9780593135204", "#0f3b5f", "#f5d36b", 3, 1],
    ["b3", "Circe", "Madeline Miller", 2018, "9780316556347", "#c9772c", "#1a1208", 1, 1],
    ["b4", "The Overstory", "Richard Powers", 2018, "9780393356687", "#2f5d3a", "#e9efd8", 2, 0],
    ["b5", "Piranesi", "Susanna Clarke", 2020, "9781635577808", "#1d2b4f", "#d9c38c", 3, 1],
    ["b6", "Station Eleven", "Emily St. John Mandel", 2014, "9780804172448", "#e7e1d3", "#a3291f", 2, 1],
    ["b7", "The Left Hand of Darkness", "Ursula K. Le Guin", 1969, "9780441478125", "#dfe7ea", "#18324a", 3, 1],
    ["b8", "Lessons in Chemistry", "Bonnie Garmus", 2022, "9780385547345", "#e8573c", "#fff4e6", 1, 2],
    ["b9", "Pachinko", "Min Jin Lee", 2017, "9781455563920", "#7c1f2c", "#f3d9b8", 2, 2],
    ["b10", "Demon Copperhead", "Barbara Kingsolver", 2022, "9780063251922", "#2a4a6b", "#f0b44c", 1, 0],
    ["b11", "Klara and the Sun", "Kazuo Ishiguro", 2021, "9780593318171", "#f4b23c", "#3a2a10", 3, 1],
    ["b12", "Babel", "R. F. Kuang", 2022, "9780063021426", "#efe9dc", "#7a1d1d", 2, 1],
    ["b13", "The Song of Achilles", "Madeline Miller", 2012, "9780062060624", "#14141a", "#d7b46a", 1, 2],
    ["b14", "Sea of Tranquility", "Emily St. John Mandel", 2022, "9780593321447", "#97c4d6", "#1d2f45", 3, 1],
    ["b15", "Educated", "Tara Westover", 2018, "9780399590504", "#f1ede4", "#2b2b2b", 2, 5],
    ["b16", "Remarkably Bright Creatures", "Shelby Van Pelt", 2022, "9780063204157", "#0f4c5c", "#f2c6a0", 1, 0],
    ["b17", "The Remains of the Day", "Kazuo Ishiguro", 1989, "9780679731726", "#5e6b3a", "#f3ecd2", 2, 0],
    ["b18", "Normal People", "Sally Rooney", 2018, "9781984822185", "#a8d5c2", "#18302a", 3, 0],
    ["b19", "The Midnight Library", "Matt Haig", 2020, "9780525559474", "#152a4a", "#f2d27a", 1, 0],
    ["b20", "A Gentleman in Moscow", "Amor Towles", 2016, "9780670026197", "#8a1c2b", "#efd9a7", 2, 2],
    ["b21", "Hamnet", "Maggie O'Farrell", 2020, "9780525657606", "#2d5a3c", "#f6e3c4", 3, 2],
    ["b22", "The Name of the Wind", "Patrick Rothfuss", 2007, "9780756404741", "#3b2416", "#e6b25c", 1, 1],
    ["b23", "Beloved", "Toni Morrison", 1987, "9781400033416", "#5a2340", "#f4dfe8", 2, 0],
    ["b24", "Braiding Sweetgrass", "Robin Wall Kimmerer", 2013, "9781571313560", "#7a8f3c", "#fbf6e2", 3, 5],
    ["b25", "Dune", "Frank Herbert", 1965, "9780441172719", "#d98b3a", "#2b1608", 3, 1],
    ["b26", "The Thursday Murder Club", "Richard Osman", 2020, "9781984880963", "#1f6f78", "#fbe7b5", 1, 3],
    ["b27", "Gone Girl", "Gillian Flynn", 2012, "9780307588371", "#101010", "#e9e3d8", 2, 3],
    ["b28", "Beach Read", "Emily Henry", 2020, "9781984806734", "#f6a99a", "#24304a", 1, 4],
    ["b29", "Book Lovers", "Emily Henry", 2022, "9780593334836", "#f3d36b", "#2b4a3a", 3, 4],
    ["b30", "Sapiens", "Yuval Noah Harari", 2015, "9780062316097", "#f0ece4", "#b3261e", 2, 5],
  ].map(([id, title, author, year, isbn, bg, fg, motif, g]) => ({ id, title, author, year, isbn, bg, fg, motif, genre: GENRES[g] }));
  const CATALOG_BY_ID = Object.fromEntries(CATALOG.map((b) => [b.id, b]));

  const USERS = {
    me: { id: "me", name: "Andrew P.", handle: "andrew.p", city: "Brooklyn, NY", rating: 5.0 },
    maya: { id: "maya", name: "Maya R.", handle: "mayareads", city: "Portland, OR", rating: 4.9 },
    jonah: { id: "jonah", name: "Jonah B.", handle: "jonahbinds", city: "Austin, TX", rating: 4.7 },
    priya: { id: "priya", name: "Priya S.", handle: "priyapages", city: "Chicago, IL", rating: 5.0 },
    theo: { id: "theo", name: "Theo T.", handle: "theo.t", city: "Denver, CO", rating: 4.8 },
    sam: { id: "sam", name: "Sam K.", handle: "samshelves", city: "Raleigh, NC", rating: 4.6 },
  };

  /* ---------------- data ----------------
     books     canonical metadata by ISBN (CATALOG + anything looked up from Open Library)
     copies    a physical book someone owns
     listings  a copy that is open for requests (closed when made unavailable or exchanged)
     requests  someone asking for a listing; holds 1 reserved credit
     exchanges fulfillment of an accepted request: ship, deliver, confirm
     ledger    append-only credit entries; balances are always computed from it
     payments  money: fee balance top-ups and captured fees */

  function blankState() {
    return {
      now: START, nextId: 500, pricing: "split",
      extraBooks: {}, copies: [], listings: [], requests: [], exchanges: [], ledger: [], payments: [], notes: [],
      wishlist: { me: [], maya: ["b13", "b3"], priya: ["b1", "b4"], jonah: ["b2", "b9"], theo: ["b2", "b5", "b9"], sam: ["b4", "b25", "b9", "b10"] },
      me: { name: "", photo: null, genres: [], address: null, card: null, strikes: 0, onboarded: false, welcome: "locked", ratings: {} },
    };
  }

  // fresh = a brand-new reader joining a marketplace that already has other readers' books.
  function seed(fresh) {
    const S = blankState();
    const t = START;
    if (!fresh) S.me = {
      name: "Andrew Penhollow", photo: null, genres: ["Literary", "Sci-fi & Fantasy"],
      address: { name: "Andrew Penhollow", line1: "214 Kent Ave, Apt 3R", city: "Brooklyn", state: "NY", zip: "11249" },
      card: { brand: "Visa", last4: "4242" }, strikes: 0, onboarded: true, welcome: "granted", ratings: {},
    };
    if (!fresh) S.wishlist.me = ["b7", "b9", "b10", "b11", "b23", "b25"];
    const C = (id, owner, bookId, cond, listed, format = "Paperback", flags = []) => {
      S.copies.push({ id, owner, bookId, cond, format, flags, addedAt: t - 25 * DAY });
      if (listed) S.listings.push({ id: "l" + id, copyId: id, openedAt: t - 20 * DAY + Number(id.slice(1)) * HOUR * 7, closedAt: null });
    };
    if (!fresh) {
      C("c1", "me", "b1", "ln", true, "Hardcover", ["Smoke-free home"]);
      C("c2", "me", "b2", "vg", true);
      C("c3", "me", "b4", "vg", true);
      C("c4", "me", "b13", "vg", true);
      C("c5", "me", "b5", "ln", false, "Hardcover");
      C("c6", "me", "b6", "good", false);
      C("c7", "me", "b15", "vg", false);
    }
    C("c20", "maya", "b9", "vg", true, "Paperback", ["Smoke-free home"]);
    C("c21", "maya", "b12", "ln", true, "Hardcover", ["Dust jacket included"]);
    C("c22", "maya", "b19", "good", true);
    C("c23", "maya", "b29", "vg", true);
    C("c24", "priya", "b10", "ln", true, "Hardcover", ["Dust jacket included"]);
    C("c25", "priya", "b21", "vg", true);
    C("c26", "priya", "b26", "vg", true);
    C("c27", "jonah", "b11", "good", true);
    C("c28", "jonah", "b22", "acc", true, "Paperback", ["Highlighting or notes"]);
    C("c29", "jonah", "b17", "vg", true);
    C("c30", "jonah", "b25", "vg", true, "Mass market");
    C("c31", "theo", "b14", "ln", true, "Hardcover");
    C("c32", "theo", "b18", "vg", true);
    C("c33", "theo", "b27", "good", true);
    C("c34", "sam", "b16", "new", true, "Hardcover");
    C("c35", "sam", "b20", "good", true, "Paperback", ["Ex-library"]);
    C("c36", "sam", "b24", "vg", true);
    C("c37", "sam", "b30", "vg", true);
    C("c38", "sam", "b28", "vg", true);
    C("c40", "jonah", "b3", "good", false);
    C("c42", "priya", "b8", "vg", false);
    if (fresh) return S;

    const L = (user, type, requestId, at, note) => S.ledger.push({ id: "e" + S.ledger.length, user, type, requestId, at, note });
    const P = (user, kind, amount, at, requestId, note) => S.payments.push({ id: "p" + S.payments.length, user, kind, amount, at, requestId, note });
    const R = (o) => { S.requests.push(Object.assign({ fees: { sender: 1, recipient: 1 }, log: [] }, o)); };
    const X = (o) => S.exchanges.push(Object.assign({ carrier: "USPS", tracking: null, shippedAt: null, deliveredAt: null, confirmedAt: null, completedAt: null }, o));

    P("me", "topup", 10, t - 21 * DAY, null, "Added to fee balance (Visa 4242)");
    L("me", "grant", null, t - 21 * DAY, "Welcome credit");

    // History: three finished exchanges.
    R({ id: "r0", listingId: "lc7x", copyId: "c7", bookId: "b15", sender: "sam", recipient: "me", at: t - 20 * DAY, status: "accepted",
      log: [{ at: t - 14 * DAY, text: "You confirmed Educated. Exchange complete." }] });
    X({ id: "x0", requestId: "r0", sender: "sam", recipient: "me", copyId: "c7", status: "complete", acceptedAt: t - 19 * DAY, shipBy: t - 16 * DAY, tracking: "9400 1118 9922 1102 5531 20", shippedAt: t - 18 * DAY, deliveredAt: t - 15 * DAY, confirmedAt: t - 14 * DAY, completedAt: t - 14 * DAY, rated: 5 });
    L("me", "reserve", "r0", t - 20 * DAY, "Requested Educated");
    L("me", "spend", "r0", t - 14 * DAY, "Received Educated from Sam");
    P("me", "fee", 1, t - 14 * DAY, "r0", "Fee for receiving Educated");

    R({ id: "r01", listingId: "lc40x", copyId: "c40", bookId: "b3", sender: "me", recipient: "jonah", at: t - 12 * DAY, status: "accepted",
      log: [{ at: t - 8 * DAY, text: "Jonah confirmed Circe. You earned 1 credit." }] });
    X({ id: "x01", requestId: "r01", sender: "me", recipient: "jonah", copyId: "c40", status: "complete", acceptedAt: t - 12 * DAY, shipBy: t - 9 * DAY, tracking: "9400 1118 9922 4410 0072 20", shippedAt: t - 11 * DAY, deliveredAt: t - 9 * DAY, confirmedAt: t - 8 * DAY, completedAt: t - 8 * DAY, rated: 5 });
    L("me", "earn", "r01", t - 8 * DAY, "Sent Circe to Jonah");
    P("me", "fee", 1, t - 8 * DAY, "r01", "Fee for sending Circe");

    R({ id: "r02", listingId: "lc42x", copyId: "c42", bookId: "b8", sender: "me", recipient: "priya", at: t - 9 * DAY, status: "accepted",
      log: [{ at: t - 5 * DAY, text: "Priya confirmed Lessons in Chemistry. You earned 1 credit." }] });
    X({ id: "x02", requestId: "r02", sender: "me", recipient: "priya", copyId: "c42", status: "complete", acceptedAt: t - 9 * DAY, shipBy: t - 6 * DAY, tracking: "9400 1118 9922 7781 3390 20", shippedAt: t - 8 * DAY, deliveredAt: t - 6 * DAY, confirmedAt: t - 5 * DAY, completedAt: t - 5 * DAY, rated: 4 });
    L("me", "earn", "r02", t - 5 * DAY, "Sent Lessons in Chemistry to Priya");
    P("me", "fee", 1, t - 5 * DAY, "r02", "Fee for sending Lessons in Chemistry");

    // Active: Babel is on its way to me.
    R({ id: "r1", listingId: "lc21", copyId: "c21", bookId: "b12", sender: "maya", recipient: "me", at: t - 2 * DAY, status: "accepted",
      log: [
        { at: t - 2 * DAY, text: "You requested Babel. 1 credit reserved." },
        { at: t - 1 * DAY, text: "Maya accepted and has 3 days to ship." },
        { at: t - 3 * HOUR, text: "Maya added USPS tracking 9400 1118 9922 3456 7781 20." },
      ] });
    X({ id: "x1", requestId: "r1", sender: "maya", recipient: "me", copyId: "c21", status: "shipped", acceptedAt: t - 1 * DAY, shipBy: t + 2 * DAY, tracking: "9400 1118 9922 3456 7781 20", shippedAt: t - 3 * HOUR });
    L("me", "reserve", "r1", t - 2 * DAY, "Requested Babel");

    // Active: Theo wants my Project Hail Mary.
    R({ id: "r2", listingId: "lc2", copyId: "c2", bookId: "b2", sender: "me", recipient: "theo", at: t - 5 * HOUR, status: "pending",
      log: [{ at: t - 5 * HOUR, text: "Theo requested Project Hail Mary." }] });

    // Active: I accepted Priya's request and still need to ship.
    R({ id: "r3", listingId: "lc1", copyId: "c1", bookId: "b1", sender: "me", recipient: "priya", at: t - 2 * DAY, status: "accepted",
      log: [
        { at: t - 2 * DAY, text: "Priya requested Tomorrow, and Tomorrow, and Tomorrow." },
        { at: t - 1 * DAY, text: "You accepted. Ship within 3 days." },
      ] });
    X({ id: "x3", requestId: "r3", sender: "me", recipient: "priya", copyId: "c1", status: "accepted", acceptedAt: t - 1 * DAY, shipBy: t + 2 * DAY });

    S.notes = [
      { id: "n1", at: t - 40 * 60e3, title: "Pachinko is available", body: "Maya listed a Very Good paperback. It's on your wishlist.", go: { listing: "lc20" }, read: false },
      { id: "n2", at: t - 3 * HOUR, title: "Babel is on its way", body: "Maya shipped it with USPS Media Mail. Usually 2 to 8 days.", go: { request: "r1" }, read: false },
      { id: "n3", at: t - 5 * HOUR, title: "Theo requested Project Hail Mary", body: "Accept within 48 hours, then ship within 3 days. You earn 1 credit when it arrives.", go: { request: "r2" }, read: false },
      { id: "n4", at: t - 5 * DAY, title: "You earned 1 credit", body: "Priya confirmed Lessons in Chemistry arrived.", go: { request: "r02" }, read: true },
    ];
    return S;
  }

  let S = load() || seed();
  const ui = { tab: "discover", shelf: "available", xTab: "ship", q: "", genre: "All", cond: "all", showAll: false, sheet: null, sheetEnter: false, toast: null, ob: 0, scanQ: "", scanned: [], defCond: "vg", cam: null };

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* storage blocked: demo still works for this visit */ }
  }
  const uid = (p) => p + S.nextId++;

  /* ---------------- lookups ---------------- */

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$" + n.toFixed(2);
  const bk = (id) => CATALOG_BY_ID[id] || S.extraBooks[id] || CATALOG[0];
  const copy = (id) => S.copies.find((c) => c.id === id);
  const listing = (id) => S.listings.find((l) => l.id === id);
  const openListing = (copyId) => S.listings.find((l) => l.copyId === copyId && !l.closedAt);
  const req = (id) => S.requests.find((r) => r.id === id);
  const exOf = (rid) => S.exchanges.find((x) => x.requestId === rid);
  const user = (id) => USERS[id];
  const first = (id) => (id === "me" ? "You" : user(id).name.split(" ")[0]);
  const onWishlist = (bookId) => S.wishlist.me.includes(bookId);
  const ACTIVE_X = ["accepted", "shipped", "delivered", "disputed"];
  const activeExchange = (copyId) => S.exchanges.find((x) => x.copyId === copyId && ACTIVE_X.includes(x.status));
  const isOpenReq = (r) => r.status === "pending" || (r.status === "accepted" && ACTIVE_X.includes((exOf(r.id) || {}).status));
  const requestable = (l) => l && !l.closedAt && !activeExchange(l.copyId);

  /* ---------------- credit ledger ----------------
     Each entry moves exactly one credit. Balances are derived, never stored. */

  const MOVES = { grant: [1, 0], earn: [1, 0], reserve: [-1, 1], release: [1, -1], spend: [0, -1], reverse: [-1, 0] };

  function balances(u = "me") {
    let available = 0, reserved = 0;
    S.ledger.forEach((e) => { if (e.user === u) { available += MOVES[e.type][0]; reserved += MOVES[e.type][1]; } });
    const pending = S.exchanges.filter((x) => x.sender === u && ["shipped", "delivered", "disputed"].includes(x.status)).length;
    return { available, reserved, pending };
  }

  // Guards against double-spending and duplicate awards: each request can reserve once,
  // then release OR spend once; each request can earn once.
  function post(u, type, requestId, note) {
    const has = (tp) => S.ledger.some((e) => e.user === u && e.requestId === requestId && e.type === tp);
    if (type === "reserve" && has("reserve")) return false;
    if ((type === "release" || type === "spend") && (!has("reserve") || has("release") || has("spend"))) return false;
    if (type === "earn" && has("earn")) return false;
    if (type === "reverse" && (!has("earn") || has("reverse"))) return false;
    if (type === "grant" && S.ledger.some((e) => e.user === u && e.type === "grant")) return false;
    S.ledger.push({ id: uid("e"), user: u, type, requestId, at: S.now, note });
    return true;
  }

  /* ---------------- fee balance ---------------- */

  function feeBalance() {
    return S.payments.filter((p) => p.user === "me").reduce((s, p) => s + (p.kind === "topup" ? p.amount : -p.amount), 0);
  }
  // Fees for open exchanges are set aside so the balance can't be promised twice.
  function feesHeld() {
    return S.requests.filter((r) => isOpenReq(r) && (r.recipient === "me" || (r.sender === "me" && r.status === "accepted")))
      .reduce((s, r) => s + (r.recipient === "me" ? r.fees.recipient : r.fees.sender), 0);
  }
  const feeFree = () => feeBalance() - feesHeld();
  const fees = () => PRICING[S.pricing];

  /* ---------------- helpers ---------------- */

  function fmtDay(ms) {
    return new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  function fmtStamp(ms) {
    const d = new Date(ms);
    return { day: d.toLocaleDateString("en-US", { month: "short" }).toUpperCase() + " " + d.getDate(), wd: d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase() };
  }
  function ago(ms) {
    const d = S.now - ms;
    if (d < HOUR) return Math.max(1, Math.round(d / 60e3)) + "m";
    if (d < DAY) return Math.round(d / HOUR) + "h";
    return Math.round(d / DAY) + "d";
  }
  function left(ms) {
    const d = ms - S.now;
    if (d <= 0) return "no time";
    if (d < DAY) return Math.round(d / HOUR) + " hours";
    const days = Math.floor(d / DAY);
    const hrs = Math.round((d - days * DAY) / HOUR);
    return days + (days === 1 ? " day" : " days") + (hrs ? " " + hrs + "h" : "");
  }
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  function notify(title, body, go) {
    S.notes.unshift({ id: uid("n"), at: S.now, title, body, go, read: false });
  }
  function log(r, text) {
    r.log.push({ at: S.now, text });
  }
  function toast(msg) {
    ui.toast = msg;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { ui.toast = null; render(); }, 2600);
  }
  const fakeTracking = () => "9400 1118 99" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0").replace(/(\d{2})(\d{4})(\d{2})/, "$1 $2 $3") + " 20";

  /* ---------------- welcome credit ----------------
     A controlled experiment: one credit, only after 3 available listings and a card on file. */

  function welcomeProgress() {
    const listed = S.listings.filter((l) => !l.closedAt && copy(l.copyId).owner === "me").length;
    return { listed: Math.min(listed, WELCOME_LISTINGS), card: !!S.me.card };
  }
  function checkWelcome() {
    if (S.me.welcome !== "locked") return;
    const p = welcomeProgress();
    if (p.listed >= WELCOME_LISTINGS && p.card && post("me", "grant", null, "Welcome credit")) {
      S.me.welcome = "granted";
      notify("Your welcome credit is ready", "Spend it on any available book.", { wallet: true });
      ui.sheet = { type: "celebrate", kind: "welcome" };
      ui.sheetEnter = true;
    }
  }

  /* ---------------- exchange rules ---------------- */

  // Combined view of a request and its exchange, from my side.
  function deal(r) {
    const x = exOf(r.id);
    const role = r.sender === "me" ? "sender" : "recipient";
    const other = role === "sender" ? r.recipient : r.sender;
    const stage = x ? x.status : r.status;
    return { r, x, role, other, stage, book: bk(r.bookId), copy: copy(r.copyId) };
  }
  const rated = (d) => S.me.ratings[d.r.id] || (d.x && d.x.rated);

  function stageInfo(d) {
    const p = first(d.other);
    const s = d.role === "sender";
    switch (d.stage) {
      case "pending": return s ? { cls: "s-act", text: p + " requested this" } : { cls: "", text: "Waiting on " + p + " to accept" };
      case "accepted": return s ? { cls: "s-warn", text: "Ship in " + left(d.x.shipBy) } : { cls: "", text: p + " is packing it" };
      case "shipped": return s ? { cls: "", text: "In the mail" } : { cls: "", text: "On its way to you" };
      case "delivered": return s ? { cls: "", text: "Delivered. Waiting on " + p } : { cls: "s-act", text: "Confirm it arrived" };
      case "disputed": return { cls: "s-warn", text: "Problem reported" };
      case "complete":
        if (!rated(d)) return { cls: "s-act", text: "Rate " + p };
        return s ? { cls: "s-ok", text: "Earned 1 credit" } : { cls: "s-ok", text: "Received" };
      case "declined": return { cls: "s-off", text: "Declined" };
      case "expired": return { cls: "s-off", text: "Expired" };
      case "withdrawn": return { cls: "s-off", text: "Cancelled" };
      case "cancelled": return { cls: "s-off", text: "Cancelled" };
    }
    return { cls: "", text: d.stage };
  }
  const isLive = (d) => ["pending", "accepted", "shipped", "delivered", "disputed"].includes(d.stage) || (d.stage === "complete" && !rated(d));
  const needsMe = (d) => {
    if (d.stage === "complete") return !rated(d);
    if (d.role === "sender") return d.stage === "pending" || d.stage === "accepted";
    return d.stage === "delivered";
  };
  const myDeals = () => S.requests.filter((r) => r.sender === "me" || r.recipient === "me").map(deal);

  function createRequest(listingId, recipient) {
    const l = listing(listingId);
    const c = copy(l.copyId);
    if (!requestable(l) || c.owner === recipient) return null;
    if (S.requests.some((r) => r.listingId === listingId && r.recipient === recipient && r.status === "pending")) return null;
    const r = { id: uid("r"), listingId, copyId: c.id, bookId: c.bookId, sender: c.owner, recipient, at: S.now, status: "pending", fees: { sender: fees().sender, recipient: fees().recipient }, log: [] };
    if (recipient === "me") {
      if (balances().available < 1 || feeFree() < r.fees.recipient) return null;
      post("me", "reserve", r.id, "Requested " + bk(c.bookId).title);
    }
    S.requests.push(r);
    log(r, (recipient === "me" ? "You" : first(recipient)) + " requested " + bk(c.bookId).title + ". 1 credit reserved.");
    return r;
  }

  function closeRequest(r, status, text) {
    r.status = status;
    log(r, text);
    if (r.recipient === "me") post("me", "release", r.id, "Credit returned: " + bk(r.bookId).title);
  }

  function acceptRequest(r) {
    if (r.status !== "pending" || activeExchange(r.copyId)) return null;
    r.status = "accepted";
    const x = { id: uid("x"), requestId: r.id, sender: r.sender, recipient: r.recipient, copyId: r.copyId, status: "accepted", acceptedAt: S.now, shipBy: S.now + SHIP_WINDOW, carrier: "USPS", tracking: null, shippedAt: null, deliveredAt: null, confirmedAt: null, completedAt: null };
    S.exchanges.push(x);
    log(r, (r.sender === "me" ? "You" : first(r.sender)) + " accepted. Ship by " + fmtDay(x.shipBy) + ".");
    // One copy, one exchange: other pending requests for the same copy are declined.
    S.requests.filter((o) => o !== r && o.copyId === r.copyId && o.status === "pending").forEach((o) => {
      closeRequest(o, "declined", "Declined automatically: this copy went to another reader.");
      if (o.recipient === "me") notify(bk(o.bookId).title + " went to someone else", "Your credit is back in your wallet.", { request: o.id });
    });
    return x;
  }

  function ship(x, carrier, tracking) {
    x.status = "shipped";
    x.carrier = carrier;
    x.tracking = tracking;
    x.shippedAt = S.now;
    log(req(x.requestId), (x.sender === "me" ? "You" : first(x.sender)) + " added " + carrier + " tracking " + tracking + ".");
  }

  function deliver(x) {
    x.status = "delivered";
    x.deliveredAt = S.now;
    log(req(x.requestId), "Delivered, according to " + x.carrier + " tracking.");
  }

  // Credits and fees settle together, once, when the recipient confirms (or 2 days pass).
  function complete(x, how) {
    if (x.status === "complete") return;
    const r = req(x.requestId);
    x.status = "complete";
    x.confirmedAt = S.now;
    x.completedAt = S.now;
    const title = bk(r.bookId).title;
    log(r, how);
    post(x.recipient, "spend", r.id, "Received " + title + " from " + first(x.sender));
    post(x.sender, "earn", r.id, "Sent " + title + " to " + first(x.recipient));
    if (x.recipient === "me" && r.fees.recipient) S.payments.push({ id: uid("p"), user: "me", kind: "fee", amount: r.fees.recipient, at: S.now, requestId: r.id, note: "Fee for receiving " + title });
    if (x.sender === "me" && r.fees.sender) S.payments.push({ id: uid("p"), user: "me", kind: "fee", amount: r.fees.sender, at: S.now, requestId: r.id, note: "Fee for sending " + title });
    // The copy now belongs to the recipient, unlisted until they choose to pass it on.
    const c = copy(x.copyId);
    c.owner = x.recipient;
    c.addedAt = S.now;
    const l = openListing(c.id);
    if (l) l.closedAt = S.now;
    if (x.recipient === "me") S.wishlist.me = S.wishlist.me.filter((b) => b !== c.bookId);
    if (x.sender === "me") {
      notify("You earned 1 credit", first(x.recipient) + " confirmed " + title + " arrived.", { request: r.id });
      ui.sheet = { type: "celebrate", kind: "earn", id: r.id };
      ui.sheetEnter = true;
    }
  }

  function cancelExchange(x, text, outcome) {
    const r = req(x.requestId);
    x.status = "cancelled";
    x.outcome = outcome;
    log(r, text);
    if (x.recipient === "me") post("me", "release", r.id, "Credit returned: " + bk(r.bookId).title);
  }

  // Runs every hour of demo time: expiries, reminders, missed ship windows, lost packages, auto-confirm.
  function tick() {
    S.requests.forEach((r) => {
      if (r.status === "pending" && S.now >= r.at + REQUEST_TTL) {
        closeRequest(r, "expired", "Expired: not accepted within 48 hours.");
        if (r.recipient === "me") notify("Request expired", first(r.sender) + " didn't respond about " + bk(r.bookId).title + ". Your credit is back.", { request: r.id });
        if (r.sender === "me") notify("Request expired", "You didn't respond to " + first(r.recipient) + " about " + bk(r.bookId).title + ".", { request: r.id });
      }
    });
    S.exchanges.forEach((x) => {
      const r = req(x.requestId);
      const title = bk(r.bookId).title;
      if (x.status === "accepted") {
        if (x.sender === "me" && !x.reminded && x.shipBy - S.now <= DAY && S.now < x.shipBy) {
          x.reminded = true;
          notify("24 hours left to ship", "Add tracking for " + title + " by " + fmtDay(x.shipBy) + ".", { request: r.id });
        }
        if (S.now >= x.shipBy) {
          if (x.sender === "me") S.me.strikes++;
          const outcome = x.sender === "me"
            ? "You didn't ship within 3 days. " + first(x.recipient) + "'s credit was returned and your account got a strike. 3 strikes in 6 months pauses requests."
            : first(x.sender) + " didn't ship within 3 days. Your credit is back in your wallet and nothing was charged.";
          cancelExchange(x, "Cancelled: no tracking within 3 days.", outcome);
          notify("Exchange cancelled", outcome, { request: r.id });
        }
      }
      if (x.status === "shipped" && S.now >= x.shippedAt + LOST_AFTER) {
        const outcome = "Tracking hasn't shown a delivery in 10 days, so we've marked this lost. " + (x.recipient === "me" ? "Your credit is back." : "No credit was earned. If you bought insurance, file a claim with the carrier.");
        cancelExchange(x, "Cancelled: lost in the mail.", outcome);
        notify(title + " looks lost", outcome, { request: r.id });
      }
      if (x.status === "delivered" && S.now >= x.deliveredAt + CONFIRM_WINDOW) {
        complete(x, "Confirmed automatically 2 days after delivery.");
      }
    });
  }

  /* ---------------- pieces ---------------- */

  const ICONS = {
    discover: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    shelf: '<path d="M4 4h3v16H4zM9 4h3v16H9z"/><path d="m14.5 5.2 2.9-.8 3.6 14.6-2.9.8z"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 8v8M11 8v8M14 8v8M17 8v8"/>',
    exchanges: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    credit: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  };
  const icon = (n, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

  function cover(b, cls = "") {
    return `<div class="cover-wrap"><div class="cover m${b.motif} ${cls}" style="background:${b.bg};color:${b.fg}" role="img" aria-label="Cover of ${esc(b.title)}">
      <span class="c-mark"></span>
      <span class="c-title">${esc(b.title)}</span>
      <span class="c-author">${esc(b.author)}</span>
    </div></div>`;
  }

  function listingTile(l) {
    const c = copy(l.copyId);
    const b = bk(c.bookId);
    const busy = activeExchange(c.id);
    const tags = [`<span class="cond">${COND[c.cond].short}</span>`];
    if (busy) tags.push('<span class="cond off">IN AN EXCHANGE</span>');
    else if (onWishlist(b.id) && c.owner !== "me") tags.push('<span class="cond wish">WISHLIST</span>');
    const owner = c.owner === "me" ? "" : `<span>@${esc(user(c.owner).handle)}</span>`;
    return `<button class="book ${busy ? "dim" : ""}" data-act="openListing" data-id="${l.id}">
      <div class="book-cover-box">${cover(b)}</div>
      <span class="b-title">${esc(b.title)}</span>
      <span class="b-meta">${tags.join("")}${owner}</span>
    </button>`;
  }

  function copyTile(c) {
    const b = bk(c.bookId);
    const busy = activeExchange(c.id);
    return `<button class="book" data-act="openCopy" data-id="${c.id}">
      <div class="book-cover-box">${cover(b)}</div>
      <span class="b-title">${esc(b.title)}</span>
      <span class="b-meta"><span class="cond">${COND[c.cond].short}</span>${busy ? '<span class="cond wish">IN AN EXCHANGE</span>' : ""}</span>
    </button>`;
  }

  function wishTile(bookId) {
    const b = bk(bookId);
    const avail = S.listings.filter((l) => requestable(l) && copy(l.copyId).bookId === bookId && copy(l.copyId).owner !== "me").length;
    return `<button class="book" data-act="openBook" data-id="${bookId}">
      <div class="book-cover-box">${cover(b)}</div>
      <span class="b-title">${esc(b.title)}</span>
      <span class="b-meta">${avail ? `<span class="cond wish">${avail} AVAILABLE</span>` : "<span>Watching</span>"}</span>
    </button>`;
  }

  function stampHTML(ms, label = "SHIP BY") {
    const s = fmtStamp(ms);
    return `<span class="stamp ${ms - S.now < DAY ? "late" : ""}"><small>${label}</small><b>${s.day}</b><small>${s.wd}</small></span>`;
  }

  function dealCard(d) {
    const st = stageInfo(d);
    const dir = d.role === "sender" ? `To ${esc(user(d.other).name)}` : `From ${esc(user(d.other).name)}`;
    const stamp = d.stage === "accepted" && d.role === "sender" ? stampHTML(d.x.shipBy) : "";
    return `<button class="card tap ${needsMe(d) ? "attn" : ""}" data-act="openDeal" data-id="${d.r.id}">
      <div class="deal-row">
        ${cover(d.book)}
        <div class="who"><strong>${esc(d.book.title)}</strong><span>${dir} · ★ ${user(d.other).rating.toFixed(1)}</span><span class="status ${st.cls}">${esc(st.text)}</span></div>
        ${stamp}
      </div>
    </button>`;
  }

  function creditPill() {
    const b = balances();
    return `<button class="credit-pill" data-act="wallet" aria-label="${plural(b.available, "credit")} available">${icon("credit", 16)}<b>${b.available}</b><span>${b.available === 1 ? "credit" : "credits"}</span></button>`;
  }

  /* ---------------- views ---------------- */

  const discoverPool = () => S.listings.filter((l) => !l.closedAt && copy(l.copyId).owner !== "me");

  function viewDiscover() {
    return `<div class="view">
      <label class="search" for="q">${icon("search", 18)}<input id="q" type="search" placeholder="Title, author, or ISBN" value="${esc(ui.q)}" autocomplete="off"></label>
      <div id="results">${discoverResults()}</div>
    </div>`;
  }

  function trendScore(bookId) {
    const wants = Object.values(S.wishlist).filter((w) => w.includes(bookId)).length;
    const asks = S.requests.filter((r) => r.bookId === bookId && S.now - r.at < 14 * DAY).length;
    return wants * 2 + asks;
  }

  function discoverResults() {
    const pool = discoverPool();
    const avail = pool.filter(requestable);
    const q = ui.q.trim().toLowerCase();
    if (q) {
      const hits = pool.filter((l) => {
        const b = bk(copy(l.copyId).bookId);
        return (b.title + " " + b.author + " " + b.isbn).toLowerCase().includes(q);
      });
      return `<div class="section"><p class="eyebrow">${hits.length} found</p>${
        hits.length ? `<div class="grid">${hits.map(listingTile).join("")}</div>` : `<div class="empty"><h3>Nobody has listed that yet</h3><p>Find it under Scan and add it to your wishlist. We'll tell you the moment someone lists it.</p><button class="btn ghost sm" data-act="tab" data-id="scan">Search all books</button></div>`
      }</div>`;
    }
    let html = welcomeBanner();
    const b = balances();
    if (b.available > 0) {
      html += `<p class="ready">You have ${plural(b.available, "credit")}. ${plural(avail.length, "book")} ${avail.length === 1 ? "is" : "are"} ready for you to discover.</p>`;
    }
    const wished = avail.filter((l) => onWishlist(copy(l.copyId).bookId));
    if (wished.length) {
      html += `<div class="section">
        <div class="section-head"><h2>From your wishlist</h2><span class="eyebrow">${wished.length} available</span></div>
        <div class="rail">${wished.map(listingTile).join("")}</div>
      </div>`;
    }
    const trending = avail.slice().sort((a, z) => trendScore(copy(z.copyId).bookId) - trendScore(copy(a.copyId).bookId)).slice(0, 6);
    html += `<div class="section">
      <div class="section-head"><h2>Trending</h2><span class="eyebrow">Most wanted</span></div>
      <div class="rail">${trending.map(listingTile).join("")}</div>
    </div>`;
    const genres = ["All"].concat(GENRES);
    const conds = ["all", "ln", "vg", "good"];
    let recent = (ui.showAll ? pool : avail).slice().sort((a, z) => z.openedAt - a.openedAt);
    if (ui.genre !== "All") recent = recent.filter((l) => bk(copy(l.copyId).bookId).genre === ui.genre);
    if (ui.cond !== "all") {
      const max = CONDITIONS.findIndex((c) => c.id === ui.cond);
      recent = recent.filter((l) => CONDITIONS.findIndex((c) => c.id === copy(l.copyId).cond) <= max);
    }
    html += `<div class="section">
      <div class="section-head"><h2>Recently listed</h2></div>
      <div class="chips scroll" role="group" aria-label="Genre">${genres.map((g) => `<button class="chip" data-act="genre" data-id="${esc(g)}" aria-pressed="${ui.genre === g}">${esc(g)}</button>`).join("")}</div>
      <div class="chips" role="group" aria-label="Condition and availability">
        ${conds.map((c) => `<button class="chip sm" data-act="cond" data-id="${c}" aria-pressed="${ui.cond === c}">${c === "all" ? "Any condition" : COND[c].label + " +"}</button>`).join("")}
        <button class="chip sm" data-act="showAll" aria-pressed="${ui.showAll}">Include books in exchanges</button>
      </div>
      ${recent.length ? `<div class="grid">${recent.map(listingTile).join("")}</div>` : '<p class="lede">No books match these filters yet.</p>'}
    </div>`;
    return html;
  }

  function welcomeBanner() {
    if (S.me.welcome !== "locked") return "";
    const p = welcomeProgress();
    return `<button class="card tap welcome" data-act="${p.listed < WELCOME_LISTINGS ? "tab" : "addCard"}" data-id="scan">
      <p class="eyebrow">Your first book is on us</p>
      <strong>List ${WELCOME_LISTINGS} books and add a card to get a welcome credit.</strong>
      <span class="checks">
        <span class="${p.listed >= WELCOME_LISTINGS ? "done" : ""}">${p.listed}/${WELCOME_LISTINGS} books available</span>
        <span class="${p.card ? "done" : ""}">${p.card ? "Card added" : "Add a card"}</span>
      </span>
    </button>`;
  }

  function viewShelf() {
    const mine = S.copies.filter((c) => c.owner === "me");
    const avail = mine.filter((c) => openListing(c.id));
    const unavail = mine.filter((c) => !openListing(c.id));
    const wish = S.wishlist.me;
    const tabs = [["available", "Available", avail.length], ["unavailable", "Not available", unavail.length], ["wish", "Wishlist", wish.length]];
    let body;
    if (ui.shelf === "available") {
      body = avail.length
        ? `<p class="lede">Anyone can request these. You earn 1 credit for each one that reaches its new reader.</p><div class="grid">${avail.map(copyTile).join("")}</div>`
        : `<div class="empty"><h3>Nothing available yet</h3><p>Scan the books you've finished. Each one you send earns a credit.</p><button class="btn primary sm" data-act="tab" data-id="scan">Scan books</button></div>`;
    } else if (ui.shelf === "unavailable") {
      body = unavail.length
        ? `<p class="lede">Your library. Hidden from Discover until you make them available.</p><div class="grid">${unavail.map(copyTile).join("")}</div>`
        : `<div class="empty"><h3>Nothing here</h3><p>Books you keep, and books you receive, land here.</p></div>`;
    } else {
      body = wish.length
        ? `<p class="lede">You get an alert the moment someone lists one of these.</p><div class="grid">${wish.map(wishTile).join("")}</div>`
        : `<div class="empty"><h3>Your wishlist is empty</h3><p>Tap any book in Discover and add it.</p></div>`;
    }
    return `<div class="view">
      <div class="section-head"><h2 class="page-title">My Shelf</h2><button class="btn primary sm" data-act="tab" data-id="scan">Add books</button></div>
      <div class="seg" role="group">${tabs.map(([id, label, n]) => `<button data-act="shelfTab" data-id="${id}" aria-pressed="${ui.shelf === id}">${label}<span class="count">${n}</span></button>`).join("")}</div>
      ${body}
    </div>`;
  }

  function scanMatches(raw) {
    const q = raw.trim().toLowerCase();
    const digits = q.replace(/[^0-9x]/g, "");
    const hits = q ? CATALOG.filter((b) => (b.title + " " + b.author + " " + b.isbn).toLowerCase().includes(q)).slice(0, 6) : [];
    const isbn = /^(97[89])?\d{9}[\dx]$/.test(digits) && !hits.length ? digits : null;
    return scanResults(hits, isbn);
  }

  function viewScan() {
    const camMsg = ui.cam === "unsupported" || ui.cam === "denied" ? "Camera isn't available here. Tap to simulate a scan." : "Tap to start scanning";
    return `<div class="view">
      <h2 class="page-title">Scan</h2>
      <button class="viewfinder" data-act="camera" aria-label="Scan a barcode">
        <span class="corners"></span>
        <span class="beam"></span>
        <span class="vf-text"><strong>Point at the barcode on the back cover</strong><small>${camMsg}</small></span>
      </button>
      <div class="section">
        <p class="eyebrow">New scans start as</p>
        <div class="chips">${CONDITIONS.map((c) => `<button class="chip sm" data-act="defCond" data-id="${c.id}" aria-pressed="${ui.defCond === c.id}">${c.label}</button>`).join("")}</div>
        <p class="lede">Every scan goes straight onto your shelf as available. Change any condition below.</p>
      </div>
      ${ui.scanned.length ? `<div class="section">
        <div class="section-head"><h2>Just added</h2><span class="eyebrow">${ui.scanned.length} books</span></div>
        <div class="list">${ui.scanned.map(scanRow).join("")}</div>
      </div>` : ""}
      <div class="section">
        <p class="eyebrow">No barcode? Search instead</p>
        <label class="search" for="scanq">${icon("search", 18)}<input id="scanq" type="search" placeholder="Title, author, or ISBN" value="${esc(ui.scanQ)}" autocomplete="off"></label>
        <div id="scanResults" class="list">${scanMatches(ui.scanQ)}</div>
      </div>
    </div>`;
  }
  function scanResults(hits, isbn) {
    if (isbn) return `<button class="btn ghost" data-act="lookupIsbn" data-id="${esc(isbn)}">Look up ISBN ${esc(isbn)}</button>`;
    return hits.map((b) => `<div class="result-row"><div class="mini">${cover(b)}</div><div class="grow"><strong>${esc(b.title)}</strong><p class="lede">${esc(b.author)}, ${b.year}</p></div><button class="btn ghost sm" data-act="addFromSearch" data-id="${b.id}">Add</button><button class="btn ghost sm" data-act="wish" data-id="${b.id}">${onWishlist(b.id) ? "Wished ✓" : "Wish"}</button></div>`).join("");
  }
  function scanRow(cid) {
    const c = copy(cid);
    if (!c || c.owner !== "me") return "";
    const b = bk(c.bookId);
    const on = !!openListing(c.id);
    return `<div class="scan-row">
      <div class="mini">${cover(b)}</div>
      <div class="grow">
        <strong>${esc(b.title)}</strong>
        <div class="cond-pick">${CONDITIONS.map((k) => `<button data-act="setCond" data-id="${c.id}" data-c="${k.id}" aria-pressed="${c.cond === k.id}">${k.short}</button>`).join("")}</div>
      </div>
      <button class="toggle" data-act="toggleListing" data-id="${c.id}" aria-pressed="${on}" aria-label="Available for exchange"><span></span></button>
    </div>`;
  }

  function viewExchanges() {
    const ds = myDeals();
    const order = (a, b) => needsMe(b) - needsMe(a) || b.r.at - a.r.at;
    const lists = {
      ship: ds.filter((d) => d.role === "sender" && isLive(d)).sort(order),
      incoming: ds.filter((d) => d.role === "recipient" && isLive(d)).sort(order),
      past: ds.filter((d) => !isLive(d)).sort((a, b) => b.r.at - a.r.at),
    };
    const list = lists[ui.xTab];
    const empty = {
      ship: ["Nothing to send", "When someone requests a book from your shelf, it shows up here."],
      incoming: ["Nothing on its way", "Spend a credit on a book in Discover."],
      past: ["No history yet", "Finished, declined and cancelled exchanges land here."],
    }[ui.xTab];
    return `<div class="view">
      <h2 class="page-title">Exchanges</h2>
      <div class="seg" role="group">
        <button data-act="xTab" data-id="ship" aria-pressed="${ui.xTab === "ship"}">To send<span class="count">${lists.ship.length}</span></button>
        <button data-act="xTab" data-id="incoming" aria-pressed="${ui.xTab === "incoming"}">Coming to me<span class="count">${lists.incoming.length}</span></button>
        <button data-act="xTab" data-id="past" aria-pressed="${ui.xTab === "past"}">History<span class="count">${lists.past.length}</span></button>
      </div>
      ${list.length ? `<div class="list">${list.map(dealCard).join("")}</div>` : `<div class="empty"><h3>${empty[0]}</h3><p>${empty[1]}</p></div>`}
    </div>`;
  }

  function viewProfile() {
    const a = S.me.address;
    const b = balances();
    const mineDone = S.exchanges.filter((x) => x.status === "complete" && (x.sender === "me" || x.recipient === "me"));
    const sent = mineDone.filter((x) => x.sender === "me").length;
    return `<div class="view">
      <div class="profile-head">
        ${avatar()}
        <div><h2 class="page-title" style="font-size:var(--t-xl)">${esc(S.me.name || "New reader")}</h2><p class="lede">@${esc(USERS.me.handle)} · ★ 5.0${S.me.genres.length ? " · " + S.me.genres.map(esc).join(", ") : ""}</p></div>
      </div>
      <button class="card tap wallet-card" data-act="wallet">
        <span class="row"><span class="grow"><span class="eyebrow">Book credits</span><span class="big-num">${b.available}</span></span>${icon("arrow", 20)}</span>
        <span class="mini-stats"><span><b>${b.reserved}</b> reserved</span><span><b>${b.pending}</b> pending</span><span><b>${mineDone.length}</b> exchanges</span></span>
      </button>
      <div class="stats">
        <div class="stat"><b>${sent}</b><span>books sent</span></div>
        <div class="stat"><b>${mineDone.length - sent}</b><span>received</span></div>
        <div class="stat"><b>${money(feeFree())}</b><span>fee balance</span></div>
      </div>
      ${S.me.strikes ? `<p class="note warn"><strong>${plural(S.me.strikes, "strike")}.</strong> Missing a ship window adds one. 3 in 6 months pauses requests.</p>` : ""}
      <div class="section">
        <p class="eyebrow">Shipping address</p>
        <div class="card">
          ${a ? `<p>${esc(a.name)}<br>${esc(a.line1)}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}</p>` : '<p class="lede">No address yet. You\'ll add one the first time you request a book.</p>'}
          <p class="lede">Only shared with a reader while one of you is sending the other a book.</p>
          <button class="btn ghost sm" data-act="editAddress">${a ? "Edit address" : "Add address"}</button>
        </div>
      </div>
      <div class="section">
        <p class="eyebrow">Payment</p>
        <div class="card">
          <div class="kv">
            <div><span class="k">Card</span><span class="v">${S.me.card ? esc(S.me.card.brand) + " ending " + esc(S.me.card.last4) : "None"}</span></div>
            <div><span class="k">Fee to receive a book</span><span class="v">${money(fees().recipient)}</span></div>
            <div><span class="k">Fee to send a book</span><span class="v">${money(fees().sender)} + your postage</span></div>
          </div>
          <div class="btns">${S.me.card ? `<button class="btn ghost sm" data-act="topup">Add to fee balance</button>` : `<button class="btn primary sm" data-act="addCard">Add a card</button>`}</div>
          <p class="lede">Payments go through Stripe in the real app. This demo charges nothing.</p>
        </div>
      </div>
      <div class="section">
        <p class="eyebrow">Help</p>
        <div class="card">
          <button class="link" data-act="how">How Shelf Swap works</button>
          <button class="link" data-act="shipping">How to ship a book</button>
          <button class="link" data-act="conditions">Condition guide</button>
          <button class="link" data-act="replayOnboarding">Replay onboarding</button>
        </div>
      </div>
    </div>`;
  }

  function avatar(cls = "") {
    const initial = ((S.me.name || "?").trim()[0] || "?").toUpperCase();
    return S.me.photo ? `<img class="avatar ${cls}" src="${S.me.photo}" alt="">` : `<div class="avatar ${cls}">${esc(initial)}</div>`;
  }

  /* ---------------- onboarding ---------------- */

  function viewOnboarding() {
    const step = ui.ob;
    const dots = `<div class="ob-dots" aria-label="Step ${step + 1} of 4">${[0, 1, 2, 3].map((i) => `<span class="${i <= step ? "on" : ""}"></span>`).join("")}</div>`;
    let body = "";
    if (step === 0) {
      body = `<h1 class="ob-title">Your bookshelf is full of books someone else wants.</h1>
        <p class="ob-lede">Shelf Swap turns them into your next great read.</p>
        <div class="row">${avatar("lg")}<label class="btn ghost sm" for="photo">Add a photo</label><input id="photo" type="file" accept="image/*" hidden></div>
        <div class="field"><label for="ob-name">Your name</label><input id="ob-name" value="${esc(S.me.name)}" autocomplete="name" placeholder="First and last name"></div>
        <button class="btn primary" data-act="obNext">Continue</button>`;
    } else if (step === 1) {
      body = `<h1 class="ob-title">What do you like to read?</h1>
        <p class="ob-lede">We'll put the right books in front of you.</p>
        <div class="chips">${GENRES.map((g) => `<button class="chip" data-act="obGenre" data-id="${esc(g)}" aria-pressed="${S.me.genres.includes(g)}">${esc(g)}</button>`).join("")}</div>
        <button class="btn primary" data-act="obNext">Continue</button>`;
    } else if (step === 2) {
      const picks = CATALOG.filter((b) => !S.me.genres.length || S.me.genres.includes(b.genre)).slice(0, 9);
      body = `<h1 class="ob-title">Any books you're hoping to read?</h1>
        <p class="ob-lede">Tap a few. We'll alert you when someone lists one.</p>
        <div class="pick">${picks.map((b) => `<button class="book" data-act="obWish" data-id="${b.id}" aria-pressed="${onWishlist(b.id)}"><div class="book-cover-box">${cover(b)}</div><span class="b-title">${esc(b.title)}</span></button>`).join("")}</div>
        <button class="btn primary" data-act="obNext">Continue</button>`;
    } else {
      const steps = [
        ["List", "Scan the books you've finished. Anyone can request them."],
        ["Earn", "Ship a requested book. When it arrives, you earn 1 credit."],
        ["Discover", "Browse books from readers across the US."],
        ["Request", "Spend 1 credit + " + money(fees().recipient) + " on any available book, from anyone. You never need to want each other's books."],
      ];
      body = `<h1 class="ob-title">How it works</h1>
        <ol class="loop">${steps.map(([h, p]) => `<li><strong>${h}</strong><span>${p}</span></li>`).join("")}</ol>
        <p class="note stamped">List ${WELCOME_LISTINGS} books and add a card, and your first credit is on us.</p>
        <button class="btn primary" data-act="obDone">Scan my first books</button>`;
    }
    return `<div class="view onboarding">${dots}${body}${step > 0 ? '<button class="link" data-act="obBack">Back</button>' : ""}</div>`;
  }

  /* ---------------- sheets ---------------- */

  function costBox(c) {
    return `<div class="cost">
      <div class="cost-main"><span>1 credit</span><span class="plus">+</span><span>${money(fees().recipient)} fee</span></div>
      <p class="lede">${esc(first(c.owner))} pays postage and ships with USPS Media Mail, usually 2 to 8 days. Your credit is only spent once the book arrives.</p>
    </div>`;
  }

  function sheetListing(s) {
    const l = listing(s.id);
    const c = copy(l.copyId);
    const b = bk(c.bookId);
    const bal = balances();
    const busy = activeExchange(c.id);
    const mine = c.owner === "me";
    const o = mine ? null : user(c.owner);
    const already = S.requests.some((r) => r.listingId === l.id && r.recipient === "me" && r.status === "pending");
    let cta;
    if (mine) cta = `<button class="btn ghost" data-act="openCopy" data-id="${c.id}">Manage this copy</button>`;
    else if (l.closedAt) cta = `<button class="btn primary" disabled>No longer available</button>`;
    else if (busy) cta = `<button class="btn primary" disabled>In an exchange right now</button>`;
    else if (already) cta = `<button class="btn primary" disabled>Requested. Waiting on ${esc(first(c.owner))}</button>`;
    else if (bal.available < 1) cta = `<button class="btn primary" disabled>You need 1 credit</button><p class="lede">Send a book from your shelf to earn one.${S.me.welcome === "locked" ? " Or list " + WELCOME_LISTINGS + " books and add a card for a welcome credit." : ""}</p>`;
    else cta = `<button class="btn primary" data-act="request" data-id="${l.id}">Request this book</button>`;
    return `
      <div class="detail">
        ${cover(b, "lg")}
        <div>
          <h3>${esc(b.title)}</h3>
          <p class="by">${esc(b.author)}${b.year ? ", " + b.year : ""}</p>
          <div class="facts">
            <div><span>Condition</span> <strong>${COND[c.cond].label}</strong></div>
            <div><span>Format</span> ${esc(c.format)}</div>
            ${c.flags.length ? `<div><span>Notes</span> ${c.flags.map(esc).join(", ")}</div>` : ""}
            <div><span>Genre</span> ${esc(b.genre)}</div>
            <div class="isbn">ISBN ${b.isbn}</div>
          </div>
        </div>
      </div>
      <p class="note">${COND[c.cond].label}: ${COND[c.cond].desc}</p>
      ${o ? `<div class="row"><div class="avatar sm">${o.name[0]}</div><div class="grow"><strong>${esc(o.name)}</strong> <span class="lede">@${esc(o.handle)}</span><p class="lede">★ ${o.rating.toFixed(1)} · ships from ${esc(o.city)}</p></div></div>` : ""}
      ${o ? costBox(c) : ""}
      ${cta}
      ${o ? `<button class="btn ghost" data-act="wish" data-id="${b.id}">${onWishlist(b.id) ? "On your wishlist ✓" : "Add to wishlist"}</button>` : ""}
    `;
  }

  function sheetBook(s) {
    const b = bk(s.id);
    const avail = S.listings.filter((l) => requestable(l) && copy(l.copyId).bookId === b.id && copy(l.copyId).owner !== "me");
    return `
      <div class="detail">
        ${cover(b, "lg")}
        <div><h3>${esc(b.title)}</h3><p class="by">${esc(b.author)}${b.year ? ", " + b.year : ""}</p><p class="isbn" style="margin-top:8px">ISBN ${b.isbn}</p></div>
      </div>
      ${avail.length
        ? `<div class="section"><p class="eyebrow">Available copies</p><div class="list">${avail.map((l) => { const c = copy(l.copyId); return `<button class="card tap" data-act="openListing" data-id="${l.id}"><span class="row"><span class="cond">${COND[c.cond].short}</span><span class="grow">${esc(c.format)} · @${esc(user(c.owner).handle)}</span><span class="lede">★ ${user(c.owner).rating.toFixed(1)}</span></span></button>`; }).join("")}</div></div>`
        : `<p class="note">Nobody has listed this yet. You'll get an alert when someone does.</p>`}
      <button class="btn ghost" data-act="wish" data-id="${b.id}">${onWishlist(b.id) ? "Remove from wishlist" : "Add to wishlist"}</button>
    `;
  }

  function sheetRequest(s) {
    const l = listing(s.id);
    const c = copy(l.copyId);
    const b = bk(c.bookId);
    const bal = balances();
    const fee = fees().recipient;
    const a = S.me.address;
    const feeOk = feeFree() >= fee;
    return `
      <div class="deal-row">${cover(b)}<div class="who"><strong>${esc(b.title)}</strong><span>${COND[c.cond].label} ${esc(c.format.toLowerCase())} from ${esc(user(c.owner).name)}</span></div></div>
      <div class="card">
        <div class="kv">
          <div><span class="k">Credits</span><span class="v">${bal.available} → <strong>${bal.available - 1}</strong> available, 1 reserved</span></div>
          <div><span class="k">Marketplace fee</span><span class="v">${money(fee)} from your fee balance (${money(feeFree())})</span></div>
          <div><span class="k">Ship to</span><span class="v">${a ? `${esc(a.name)}<br>${esc(a.line1)}, ${esc(a.city)} ${esc(a.state)} ${esc(a.zip)}` : "No address yet"}</span></div>
        </div>
        <button class="link" data-act="editAddress" data-back="${l.id}">${a ? "Change address" : "Add a US shipping address"}</button>
      </div>
      ${!feeOk ? `<p class="note warn">Your fee balance is ${money(feeFree())}. Add ${S.me.card ? "funds" : "a card"} to cover the ${money(fee)} fee.</p><button class="btn ghost" data-act="${S.me.card ? "topup" : "addCard"}" data-back="${l.id}">${S.me.card ? "Add to fee balance" : "Add a card"}</button>` : ""}
      <p class="lede">${esc(first(c.owner))} has 48 hours to accept, then 3 days to ship. If either doesn't happen, your credit comes straight back. The fee is only taken when the book arrives.</p>
      <button class="btn primary" data-act="sendRequest" data-id="${l.id}" ${a && feeOk ? "" : "disabled"}>Request for 1 credit</button>
    `;
  }

  function progress(d) {
    const steps = ["Requested", "Accepted", "Shipped", "Delivered", "Complete"];
    const at = { pending: 0, accepted: 1, shipped: 2, delivered: 3, disputed: 3, complete: 4 }[d.stage];
    if (at == null) return "";
    return `<ol class="progress">${steps.map((s, i) => `<li class="${i <= at ? "on" : ""}${i === at ? " now" : ""}"><span></span>${s}</li>`).join("")}</ol>`;
  }

  function sheetDeal(s) {
    const r = req(s.id);
    const d = deal(r);
    const x = d.x;
    const p = first(d.other);
    const st = stageInfo(d);
    const c = d.copy;
    const creditLine = d.role === "sender"
      ? `<p class="credit-line">${icon("credit", 16)} You earn 1 credit when ${esc(p)} confirms it arrived.</p>`
      : `<p class="credit-line">${icon("credit", 16)} 1 credit reserved. It's spent when the book arrives.</p>`;
    let main;

    if (d.stage === "pending" && d.role === "sender") {
      main = `<p class="note stamped">${esc(p)} wants your ${COND[c.cond].label} copy of <strong>${esc(d.book.title)}</strong>. Accept within ${left(r.at + REQUEST_TTL)}, then ship within 3 days.</p>
        ${creditLine}
        <div class="btns"><button class="btn primary" data-act="accept" data-id="${r.id}">Accept</button><button class="btn ghost" data-act="decline" data-id="${r.id}">Decline</button></div>
        <p class="lede">You pay the postage (about $4 to $5 with USPS Media Mail)${r.fees.sender ? " and a " + money(r.fees.sender) + " fee once it arrives" : ""}.</p>`;
    } else if (d.stage === "pending") {
      main = `<p class="note">Waiting on ${esc(p)}. They have ${left(r.at + REQUEST_TTL)} to accept.</p>${creditLine}
        <button class="btn danger" data-act="withdraw" data-id="${r.id}">Cancel request</button>`;
    } else if (d.stage === "accepted" && d.role === "sender") {
      main = `<div class="row"><div class="grow"><strong>Ship it to ${esc(p)}</strong><p class="lede">${left(x.shipBy)} left to add tracking.</p></div>${stampHTML(x.shipBy)}</div>
        ${creditLine}
        <div class="card"><p class="eyebrow">Ship to</p><p>${esc(user(d.other).name)}<br>${esc(user(d.other).city)}</p><p class="lede">The full street address shows here in the real app, only while you're shipping to them.</p></div>
        <button class="btn primary" data-act="addTracking" data-id="${r.id}">I've shipped it: add tracking</button>
        <button class="link" data-act="shipping">How to ship a book</button>`;
    } else if (d.stage === "accepted") {
      main = `<p class="note">${esc(p)} accepted and has until ${fmtDay(x.shipBy)} to ship.</p>${creditLine}`;
    } else if (d.stage === "shipped") {
      main = `<div class="card"><p class="eyebrow">Tracking</p><p class="mono">${esc(x.carrier)} ${esc(x.tracking)}</p><p class="lede">Shipped ${fmtDay(x.shippedAt)}. We check tracking automatically.</p></div>${creditLine}`;
    } else if (d.stage === "delivered" && d.role === "recipient") {
      main = `<p class="note stamped">${esc(d.book.title)} was delivered. Does it match the listing (${COND[c.cond].label}${c.flags.length ? ", " + c.flags.map(esc).join(", ").toLowerCase() : ""})? It confirms automatically in ${left(x.deliveredAt + CONFIRM_WINDOW)}.</p>
        <div class="btns"><button class="btn primary" data-act="confirmBook" data-id="${r.id}">It arrived. Looks right</button><button class="btn ghost" data-act="report" data-id="${r.id}">Report a problem</button></div>`;
    } else if (d.stage === "delivered") {
      main = `<p class="note">Delivered ${fmtDay(x.deliveredAt)}. ${esc(p)} has until ${fmtDay(x.deliveredAt + CONFIRM_WINDOW)} to report a problem, then your credit arrives.</p>${creditLine}`;
    } else if (d.stage === "disputed") {
      main = `<p class="note warn"><strong>Problem reported: ${esc(x.dispute)}.</strong> Support reviews photos within 1 business day. If the listing was wrong, the recipient's credit goes back to them, the sender earns nothing and gets a strike.</p>`;
    } else if (d.stage === "complete") {
      const stars = rated(d);
      main = `<p class="note">${d.role === "sender" ? "You earned 1 credit for sending this book." : esc(d.book.title) + " is on your shelf under Not available. Make it available when you're done reading."}</p>
        ${stars ? `<p class="lede">You rated ${esc(p)} ${stars} stars.</p>` : `<div class="section"><p class="eyebrow">Rate ${esc(p)}</p><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-act="rate" data-id="${r.id}" data-n="${n}" aria-label="${n} stars">★</button>`).join("")}</div></div>`}`;
    } else if (d.stage === "cancelled") {
      main = `<p class="note warn">${esc(x.outcome)}</p>`;
    } else {
      main = `<p class="note">${esc(st.text)}.${d.role === "recipient" ? " Your credit was returned." : ""}</p>`;
    }

    return `
      <div class="deal-head">
        ${cover(d.book, "lg")}
        <div class="who">
          <span class="dir">${d.role === "sender" ? "You" : esc(p)} ${icon("arrow", 14)} ${d.role === "sender" ? esc(p) : "You"}</span>
          <h3>${esc(d.book.title)}</h3>
          <span class="lede">${COND[c.cond].label} ${esc(c.format.toLowerCase())}</span>
          <span class="status ${st.cls}">${esc(st.text)}</span>
        </div>
      </div>
      ${progress(d)}
      ${main}
      <div class="section"><p class="eyebrow">History</p>
        <ol class="timeline">${r.log.slice().reverse().map((e) => `<li><time>${fmtDay(e.at)}, ${new Date(e.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time>${esc(e.text)}</li>`).join("")}</ol>
      </div>
    `;
  }

  function sheetTracking(s) {
    const r = req(s.id);
    return `<form id="trackForm" class="section" data-id="${r.id}">
      <p class="lede">Ship ${esc(bk(r.bookId).title)} to ${esc(first(r.recipient))}, then enter the tracking number from your receipt.</p>
      <div class="field"><label for="t-carrier">Carrier</label><select id="t-carrier" name="carrier">${["USPS", "UPS", "FedEx"].map((c) => `<option>${c}</option>`).join("")}</select></div>
      <div class="field"><label for="t-num">Tracking number</label><input id="t-num" name="tracking" required autocomplete="off" placeholder="9400 1118 9922 ..." pattern="[A-Za-z0-9 ]{10,40}"></div>
      <button type="button" class="link" data-act="sampleTracking">Demo: fill in a sample number</button>
      <p class="note">Your credit arrives when tracking shows delivered and ${esc(first(r.recipient))} confirms, not when you add tracking.</p>
      <button class="btn primary" type="submit">Save tracking</button>
    </form>`;
  }

  function sheetReport(s) {
    const reasons = ["Condition is worse than listed", "Wrong book or edition", "Damaged in the mail", "Says delivered, but it isn't here"];
    return `
      <p class="lede">Tell us what's wrong. You'll add photos next. Keep the book and packaging until this is resolved.</p>
      <div class="options">${reasons.map((r) => `<button class="option" data-act="pickReason" data-id="${esc(r)}" aria-pressed="${s.reason === r}"><span class="radio"></span><span><strong>${esc(r)}</strong></span></button>`).join("")}</div>
      <button class="btn primary" data-act="submitReport" data-id="${s.id}" ${s.reason ? "" : "disabled"}>Report problem</button>
    `;
  }

  function sheetCopy(s) {
    const c = copy(s.id);
    const b = bk(c.bookId);
    const l = openListing(c.id);
    const busy = activeExchange(c.id);
    const dis = busy ? "disabled" : "";
    return `
      <div class="detail" style="grid-template-columns:96px minmax(0,1fr)">${cover(b)}<div><h3>${esc(b.title)}</h3><p class="by">${esc(b.author)}</p><p class="isbn">ISBN ${b.isbn}</p></div></div>
      <div class="row"><div class="grow"><strong>Available for exchange</strong><p class="lede">${l ? "Anyone can request it." : "Hidden from Discover."}</p></div>
        <button class="toggle" data-act="toggleListing" data-id="${c.id}" aria-pressed="${!!l}" ${dis} aria-label="Available for exchange"><span></span></button></div>
      ${busy ? '<p class="note">This copy is in an exchange, so it can\'t be changed right now.</p>' : ""}
      <div class="section"><p class="eyebrow">Condition</p>
        <div class="options">${CONDITIONS.map((k) => `<button class="option" data-act="setCond" data-id="${c.id}" data-c="${k.id}" aria-pressed="${c.cond === k.id}" ${dis}><span class="radio"></span><span><strong>${k.label}</strong><span>${k.desc}</span></span></button>`).join("")}</div>
      </div>
      <div class="section"><p class="eyebrow">Format</p>
        <div class="chips">${["Hardcover", "Paperback", "Mass market"].map((f) => `<button class="chip" data-act="setFormat" data-id="${c.id}" data-f="${f}" aria-pressed="${c.format === f}" ${dis}>${f}</button>`).join("")}</div>
      </div>
      <div class="section"><p class="eyebrow">Anything to disclose?</p>
        <div class="chips">${FLAGS.map((f) => `<button class="chip" data-act="setFlag" data-id="${c.id}" data-f="${esc(f)}" aria-pressed="${c.flags.includes(f)}" ${dis}>${esc(f)}</button>`).join("")}</div>
        ${["good", "acc"].includes(c.cond) ? '<p class="note">Photos are required for Good and Acceptable copies. In the real app you\'d add 1 to 4 here.</p>' : ""}
      </div>
      <button class="btn danger" data-act="removeCopy" data-id="${c.id}" ${dis}>Remove from my shelf</button>
    `;
  }

  function sheetWallet() {
    const b = balances();
    const avail = discoverPool().filter(requestable).length;
    // Newest first; entries made at the same moment keep their real order.
    const mine = S.ledger.filter((e) => e.user === "me").reverse().sort((a, z) => z.at - a.at);
    const label = { grant: ["Welcome credit", "+1"], earn: ["Earned", "+1"], reserve: ["Reserved", "held"], release: ["Returned", "+1"], spend: ["Spent", "used"], reverse: ["Reversed", "−1"] };
    const pays = S.payments.filter((p) => p.user === "me").reverse().sort((a, z) => z.at - a.at);
    return `
      <div class="wallet-hero">
        <span class="big-num">${b.available}</span>
        <p>${b.available === 1 ? "credit" : "credits"} to spend. ${plural(avail, "book")} ${avail === 1 ? "is" : "are"} ready for you to discover.</p>
      </div>
      <div class="stats">
        <div class="stat"><b>${b.available}</b><span>available</span></div>
        <div class="stat"><b>${b.reserved}</b><span>reserved for requests</span></div>
        <div class="stat"><b>${b.pending}</b><span>pending, from books you sent</span></div>
      </div>
      <p class="lede">You earn a credit each time a book you sent arrives and is confirmed. Credits never expire, and they can't be bought, cashed out or given away.</p>
      ${welcomeBanner()}
      <div class="section"><p class="eyebrow">Credit history</p>
        ${mine.length ? `<div class="ledger-list">${mine.map((e) => `<div><span class="grow"><strong>${label[e.type][0]}</strong><span class="lede">${esc(e.note || "")}</span></span><span class="amt ${e.type}">${label[e.type][1]}</span><time>${fmtDay(e.at)}</time></div>`).join("")}</div>` : '<p class="lede">No credit activity yet.</p>'}
      </div>
      <div class="section"><p class="eyebrow">Fee balance: ${money(feeBalance())}${feesHeld() ? " (" + money(feesHeld()) + " set aside for open exchanges)" : ""}</p>
        ${pays.length ? `<div class="ledger-list">${pays.map((p) => `<div><span class="grow"><strong>${p.kind === "topup" ? "Added" : "Fee"}</strong><span class="lede">${esc(p.note)}</span></span><span class="amt">${p.kind === "topup" ? "+" : "−"}${money(p.amount)}</span><time>${fmtDay(p.at)}</time></div>`).join("")}</div>` : '<p class="lede">No payments yet.</p>'}
        <button class="btn ghost sm" data-act="${S.me.card ? "topup" : "addCard"}">${S.me.card ? "Add to fee balance" : "Add a card"}</button>
        <p class="lede">Fees come out of a prepaid balance, so card processing doesn't eat a third of every $1.</p>
      </div>`;
  }

  function sheetTopup(s) {
    const amt = s.amount || 5;
    return `
      <p class="lede">One card charge covers several exchanges. Fees are only taken when a book arrives.</p>
      <div class="options">${[5, 10, 20].map((n) => `<button class="option" data-act="pickTopup" data-id="${n}" aria-pressed="${amt === n}"><span class="radio"></span><span><strong>${money(n)}</strong><span>Covers ${Math.floor(n / Math.max(fees().recipient, 1))} books received</span></span></button>`).join("")}</div>
      <p class="lede">Charged to ${esc(S.me.card.brand)} ending ${esc(S.me.card.last4)}.</p>
      <button class="btn primary" data-act="confirmTopup" data-back="${s.back || ""}">Add ${money(amt)}</button>`;
  }

  function sheetCard(s) {
    return `<form id="cardForm" class="section" data-back="${s.back || ""}">
      <p class="lede">In the real app this is Stripe's secure card form, with Apple Pay and Google Pay. This one is filled with a test card.</p>
      <div class="field"><label for="cc-num">Card number</label><input id="cc-num" name="num" value="4242 4242 4242 4242" inputmode="numeric" autocomplete="cc-number" required></div>
      <div class="fields-2" style="grid-template-columns:1fr 1fr">
        <div class="field"><label for="cc-exp">Expires</label><input id="cc-exp" name="exp" value="12 / 29" autocomplete="cc-exp" required></div>
        <div class="field"><label for="cc-cvc">CVC</label><input id="cc-cvc" name="cvc" value="123" inputmode="numeric" autocomplete="cc-csc" required></div>
      </div>
      <button class="btn primary" type="submit">Save card</button>
    </form>`;
  }

  function sheetAddress(s) {
    const a = S.me.address || { name: S.me.name, line1: "", city: "", state: "NY", zip: "" };
    return `<form id="addrForm" class="section" data-back="${s.back || ""}">
      <div class="field"><label for="a-name">Full name</label><input id="a-name" name="name" value="${esc(a.name)}" required autocomplete="name"></div>
      <div class="field"><label for="a-line1">Street address</label><input id="a-line1" name="line1" value="${esc(a.line1)}" required autocomplete="address-line1"></div>
      <div class="fields-2">
        <div class="field"><label for="a-city">City</label><input id="a-city" name="city" value="${esc(a.city)}" required autocomplete="address-level2"></div>
        <div class="field"><label for="a-state">State</label><select id="a-state" name="state" required autocomplete="address-level1">${US_STATES.map((st) => `<option ${st === a.state ? "selected" : ""}>${st}</option>`).join("")}</select></div>
        <div class="field"><label for="a-zip">ZIP</label><input id="a-zip" name="zip" value="${esc(a.zip)}" required inputmode="numeric" pattern="[0-9]{5}" autocomplete="postal-code"></div>
      </div>
      <p class="lede">Shelf Swap ships within the US only. The real app checks this address with USPS.</p>
      <button class="btn primary" type="submit">Save address</button>
    </form>`;
  }

  function sheetAlerts() {
    if (!S.notes.length) return '<p class="lede">No alerts yet.</p>';
    return `${S.notes.some((n) => !n.read) ? '<button class="link" data-act="readAll">Mark all read</button>' : ""}
      <div>${S.notes.map((n) => `<button class="alert ${n.read ? "" : "unread"}" data-act="openNote" data-id="${n.id}">
        <span class="dot"></span>
        <span><strong>${esc(n.title)}</strong><p>${esc(n.body)}</p></span>
        <time>${ago(n.at)}</time>
      </button>`).join("")}</div>`;
  }

  function sheetCelebrate(s) {
    const b = balances();
    const avail = discoverPool().filter(requestable).length;
    const r = s.id ? req(s.id) : null;
    const title = s.kind === "welcome" ? "Your welcome credit" : "You earned a credit";
    const body = s.kind === "welcome"
      ? "You listed your first books, so your first request is on us."
      : esc(bk(r.bookId).title) + " reached " + esc(first(r.recipient)) + ". It's on their shelf now.";
    return `<div class="celebrate">
      <span class="credit-stamp"><small>Shelf Swap</small><b>+1</b><small>credit</small></span>
      <h3>${title}</h3>
      <p>${body}</p>
      <p class="lede">You have ${plural(b.available, "credit")}. ${plural(avail, "book")} ${avail === 1 ? "is" : "are"} ready for you to discover.</p>
      <button class="btn primary" data-act="tab" data-id="discover">Find my next book</button>
    </div>`;
  }

  function sheetHow() {
    const steps = [
      ["List", "Scan your books and mark the ones you're done with as available."],
      ["Someone requests one", "Accept within 48 hours. Ship within 3 days with any carrier (USPS Media Mail is cheapest) and add tracking."],
      ["Earn a credit", "When tracking shows delivered and the reader confirms (or 2 days pass), you get 1 credit."],
      ["Request any book", "Spend 1 credit + " + money(fees().recipient) + " on any available book from any reader. You never need to want each other's books."],
      ["If something goes wrong", "Not accepted, not shipped, or lost in the mail: your credit comes back. Wrong or misdescribed book: report it within 2 days."],
    ];
    return `<ol class="timeline">${steps.map(([h, p]) => `<li><strong>${h}</strong><br>${p}</li>`).join("")}</ol>
      <p class="note">Fees: ${money(fees().recipient)} to receive a book, ${money(fees().sender)} to send one. Senders pay their own postage.</p>`;
  }

  function sheetShipping() {
    return `<ol class="timeline">
      <li><strong>Pack it</strong><br>Use a padded mailer, or wrap the book in a paper bag or bubble wrap so it can't slide around.</li>
      <li><strong>Choose USPS Media Mail</strong><br>Usually $4 to $5 for one book, and 2 to 8 days to arrive. Books only, so no letters or bookmarks with ads.</li>
      <li><strong>Get a receipt with tracking</strong><br>At the post office counter, or buy a label online at usps.com.</li>
      <li><strong>Add tracking in Shelf Swap</strong><br>Within 3 days of accepting. We check it automatically from there.</li>
    </ol>
    <p class="note">Coming later: buy a prepaid label right inside Shelf Swap.</p>`;
  }

  function sheetConditions() {
    return `<div class="kv">${CONDITIONS.map((c) => `<div><span class="k"><strong style="color:var(--ink)">${c.label}</strong><br>${c.desc}</span></div>`).join("")}</div>
      <p class="lede">Grade honestly. If a book arrives worse than its grade, the sender earns no credit and gets a strike.</p>`;
  }

  function sheetDemo() {
    const t = new Date(S.now);
    const done = S.exchanges.filter((x) => x.status === "complete");
    const topups = S.payments.filter((p) => p.kind === "topup");
    const cardCost = topups.reduce((s, p) => s + 0.3 + p.amount * 0.029, 0);
    const revenue = done.reduce((s, x) => { const r = req(x.requestId); return s + r.fees.sender + r.fees.recipient; }, 0);
    return `
      <p class="lede">You're playing yourself. These buttons play every other reader and move the clock.</p>
      <p class="clock">Demo clock: ${t.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
      <div class="section"><p class="eyebrow">Other readers</p>
        <div class="btns">
          <button class="btn ghost sm" data-act="dAccept">Accept my requests</button>
          <button class="btn ghost sm" data-act="dShip">Ship books to me</button>
          <button class="btn ghost sm" data-act="dDeliver">Packages arrive</button>
          <button class="btn ghost sm" data-act="dRequest">Request one of my books</button>
          <button class="btn ghost sm" data-act="dMatch">List a wishlist book</button>
        </div>
      </div>
      <div class="section"><p class="eyebrow">Support decides a reported problem</p>
        <div class="btns">
          <button class="btn ghost sm" data-act="dRule" data-id="upheld">Recipient was right</button>
          <button class="btn ghost sm" data-act="dRule" data-id="rejected">Book matched the listing</button>
        </div>
      </div>
      <div class="section"><p class="eyebrow">Time</p>
        <div class="btns">
          <button class="btn ghost sm" data-act="dTime" data-n="0.25">+6 hours</button>
          <button class="btn ghost sm" data-act="dTime" data-n="1">+1 day</button>
          <button class="btn ghost sm" data-act="dTime" data-n="3">+3 days</button>
          <button class="btn ghost sm" data-act="dTime" data-n="10">+10 days</button>
        </div>
        <p class="lede">+3 days on a book you accepted but haven't shipped shows a missed ship window. +10 days on a shipped book shows a lost package.</p>
      </div>
      <div class="section"><p class="eyebrow">Pricing experiment (applies to new requests)</p>
        <div class="seg" role="group">${Object.entries(PRICING).map(([k, v]) => `<button data-act="dPricing" data-id="${k}" aria-pressed="${S.pricing === k}">${v.label}</button>`).join("")}</div>
      </div>
      <div class="section"><p class="eyebrow">Business view</p>
        <div class="kv card">
          <div><span class="k">Completed exchanges</span><span class="v">${done.length}</span></div>
          <div><span class="k">Platform fees earned</span><span class="v">${money(revenue)}</span></div>
          <div><span class="k">Fees per exchange</span><span class="v">${done.length ? money(revenue / done.length) : "–"}</span></div>
          <div><span class="k">Your card top-ups (Stripe cost)</span><span class="v">${topups.length} (${money(cardCost)})</span></div>
        </div>
      </div>
      <div class="btns">
        <button class="btn ghost" data-act="dNewUser">Start as a new reader</button>
        <button class="btn danger" data-act="dReset">Reset demo</button>
      </div>
    `;
  }

  const SHEETS = {
    listing: [sheetListing, "Book"], book: [sheetBook, "Book"], request: [sheetRequest, "Request this book"],
    deal: [sheetDeal, "Exchange"], tracking: [sheetTracking, "Add tracking"], report: [sheetReport, "Report a problem"],
    copy: [sheetCopy, "My copy"], wallet: [sheetWallet, "Your credits"], topup: [sheetTopup, "Add to fee balance"],
    card: [sheetCard, "Add a card"], address: [sheetAddress, "Shipping address"], alerts: [sheetAlerts, "Alerts"],
    celebrate: [sheetCelebrate, ""], how: [sheetHow, "How Shelf Swap works"], shipping: [sheetShipping, "How to ship a book"],
    conditions: [sheetConditions, "Condition guide"], demo: [sheetDemo, "Demo controls"],
  };

  /* ---------------- render ---------------- */

  const app = document.getElementById("app");

  function render() {
    const unread = S.notes.filter((n) => !n.read).length;
    const todo = myDeals().filter(needsMe).length;
    const views = { discover: viewDiscover, shelf: viewShelf, scan: viewScan, exchanges: viewExchanges, profile: viewProfile };
    const tabs = [["discover", "Discover", 0], ["shelf", "My Shelf", 0], ["scan", "Scan", 0], ["exchanges", "Exchanges", todo], ["profile", "Profile", 0]];
    let sheet = "";
    if (ui.sheet) {
      const [fn, title] = SHEETS[ui.sheet.type];
      const enter = ui.sheetEnter ? " enter" : "";
      sheet = `<div class="scrim${enter}" data-act="close"></div>
        <section class="sheet${enter}" role="dialog" aria-modal="true" aria-label="${title || "Credit earned"}">
          <span class="grabber"></span>
          <div class="sheet-head"><h2>${title}</h2><button class="x" data-act="close" aria-label="Close">${icon("x", 18)}</button></div>
          ${fn(ui.sheet)}
        </section>`;
      ui.sheetEnter = false;
    }
    const prevScroll = document.querySelector(".sheet")?.scrollTop;
    const onboarding = !S.me.onboarded;
    app.innerHTML = `
      <header class="top">
        <div class="brand"><h1>Shelf Swap</h1></div>
        ${onboarding ? "" : creditPill()}
        ${onboarding ? "" : `<button class="icon-btn" data-act="alerts" aria-label="Alerts${unread ? ", " + unread + " unread" : ""}">${icon("bell", 22)}${unread ? `<span class="badge">${unread}</span>` : ""}</button>`}
        <button class="demo-btn" data-act="demo">Demo</button>
      </header>
      ${onboarding ? viewOnboarding() : views[ui.tab]()}
      ${onboarding ? "" : `<div class="tabbar"><nav>${tabs.map(([id, label, n]) => `<button class="${id === "scan" ? "scan-tab" : ""}" data-act="tab" data-id="${id}" ${ui.tab === id ? 'aria-current="page"' : ""}><span class="ti">${icon(id)}</span>${label}${n ? `<span class="badge">${n}</span>` : ""}</button>`).join("")}</nav></div>`}
      ${sheet}
      ${ui.toast ? `<div class="toast" role="status">${esc(ui.toast)}</div>` : ""}
    `;
    if (prevScroll) {
      const sh = document.querySelector(".sheet");
      if (sh) sh.scrollTop = prevScroll;
    }
  }

  function openSheet(type, data = {}) {
    const fresh = !ui.sheet || ui.sheet.type !== type || ui.sheet.id !== data.id;
    ui.sheet = Object.assign({ type }, data);
    ui.sheetEnter = fresh;
    render();
    if (fresh) {
      const sh = document.querySelector(".sheet");
      if (sh) sh.scrollTop = 0;
    }
  }
  function closeSheet() {
    ui.sheet = null;
    render();
  }
  function commit(msg) {
    save();
    if (msg) toast(msg);
    render();
  }
  // Sheets opened from inside the request flow return to it afterwards.
  function backTo(back) {
    if (back) openSheet("request", { id: back });
    else closeSheet();
  }

  /* ---------------- scanning ---------------- */

  function addCopy(bookId) {
    const c = { id: uid("c"), owner: "me", bookId, cond: ui.defCond, format: "Paperback", flags: [], addedAt: S.now };
    S.copies.push(c);
    listCopy(c);
    return c;
  }
  function listCopy(c) {
    if (openListing(c.id)) return;
    S.listings.push({ id: uid("l"), copyId: c.id, openedAt: S.now, closedAt: null });
    checkWelcome();
  }

  function simulateScan() {
    const owned = new Set(S.copies.filter((c) => c.owner === "me").map((c) => c.bookId));
    const next = CATALOG.find((b) => !owned.has(b.id) && !S.wishlist.me.includes(b.id)) || CATALOG.find((b) => !owned.has(b.id));
    if (!next) return toast("You own every book in this demo catalog."), render();
    const c = addCopy(next.id);
    ui.scanned.unshift(c.id);
    commit("Added " + next.title);
  }

  const PALETTE = [["#264653", "#f1e3c8"], ["#8a3b2e", "#f6e7d0"], ["#e9c46a", "#2a2a1a"], ["#3d405b", "#f4f1de"], ["#6d597a", "#f6e9f0"], ["#2a9d8f", "#0f2622"]];
  async function lookupIsbn(isbn) {
    const local = CATALOG.find((b) => b.isbn === isbn) || Object.values(S.extraBooks).find((b) => b.isbn === isbn);
    if (local) return local;
    try {
      const res = await fetch("https://openlibrary.org/api/books?bibkeys=ISBN:" + isbn + "&format=json&jscmd=data");
      const d = (await res.json())["ISBN:" + isbn];
      if (!d) return null;
      const h = [...isbn].reduce((s, ch) => s + ch.charCodeAt(0), 0);
      const [bg, fg] = PALETTE[h % PALETTE.length];
      const b = { id: "x" + isbn, title: d.title, author: (d.authors || []).map((a) => a.name).join(", ") || "Unknown author", year: parseInt(d.publish_date, 10) || "", isbn, bg, fg, motif: (h % 3) + 1, genre: "Other" };
      S.extraBooks[b.id] = b;
      return b;
    } catch (e) {
      return null;
    }
  }

  async function addByIsbn(isbn) {
    toast("Looking up " + isbn + "…");
    render();
    const b = await lookupIsbn(isbn);
    if (!b) return toast("Couldn't find ISBN " + isbn + ". Try searching by title."), render();
    const c = addCopy(b.id);
    ui.scanned.unshift(c.id);
    ui.scanQ = "";
    commit("Added " + b.title);
  }

  // Real camera scanning where the browser supports it (Chrome on Android, for example).
  async function startCamera() {
    if (!("BarcodeDetector" in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      ui.cam = "unsupported";
      return simulateScan();
    }
    let detector, stream;
    try {
      detector = new window.BarcodeDetector({ formats: ["ean_13"] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch (e) {
      ui.cam = "denied";
      return simulateScan();
    }
    const wrap = document.createElement("div");
    wrap.className = "camera";
    wrap.innerHTML = `<video playsinline muted></video><span class="cam-frame"></span><p class="cam-hint">Hold a barcode inside the frame</p><button class="btn primary cam-done">Done</button>`;
    document.body.appendChild(wrap);
    const video = wrap.querySelector("video");
    video.srcObject = stream;
    await video.play();
    const seen = new Set();
    wrap.querySelector(".cam-done").addEventListener("click", () => {
      stream.getTracks().forEach((tr) => tr.stop());
      wrap.remove();
      render();
    });
    const loop = async () => {
      if (!wrap.isConnected) return;
      try {
        const codes = await detector.detect(video);
        const code = codes.map((c) => c.rawValue).find((v) => /^97[89]\d{10}$/.test(v));
        if (code && !seen.has(code)) {
          seen.add(code);
          if (navigator.vibrate) navigator.vibrate(40);
          await addByIsbn(code);
        }
      } catch (e) { /* keep scanning */ }
      setTimeout(loop, 250);
    };
    loop();
  }

  /* ---------------- actions ---------------- */

  const A = {
    tab(d) {
      ui.tab = d.id;
      ui.sheet = null;
      window.scrollTo(0, 0);
      render();
    },
    shelfTab(d) { ui.shelf = d.id; render(); },
    xTab(d) { ui.xTab = d.id; render(); },
    genre(d) { ui.genre = d.id; render(); },
    cond(d) { ui.cond = d.id; render(); },
    showAll() { ui.showAll = !ui.showAll; render(); },
    close: closeSheet,
    demo() { openSheet("demo"); },
    alerts() { openSheet("alerts"); },
    wallet() { openSheet("wallet"); },
    how() { openSheet("how"); },
    shipping() { openSheet("shipping"); },
    conditions() { openSheet("conditions"); },
    openListing(d) { openSheet("listing", { id: d.id }); },
    openBook(d) { openSheet("book", { id: d.id }); },
    openCopy(d) { openSheet("copy", { id: d.id }); },
    openDeal(d) { openSheet("deal", { id: d.id }); },

    wish(d) {
      const w = S.wishlist.me;
      const on = w.includes(d.id);
      S.wishlist.me = on ? w.filter((b) => b !== d.id) : w.concat(d.id);
      commit(on ? "Removed from wishlist" : "Added to wishlist. We'll alert you when a copy is listed.");
    },

    request(d) { openSheet("request", { id: d.id }); },
    sendRequest(d) {
      const r = createRequest(d.id, "me");
      if (!r) return commit("Couldn't request this book. Check your credits and fee balance.");
      notify("Request sent", first(r.sender) + " has 48 hours to accept " + bk(r.bookId).title + ".", { request: r.id });
      ui.tab = "exchanges";
      ui.xTab = "incoming";
      openSheet("deal", { id: r.id });
      commit("Requested. 1 credit reserved.");
    },
    withdraw(d) {
      const r = req(d.id);
      closeRequest(r, "withdrawn", "You cancelled the request. Credit returned.");
      openSheet("deal", { id: r.id });
      commit("Request cancelled. Your credit is back.");
    },
    accept(d) {
      const r = req(d.id);
      if (feeFree() < r.fees.sender) {
        toast("Add to your fee balance to cover the " + money(r.fees.sender) + " sending fee.");
        return openSheet(S.me.card ? "topup" : "card", {});
      }
      const x = acceptRequest(r);
      if (!x) return commit("This copy is already in another exchange.");
      openSheet("deal", { id: r.id });
      commit("Accepted. Ship by " + fmtDay(x.shipBy) + ".");
    },
    decline(d) {
      const r = req(d.id);
      closeRequest(r, "declined", "You declined. " + first(r.recipient) + "'s credit was returned.");
      closeSheet();
      commit("Request declined");
    },
    addTracking(d) { openSheet("tracking", { id: d.id }); },
    sampleTracking() {
      const el = document.getElementById("t-num");
      if (el) el.value = fakeTracking();
    },
    confirmBook(d) {
      const x = exOf(d.id);
      complete(x, "You confirmed " + bk(req(d.id).bookId).title + " arrived and matches the listing.");
      openSheet("deal", { id: d.id });
      commit("Confirmed. " + first(x.sender) + " earned a credit.");
    },
    report(d) { openSheet("report", { id: d.id, reason: null }); },
    pickReason(d) { ui.sheet.reason = d.id; render(); },
    submitReport(d) {
      const x = exOf(d.id);
      x.status = "disputed";
      x.dispute = ui.sheet.reason;
      log(req(d.id), "You reported a problem: " + ui.sheet.reason + ". Credits on hold until support decides.");
      openSheet("deal", { id: d.id });
      commit("Problem reported. Support replies within 1 business day.");
    },
    rate(d) {
      S.me.ratings[d.id] = Number(d.n);
      log(req(d.id), "You rated " + first(deal(req(d.id)).other) + " " + d.n + " stars.");
      commit("Thanks. Rating saved.");
    },

    toggleListing(d) {
      const c = copy(d.id);
      if (activeExchange(c.id)) return toast("This copy is in an exchange."), render();
      const l = openListing(c.id);
      if (l) {
        l.closedAt = S.now;
        S.requests.filter((r) => r.copyId === c.id && r.status === "pending").forEach((r) => closeRequest(r, "declined", "Declined: the owner made this copy unavailable."));
      } else listCopy(c);
      commit(l ? "Hidden from Discover" : "Available for exchange");
    },
    setCond(d) { copy(d.id).cond = d.c; commit(); },
    setFormat(d) { copy(d.id).format = d.f; commit(); },
    setFlag(d) {
      const c = copy(d.id);
      c.flags = c.flags.includes(d.f) ? c.flags.filter((x) => x !== d.f) : c.flags.concat(d.f);
      commit();
    },
    removeCopy(d) {
      const c = copy(d.id);
      const l = openListing(c.id);
      if (l) l.closedAt = S.now;
      S.requests.filter((r) => r.copyId === c.id && r.status === "pending").forEach((r) => closeRequest(r, "declined", "Declined: the owner removed this copy."));
      c.owner = "removed";
      closeSheet();
      commit("Removed from your shelf");
    },

    camera() { startCamera(); },
    defCond(d) { ui.defCond = d.id; render(); },
    addFromSearch(d) {
      const c = addCopy(d.id);
      ui.scanned.unshift(c.id);
      ui.scanQ = "";
      commit("Added " + bk(d.id).title);
    },
    lookupIsbn(d) { addByIsbn(d.id); },

    editAddress(d) { openSheet("address", { back: d.back }); },
    addCard(d) { openSheet("card", { back: d.back }); },
    topup(d) { openSheet("topup", { back: d.back, amount: 5 }); },
    pickTopup(d) { ui.sheet.amount = Number(d.id); render(); },
    confirmTopup(d) {
      const amt = ui.sheet.amount || 5;
      S.payments.push({ id: uid("p"), user: "me", kind: "topup", amount: amt, at: S.now, requestId: null, note: "Added to fee balance (" + S.me.card.brand + " " + S.me.card.last4 + ")" });
      backTo(d.back);
      commit(money(amt) + " added to your fee balance");
    },

    readAll() { S.notes.forEach((n) => (n.read = true)); commit(); },
    openNote(d) {
      const n = S.notes.find((x) => x.id === d.id);
      n.read = true;
      save();
      if (n.go && n.go.request) return openSheet("deal", { id: n.go.request });
      if (n.go && n.go.listing && listing(n.go.listing)) return openSheet("listing", { id: n.go.listing });
      if (n.go && n.go.wallet) return openSheet("wallet");
      render();
    },

    /* onboarding */
    obNext() {
      if (ui.ob === 0) {
        const v = (document.getElementById("ob-name") || {}).value || "";
        if (!v.trim()) return toast("Add your name to continue."), render();
        S.me.name = v.trim();
      }
      ui.ob++;
      commit();
    },
    obBack() { ui.ob = Math.max(0, ui.ob - 1); render(); },
    obGenre(d) {
      const g = S.me.genres;
      S.me.genres = g.includes(d.id) ? g.filter((x) => x !== d.id) : g.concat(d.id);
      render();
    },
    obWish(d) {
      const w = S.wishlist.me;
      S.wishlist.me = w.includes(d.id) ? w.filter((x) => x !== d.id) : w.concat(d.id);
      render();
    },
    obDone() {
      S.me.onboarded = true;
      ui.ob = 0;
      ui.tab = "scan";
      commit("Scan a few books to get started");
    },
    replayOnboarding() { S.me.onboarded = false; ui.ob = 0; ui.sheet = null; commit(); },

    /* demo: every other reader */
    dAccept() {
      const mine = S.requests.filter((r) => r.recipient === "me" && r.status === "pending");
      if (!mine.length) return toast("You have no pending requests. Request a book from Discover first."), render();
      mine.forEach((r) => {
        const x = acceptRequest(r);
        if (x) notify(first(r.sender) + " accepted your request", bk(r.bookId).title + " ships by " + fmtDay(x.shipBy) + ".", { request: r.id });
      });
      commit(plural(mine.length, "request") + " accepted");
    },
    dShip() {
      const list = S.exchanges.filter((x) => x.recipient === "me" && x.status === "accepted");
      if (!list.length) return toast("Nobody owes you a book right now."), render();
      list.forEach((x) => {
        ship(x, "USPS", fakeTracking());
        notify(bk(copy(x.copyId).bookId).title + " is on its way", first(x.sender) + " shipped it with USPS Media Mail.", { request: x.requestId });
      });
      commit("Books shipped to you");
    },
    dDeliver() {
      const list = S.exchanges.filter((x) => x.status === "shipped");
      if (!list.length) return toast("Nothing is in the mail. Ship something first."), render();
      ui.sheet = null;
      list.forEach((x) => {
        deliver(x);
        const r = req(x.requestId);
        if (x.recipient === "me") notify(bk(r.bookId).title + " was delivered", "Check it against the listing within 2 days.", { request: r.id });
        else complete(x, first(x.recipient) + " confirmed it arrived and matches the listing.");
      });
      commit(plural(list.length, "package") + " delivered");
    },
    dRequest() {
      const mine = S.listings.filter((l) => requestable(l) && copy(l.copyId).owner === "me");
      if (!mine.length) return toast("Make a book available on your shelf first."), render();
      const l = mine[Math.floor(Math.random() * mine.length)];
      const who = ["maya", "jonah", "priya", "theo", "sam"].filter((u) => !S.requests.some((r) => r.listingId === l.id && r.recipient === u && r.status === "pending"));
      if (!who.length) return toast("Everyone already requested that one."), render();
      const r = createRequest(l.id, who[Math.floor(Math.random() * who.length)]);
      notify(first(r.recipient) + " requested " + bk(r.bookId).title, "Accept within 48 hours, then ship within 3 days. You earn 1 credit when it arrives.", { request: r.id });
      commit("New request from " + first(r.recipient));
    },
    dMatch() {
      const want = S.wishlist.me.filter((b) => !S.listings.some((l) => requestable(l) && copy(l.copyId).bookId === b && copy(l.copyId).owner !== "me"));
      if (!want.length) return toast("Every wishlist book already has a copy available."), render();
      const bookId = want[0];
      const owner = ["sam", "jonah", "theo", "priya"][Math.floor(Math.random() * 4)];
      const c = { id: uid("c"), owner, bookId, cond: "vg", format: "Paperback", flags: [], addedAt: S.now };
      S.copies.push(c);
      const l = { id: uid("l"), copyId: c.id, openedAt: S.now, closedAt: null };
      S.listings.push(l);
      notify(bk(bookId).title + " is available", first(owner) + " listed a Very Good paperback. It's on your wishlist.", { listing: l.id });
      commit("Wishlist match: " + bk(bookId).title);
    },
    dRule(d) {
      const list = S.exchanges.filter((x) => x.status === "disputed");
      if (!list.length) return toast("No reported problems. Report one on a delivered book first."), render();
      list.forEach((x) => {
        const r = req(x.requestId);
        if (d.id === "upheld") {
          const outcome = "Support agreed the book didn't match the listing. " + (x.recipient === "me" ? "Your credit is back and nothing was charged." : "No credit was earned.") + " " + first(x.sender) + " got a strike.";
          if (x.sender === "me") S.me.strikes++;
          cancelExchange(x, "Support decided for the recipient.", outcome);
          notify("Problem resolved", outcome, { request: r.id });
        } else {
          complete(x, "Support found the book matched its listing. Exchange complete.");
          notify("Problem resolved", "Support found " + bk(r.bookId).title + " matched its listing. The exchange is complete.", { request: r.id });
        }
      });
      commit("Support decided");
    },
    dTime(d) {
      const steps = Math.round(Number(d.n) * 24);
      for (let i = 0; i < steps; i++) { S.now += HOUR; tick(); }
      commit("Clock moved to " + fmtDay(S.now));
    },
    dPricing(d) { S.pricing = d.id; commit("New requests use: " + PRICING[d.id].label); },
    dNewUser() {
      S = seed(true);
      ui.sheet = null;
      ui.tab = "discover";
      ui.ob = 0;
      ui.scanned = [];
      commit();
    },
    dReset() {
      S = seed();
      ui.sheet = null;
      ui.tab = "discover";
      ui.q = "";
      ui.scanned = [];
      commit("Demo reset");
    },
  };

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const fn = A[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el.dataset, el); }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id === "q") {
      ui.q = e.target.value;
      const r = document.getElementById("results");
      if (r) r.innerHTML = discoverResults();
    }
    if (e.target.id === "scanq") {
      ui.scanQ = e.target.value;
      const r = document.getElementById("scanResults");
      if (r) r.innerHTML = scanMatches(ui.scanQ);
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target.id !== "photo" || !e.target.files[0]) return;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 160;
      const s = Math.min(img.width, img.height);
      cv.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 160, 160);
      S.me.photo = cv.toDataURL("image/jpeg", 0.8);
      URL.revokeObjectURL(img.src);
      const name = document.getElementById("ob-name");
      if (name) S.me.name = name.value;
      commit("Photo added");
    };
    img.src = URL.createObjectURL(e.target.files[0]);
  });

  document.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const back = e.target.dataset.back;
    if (e.target.id === "addrForm") {
      S.me.address = { name: f.get("name"), line1: f.get("line1"), city: f.get("city"), state: f.get("state"), zip: f.get("zip") };
      backTo(back);
      commit("Address saved");
    }
    if (e.target.id === "cardForm") {
      const num = String(f.get("num")).replace(/\D/g, "");
      if (num.length < 12) return toast("Enter a full card number."), render();
      S.me.card = { brand: num[0] === "4" ? "Visa" : num[0] === "5" ? "Mastercard" : "Card", last4: num.slice(-4) };
      ui.sheet = null;
      checkWelcome();
      if (!ui.sheet && back) openSheet("topup", { back, amount: 5 });
      commit("Card saved");
    }
    if (e.target.id === "trackForm") {
      const r = req(e.target.dataset.id);
      ship(exOf(r.id), f.get("carrier"), String(f.get("tracking")).trim());
      openSheet("deal", { id: r.id });
      commit("Tracking saved. You'll earn your credit when it arrives.");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ui.sheet) closeSheet();
  });

  render();

  // Offline support when installed as a PWA. Hosts that don't allow service workers just skip this.
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
