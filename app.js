/* Worm. Readers send books they've finished, earn a credit for each one that arrives,
   and spend credits on any available book from any other reader.

   Two modes share every screen:
   - Live: config.js holds a Supabase project URL and public key. Sign-in, data, payments and
     timers all run on the server (see supabase/). This file only draws screens and calls it.
   - Demo: no config. Fake readers and data live in this browser, and the Demo panel plays
     everyone else and moves the clock. */
(function () {
  "use strict";

  const CFG = window.WORM_CONFIG || {};
  const LIVE = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);

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
  const STORE_KEY = "worm-demo-v1";

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
  const REPORT_REASONS = ["Condition is worse than listed", "Wrong book or edition", "Damaged in the mail", "Says delivered, but it isn't here"];

  // Cover colors and jacket style (1–7, see app.css) are part of each book's identity, so they
  // stay the same in light and dark.
  const CATALOG = [
    ["b1", "Tomorrow, and Tomorrow, and Tomorrow", "Gabrielle Zevin", 2022, "9780593321201", "#ffd36e", "#2a1f17", 2, 0],
    ["b2", "Project Hail Mary", "Andy Weir", 2021, "9780593135204", "#a9d4f0", "#1d3550", 6, 1],
    ["b3", "Circe", "Madeline Miller", 2018, "9780316556347", "#ffb48a", "#3a1d0f", 1, 1],
    ["b4", "The Overstory", "Richard Powers", 2018, "9780393356687", "#c8d58e", "#2c3a12", 4, 0],
    ["b5", "Piranesi", "Susanna Clarke", 2020, "9781635577808", "#d8c8f2", "#2e2350", 7, 1],
    ["b6", "Station Eleven", "Emily St. John Mandel", 2014, "9780804172448", "#fff1d6", "#b0331f", 3, 1],
    ["b7", "The Left Hand of Darkness", "Ursula K. Le Guin", 1969, "9780441478125", "#cfe6ef", "#18324a", 5, 1],
    ["b8", "Lessons in Chemistry", "Bonnie Garmus", 2022, "9780385547345", "#f8c6bd", "#5a2018", 2, 2],
    ["b9", "Pachinko", "Min Jin Lee", 2017, "9781455563920", "#e9a7a0", "#4a1220", 1, 2],
    ["b10", "Demon Copperhead", "Barbara Kingsolver", 2022, "9780063251922", "#9fd8cb", "#1d4a44", 3, 0],
    ["b11", "Klara and the Sun", "Kazuo Ishiguro", 2021, "9780593318171", "#ffe08f", "#5b3a24", 6, 1],
    ["b12", "Babel", "R. F. Kuang", 2022, "9780063021426", "#f3ecdf", "#8a2420", 4, 1],
    ["b13", "The Song of Achilles", "Madeline Miller", 2012, "9780062060624", "#3d4a6b", "#ffd36e", 7, 2],
    ["b14", "Sea of Tranquility", "Emily St. John Mandel", 2022, "9780593321447", "#bfe1ec", "#1d2f45", 5, 1],
    ["b15", "Educated", "Tara Westover", 2018, "9780399590504", "#f6efe2", "#2b1d14", 3, 5],
    ["b16", "Remarkably Bright Creatures", "Shelby Van Pelt", 2022, "9780063204157", "#8cc7c7", "#12383d", 4, 0],
    ["b17", "The Remains of the Day", "Kazuo Ishiguro", 1989, "9780679731726", "#d7dfae", "#3b4418", 1, 0],
    ["b18", "Normal People", "Sally Rooney", 2018, "9781984822185", "#c7ead8", "#18302a", 2, 0],
    ["b19", "The Midnight Library", "Matt Haig", 2020, "9780525559474", "#2f4a78", "#ffe08f", 6, 0],
    ["b20", "A Gentleman in Moscow", "Amor Towles", 2016, "9780670026197", "#f2b8a8", "#5a1520", 7, 2],
    ["b21", "Hamnet", "Maggie O'Farrell", 2020, "9780525657606", "#b9d7b0", "#23432a", 4, 2],
    ["b22", "The Name of the Wind", "Patrick Rothfuss", 2007, "9780756404741", "#e8c39a", "#3b2416", 5, 1],
    ["b23", "Beloved", "Toni Morrison", 1987, "9781400033416", "#e3c3d8", "#4a1d38", 1, 0],
    ["b24", "Braiding Sweetgrass", "Robin Wall Kimmerer", 2013, "9781571313560", "#d9e3a0", "#3d4a12", 6, 5],
    ["b25", "Dune", "Frank Herbert", 1965, "9780441172719", "#ffc58a", "#4a2408", 2, 1],
    ["b26", "The Thursday Murder Club", "Richard Osman", 2020, "9781984880963", "#a6dcdf", "#12474d", 3, 3],
    ["b27", "Gone Girl", "Gillian Flynn", 2012, "9780307588371", "#2e2a28", "#f6ecdc", 5, 3],
    ["b28", "Beach Read", "Emily Henry", 2020, "9781984806734", "#ffc4b4", "#24304a", 6, 4],
    ["b29", "Book Lovers", "Emily Henry", 2022, "9780593334836", "#ffe58f", "#2b4a3a", 4, 4],
    ["b30", "Sapiens", "Yuval Noah Harari", 2015, "9780062316097", "#f4efe6", "#c0392b", 2, 5],
  ].map(([id, title, author, year, isbn, bg, fg, jacket, g]) => ({ id, title, author, year, isbn, bg, fg, jacket, genre: GENRES[g] }));
  const CATALOG_BY_ID = Object.fromEntries(CATALOG.map((b) => [b.id, b]));
  // Jacket colors for real books that don't come with a cover image.
  const PALETTE = [["#9fd8cb", "#1d4a44"], ["#ffb48a", "#3a1d0f"], ["#ffd36e", "#2a1f17"], ["#c8d58e", "#2c3a12"], ["#d8c8f2", "#2e2350"], ["#f8c6bd", "#5a2018"], ["#a9d4f0", "#1d3550"], ["#3d4a6b", "#ffd36e"]];

  const DEMO_USERS = {
    me: { id: "me", name: "Andrew P.", handle: "andrew.p", city: "Brooklyn, NY", rating: 5.0 },
    maya: { id: "maya", name: "Maya R.", handle: "mayareads", city: "Portland, OR", rating: 4.9 },
    jonah: { id: "jonah", name: "Jonah B.", handle: "jonahbinds", city: "Austin, TX", rating: 4.7 },
    priya: { id: "priya", name: "Priya S.", handle: "priyapages", city: "Chicago, IL", rating: 5.0 },
    theo: { id: "theo", name: "Theo T.", handle: "theo.t", city: "Denver, CO", rating: 4.8 },
    sam: { id: "sam", name: "Sam K.", handle: "samshelves", city: "Raleigh, NC", rating: 4.6 },
  };
  let USERS = DEMO_USERS;

  /* ---------------- data ----------------
     books     canonical metadata by ISBN
     copies    a physical book someone owns
     listings  a copy that is open for requests (closed when made unavailable or exchanged)
     requests  someone asking for a listing; holds 1 reserved credit
     exchanges fulfillment of an accepted request: ship, deliver, confirm
     ledger    append-only credit entries; balances are always computed from it
     payments  money: fee balance top-ups and captured fees
     In live mode the server sends exactly this shape (get_state), with "me" standing for the
     signed-in reader, so every screen below works the same in both modes. */

  function blankState() {
    return {
      now: START, nextId: 500, pricing: "split", signedIn: false,
      extraBooks: {}, copies: [], listings: [], requests: [], exchanges: [], ledger: [], payments: [], notes: [],
      wishlist: { me: [], maya: ["b13", "b3"], priya: ["b1", "b4"], jonah: ["b2", "b9"], theo: ["b2", "b5", "b9"], sam: ["b4", "b25", "b9", "b10"] },
      me: { name: "", handle: "", photo: null, genres: [], city: "", state: "", address: null, strikes: 0, onboarded: false, welcome: "locked", ratings: {} },
    };
  }

  // fresh = a brand-new reader joining a marketplace that already has other readers' books.
  function seed(fresh) {
    const S = blankState();
    const t = START;
    if (!fresh) {
      S.signedIn = true;
      S.me = {
        name: "Andrew Penhollow", handle: "andrew.p", photo: null, genres: ["Literary", "Sci-fi & Fantasy"], city: "Brooklyn", state: "NY",
        address: { name: "Andrew Penhollow", line1: "214 Kent Ave, Apt 3R", city: "Brooklyn", state: "NY", zip: "11249" },
        strikes: 0, onboarded: true, welcome: "granted", ratings: {},
      };
      S.wishlist.me = ["b7", "b9", "b10", "b11", "b23", "b25"];
    }
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
    const X = (o) => S.exchanges.push(Object.assign({ carrier: "USPS", tracking: null, shippedAt: null, deliveredAt: null, completedAt: null }, o));

    P("me", "topup", 10, t - 21 * DAY, null, "Added to fee balance");
    L("me", "grant", null, t - 21 * DAY, "Welcome credit");

    // History: three finished exchanges.
    R({ id: "r0", listingId: "lc7x", copyId: "c7", bookId: "b15", sender: "sam", recipient: "me", at: t - 20 * DAY, status: "accepted",
      log: [{ at: t - 14 * DAY, text: "You confirmed Educated. Exchange complete." }] });
    X({ id: "x0", requestId: "r0", sender: "sam", recipient: "me", copyId: "c7", status: "complete", acceptedAt: t - 19 * DAY, shipBy: t - 16 * DAY, tracking: "9400111899221102553120", shippedAt: t - 18 * DAY, deliveredAt: t - 15 * DAY, completedAt: t - 14 * DAY, rated: 5 });
    L("me", "reserve", "r0", t - 20 * DAY, "Requested Educated");
    L("me", "spend", "r0", t - 14 * DAY, "Received Educated from Sam");
    P("me", "fee", 1, t - 14 * DAY, "r0", "Fee for receiving Educated");

    R({ id: "r01", listingId: "lc40x", copyId: "c40", bookId: "b3", sender: "me", recipient: "jonah", at: t - 12 * DAY, status: "accepted",
      log: [{ at: t - 8 * DAY, text: "Jonah confirmed Circe. You earned 1 credit." }] });
    X({ id: "x01", requestId: "r01", sender: "me", recipient: "jonah", copyId: "c40", status: "complete", acceptedAt: t - 12 * DAY, shipBy: t - 9 * DAY, tracking: "9400111899224410007220", shippedAt: t - 11 * DAY, deliveredAt: t - 9 * DAY, completedAt: t - 8 * DAY, rated: 5 });
    L("me", "earn", "r01", t - 8 * DAY, "Sent Circe to Jonah");
    P("me", "fee", 1, t - 8 * DAY, "r01", "Fee for sending Circe");

    R({ id: "r02", listingId: "lc42x", copyId: "c42", bookId: "b8", sender: "me", recipient: "priya", at: t - 9 * DAY, status: "accepted",
      log: [{ at: t - 5 * DAY, text: "Priya confirmed Lessons in Chemistry. You earned 1 credit." }] });
    X({ id: "x02", requestId: "r02", sender: "me", recipient: "priya", copyId: "c42", status: "complete", acceptedAt: t - 9 * DAY, shipBy: t - 6 * DAY, tracking: "9400111899227781339020", shippedAt: t - 8 * DAY, deliveredAt: t - 6 * DAY, completedAt: t - 5 * DAY, rated: 4 });
    L("me", "earn", "r02", t - 5 * DAY, "Sent Lessons in Chemistry to Priya");
    P("me", "fee", 1, t - 5 * DAY, "r02", "Fee for sending Lessons in Chemistry");

    // Active: Babel is on its way to me.
    R({ id: "r1", listingId: "lc21", copyId: "c21", bookId: "b12", sender: "maya", recipient: "me", at: t - 2 * DAY, status: "accepted",
      log: [
        { at: t - 2 * DAY, text: "You requested Babel. 1 credit reserved." },
        { at: t - 1 * DAY, text: "Maya accepted and has 3 days to ship." },
        { at: t - 3 * HOUR, text: "Maya added USPS tracking 9400111899223456778120." },
      ] });
    X({ id: "x1", requestId: "r1", sender: "maya", recipient: "me", copyId: "c21", status: "shipped", acceptedAt: t - 1 * DAY, shipBy: t + 2 * DAY, tracking: "9400111899223456778120", shippedAt: t - 3 * HOUR });
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

  let S = LIVE ? blankState() : load() || seed();
  const ui = {
    tab: "discover", shelf: "available", xTab: "ship", q: "", genre: "All", cond: "all", showAll: false,
    sheet: null, sheetEnter: false, toast: null, ob: 0, obActive: false, draft: {}, scanQ: "", scanned: [], searchHits: null,
    defCond: "vg", cam: null, busy: 0, screen: LIVE ? "loading" : "app", otpEmail: null,
  };

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function save() {
    if (LIVE) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* storage blocked: demo still works for this visit */ }
  }
  const uid = (p) => p + S.nextId++;

  /* ---------------- lookups ---------------- */

  let skew = 0; // server clock minus this device's clock (live mode)
  const now = () => (LIVE ? Date.now() + skew : S.now);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$" + Number(n).toFixed(2);
  const UNKNOWN_BOOK = { id: "?", title: "Unknown book", author: "", year: "", isbn: "", bg: "#f4ecdd", fg: "#2f241b", jacket: 7, genre: "Other" };
  const bk = (id) => CATALOG_BY_ID[id] || S.extraBooks[id] || UNKNOWN_BOOK;
  const copy = (id) => S.copies.find((c) => c.id === id);
  const listing = (id) => S.listings.find((l) => l.id === id);
  const openListing = (copyId) => S.listings.find((l) => l.copyId === copyId && !l.closedAt);
  const req = (id) => S.requests.find((r) => r.id === id);
  const exOf = (rid) => S.exchanges.find((x) => x.requestId === rid);
  const user = (id) => USERS[id] || { id, name: "A reader", handle: "reader", city: "", rating: null };
  const first = (id) => (id === "me" ? "You" : user(id).name.split(" ")[0]);
  const stars = (u) => (u && u.rating != null ? "★ " + Number(u.rating).toFixed(1) : "New reader");
  const onWishlist = (bookId) => S.wishlist.me.includes(bookId);
  const ACTIVE_X = ["accepted", "shipped", "delivered", "disputed"];
  const activeExchange = (copyId) => S.exchanges.find((x) => x.copyId === copyId && ACTIVE_X.includes(x.status));
  const isOpenReq = (r) => r.status === "pending" || (r.status === "accepted" && ACTIVE_X.includes((exOf(r.id) || {}).status));
  const requestable = (l) => l && !l.closedAt && copy(l.copyId) && !activeExchange(l.copyId);
  const fees = () => S.fees || PRICING[S.pricing];
  const topupAmounts = () => S.topupAmounts || [5, 10, 20];
  const welcomeListings = () => S.welcomeListings || WELCOME_LISTINGS;
  const hash = (s) => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  // Gives a book from the server (or a search result) a generated jacket to show until its cover loads.
  function decorate(b) {
    const h = hash(b.isbn || b.title);
    const [bg, fg] = PALETTE[h % PALETTE.length];
    return Object.assign({ bg, fg, jacket: (h % 7) + 1, genre: "Other" }, b, { id: b.id || b.isbn });
  }
  // A jacket's accent: a deep ink on light cloth, a bright one on dark cloth.
  const DEEP_ACCENTS = ["#cf5628", "#1f5c55", "#2f4a78", "#b0331f", "#d99a1c", "#6b4a8a", "#3b6b4a"];
  const BRIGHT_ACCENTS = ["#f2c14e", "#f7a982", "#8fcfc1", "#eeb3a6", "#c9b8ea"];
  function accentFor(b) {
    const n = parseInt(String(b.bg).slice(1), 16) || 0;
    const light = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.55;
    const set = light ? DEEP_ACCENTS : BRIGHT_ACCENTS;
    return set[(hash(b.isbn || b.title) >>> 3) % set.length];
  }

  /* ---------------- credit ledger ----------------
     Each entry moves exactly one credit. Balances are derived, never stored. */

  const MOVES = { grant: [1, 0], earn: [1, 0], reserve: [-1, 1], release: [1, -1], spend: [0, -1], reverse: [-1, 0] };

  function balances(u = "me") {
    let available = 0, reserved = 0;
    S.ledger.forEach((e) => { if (e.user === u) { available += MOVES[e.type][0]; reserved += MOVES[e.type][1]; } });
    const pending = S.exchanges.filter((x) => x.sender === u && ["shipped", "delivered", "disputed"].includes(x.status)).length;
    return { available, reserved, pending };
  }

  // Demo only: the same guards the database enforces (supabase/migrations, _post).
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
  const feeFree = () => Math.round((feeBalance() - feesHeld()) * 100) / 100;

  /* ---------------- helpers ---------------- */

  function fmtDay(ms) {
    return new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  function fmtStamp(ms) {
    const d = new Date(ms);
    return { day: d.toLocaleDateString("en-US", { month: "short" }).toUpperCase() + " " + d.getDate(), wd: d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase() };
  }
  function ago(ms) {
    const d = now() - ms;
    if (d < HOUR) return Math.max(1, Math.round(d / 60e3)) + "m";
    if (d < DAY) return Math.round(d / HOUR) + "h";
    return Math.round(d / DAY) + "d";
  }
  function left(ms) {
    const d = ms - now();
    if (d <= 0) return "no time";
    const hours = Math.max(1, Math.round(d / HOUR));
    if (hours < 24) return plural(hours, "hour");
    const days = Math.floor(hours / 24);
    const hrs = hours % 24;
    return plural(days, "day") + (hrs ? " " + hrs + "h" : "");
  }
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  function notify(title, body, go) {
    S.notes.unshift({ id: uid("n"), at: S.now, title, body, go, read: false });
  }
  function log(r, text) {
    r.log.push({ at: S.now, text });
  }
  function clearToast() {
    ui.toast = null;
    clearTimeout(toast.timer);
  }
  function toast(msg) {
    ui.toast = msg;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { ui.toast = null; render(); }, 3200);
  }
  const fakeTracking = () => "94001118992" + String(Math.floor(Math.random() * 1e11)).padStart(11, "0");
  // Same rules as the database (_normalize_tracking), so the demo rejects the same typos.
  function normalizeTracking(carrier, raw) {
    const t = String(raw || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (carrier === "USPS" && /^(\d{20,22}|\d{26}|[A-Z]{2}\d{9}US)$/.test(t)) return t;
    if (carrier === "UPS" && /^1Z[0-9A-Z]{16}$/.test(t)) return t;
    if (carrier === "FedEx" && /^(\d{12}|\d{15}|\d{20}|\d{22})$/.test(t)) return t;
    return null;
  }

  /* ---------------- welcome credit ----------------
     A controlled experiment: one credit, after 3 available listings and a first top-up. */

  function welcomeProgress() {
    const listed = S.listings.filter((l) => !l.closedAt && copy(l.copyId) && copy(l.copyId).owner === "me").length;
    return { listed: Math.min(listed, welcomeListings()), paid: S.payments.some((p) => p.user === "me" && p.kind === "topup") };
  }
  function checkWelcome() {
    if (LIVE || S.me.welcome !== "locked") return;
    const p = welcomeProgress();
    if (p.listed >= welcomeListings() && p.paid && post("me", "grant", null, "Welcome credit")) {
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
    return { r, x, role, other, stage, book: bk(r.bookId), copy: copy(r.copyId) || { cond: "vg", format: "Paperback", flags: [] } };
  }
  const rated = (d) => S.me.ratings[d.r.id] || (d.x && d.x.rated);

  function stageInfo(d) {
    const p = first(d.other);
    const s = d.role === "sender";
    switch (d.stage) {
      case "pending": return s ? { cls: "s-act", text: p + " requested this" } : { cls: "", text: "Waiting on " + p + " to accept" };
      case "accepted": return s ? { cls: "s-warn", text: "Ship in " + left(d.x.shipBy) } : { cls: "", text: p + " is packing it" };
      case "shipped": return s ? { cls: "", text: "In the mail" } : { cls: "s-act", text: "On its way to you" };
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
    const x = { id: uid("x"), requestId: r.id, sender: r.sender, recipient: r.recipient, copyId: r.copyId, status: "accepted", acceptedAt: S.now, shipBy: S.now + SHIP_WINDOW, carrier: "USPS", tracking: null, shippedAt: null, deliveredAt: null, completedAt: null };
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
    x.deliveredAt = x.deliveredAt || S.now;
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

  // Demo only (the server runs worm_tick() every hour): expiries, reminders, missed ship
  // windows, lost packages, auto-confirm.
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
        const outcome = "Tracking hasn't shown a delivery in 10 days, so this exchange is marked lost. " + (x.recipient === "me" ? "Your credit is back." : "No credit was earned. If you bought insurance, file a claim with the carrier.");
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
    credit: '<circle cx="12" cy="12" r="8.5"/><path d="M9 9.5h6M9 12.5h6M9 15.5h3.5"/>',
  };
  const icon = (n, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

  // Three book spines, for empty shelves.
  function spines() {
    return `<svg class="spines" viewBox="0 0 96 72" aria-hidden="true">
      <rect x="14" y="10" width="18" height="56" rx="3" fill="var(--sea)" stroke="var(--edge)" stroke-width="1.5"/>
      <rect x="34" y="18" width="16" height="48" rx="3" fill="var(--sun)" stroke="var(--edge)" stroke-width="1.5"/>
      <rect x="52" y="6" width="14" height="62" rx="3" fill="var(--peach)" stroke="var(--edge)" stroke-width="1.5" transform="rotate(8 59 37)"/>
      <path d="M6 68h84" stroke="var(--edge)" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="23" cy="22" r="3" fill="var(--edge)"/>
      <path d="M38 30h8M38 34h8" stroke="var(--edge)" stroke-width="1.5"/>
    </svg>`;
  }
  function starburst(points = 14) {
    const pts = [];
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 ? 38 : 50;
      const a = (Math.PI * i) / points - Math.PI / 2;
      pts.push((50 + r * Math.cos(a)).toFixed(1) + "," + (50 + r * Math.sin(a)).toFixed(1));
    }
    // A peach copy sits slightly off-register behind the sun-yellow burst, like old two-color print.
    return `<svg viewBox="-2 -2 108 108" aria-hidden="true"><polygon class="burst-back" points="${pts.join(" ")}" transform="translate(5 5)"/><polygon class="burst-fill" points="${pts.join(" ")}"/></svg>`;
  }
  // A scatter of atomic-age shapes behind the sign-in screen.
  function atomicDeco() {
    return `<svg class="deco" viewBox="0 0 120 120" aria-hidden="true">
      <ellipse cx="60" cy="60" rx="52" ry="18" fill="none" stroke="var(--sea)" stroke-width="4" transform="rotate(30 60 60)"/>
      <ellipse cx="60" cy="60" rx="52" ry="18" fill="none" stroke="var(--peach)" stroke-width="4" transform="rotate(-30 60 60)"/>
      <ellipse cx="60" cy="60" rx="52" ry="18" fill="none" stroke="var(--sun)" stroke-width="4" transform="rotate(90 60 60)"/>
      <circle cx="60" cy="60" r="9" fill="var(--lilac)" stroke="var(--edge)" stroke-width="1.5"/>
      <circle cx="104" cy="38" r="4" fill="var(--sage)"/>
    </svg>`;
  }

  /* Arriving content. Each card or book animates the first time it appears, staggered within
     a screen. Its start time is remembered, so a redraw mid-animation continues where it was
     (negative delay) and a redraw afterwards shows it still. */
  const RISE_MS = 560;
  const firstSeen = new Map();
  let riseOrder = 0;
  function rv(key) {
    const t = performance.now();
    if (!firstSeen.has(key)) firstSeen.set(key, t + Math.min(riseOrder++, 12) * 45);
    const delay = firstSeen.get(key) - t;
    return delay < -RISE_MS ? "" : `data-rv style="animation-delay:${Math.round(delay)}ms"`;
  }
  // Cover images fade in over their generated jacket once loaded, and only the first time.
  const loadedCovers = new Set();

  function cover(b, cls = "") {
    const img = LIVE && b.cover ? `<img class="cover-img${loadedCovers.has(b.cover) ? " loaded" : ""}" src="${esc(b.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "";
    return `<div class="cover-wrap"><div class="cover j${Number(b.jacket) || 7} ${cls}" style="--bg:${esc(b.bg)};--fg:${esc(b.fg)};--ac:${accentFor(b)}" role="img" aria-label="Cover of ${esc(b.title)}">
      <span class="j-art"></span>
      <span class="c-title">${esc(b.title)}</span>
      <span class="c-author">${esc(b.author)}</span>
      ${img}
    </div></div>`;
  }

  // Book tiles: the jacket, then title, author and one quiet line of detail.
  function bookTile({ act, id, key, b, flag = "", meta = "", dim = false }) {
    return `<button class="book${dim ? " dim" : ""}" data-act="${act}" data-id="${esc(id)}" ${rv(key)}>
      <div class="book-cover-box">${cover(b)}${flag}</div>
      <span class="b-title">${esc(b.title)}</span>
      <span class="b-author">${esc(b.author)}</span>
      ${meta ? `<span class="b-meta">${meta}</span>` : ""}
    </button>`;
  }
  const BUSY = '<span class="busy">In an exchange</span>';
  const WISH_FLAG = '<span class="flag" role="img" aria-label="On your wishlist">♥</span>';

  function listingTile(l, ctx = "l") {
    const c = copy(l.copyId);
    const b = bk(c.bookId);
    const busy = activeExchange(c.id);
    const flag = !busy && onWishlist(b.id) && c.owner !== "me" ? WISH_FLAG : "";
    return bookTile({ act: "openListing", id: l.id, key: ctx + ":" + l.id, b, flag, meta: busy ? BUSY : COND[c.cond].label, dim: !!busy });
  }

  function copyTile(c) {
    const busy = activeExchange(c.id);
    return bookTile({ act: "openCopy", id: c.id, key: "copy:" + c.id, b: bk(c.bookId), meta: busy ? BUSY : COND[c.cond].label });
  }

  function wishTile(bookId) {
    const avail = S.listings.filter((l) => requestable(l) && copy(l.copyId).bookId === bookId && copy(l.copyId).owner !== "me").length;
    return bookTile({ act: "openBook", id: bookId, key: "wish:" + bookId, b: bk(bookId), meta: avail ? `<span class="avail">${avail} available</span>` : "Watching for a copy" });
  }

  function stampHTML(ms, label = "SHIP BY") {
    const s = fmtStamp(ms);
    return `<span class="stamp ${ms - now() < DAY ? "late" : ""}"><small>${label}</small><b>${s.day}</b><small>${s.wd}</small></span>`;
  }

  function dealCard(d) {
    const st = stageInfo(d);
    const dir = d.role === "sender" ? `To ${esc(user(d.other).name)}` : `From ${esc(user(d.other).name)}`;
    const stamp = d.stage === "accepted" && d.role === "sender" ? stampHTML(d.x.shipBy) : "";
    return `<button class="card tap ${needsMe(d) ? "attn" : ""}" data-act="openDeal" data-id="${esc(d.r.id)}" ${rv("deal:" + d.r.id)}>
      <div class="deal-row">
        ${cover(d.book)}
        <div class="who"><strong>${esc(d.book.title)}</strong><span>${dir} · ${stars(user(d.other))}</span><span class="status ${st.cls}">${esc(st.text)}</span></div>
        ${stamp}
      </div>
    </button>`;
  }

  function creditPill() {
    const b = balances();
    return `<button class="credit-pill" data-act="wallet" aria-label="${plural(b.available, "credit")} available"><span class="coin" aria-hidden="true">✦</span><b>${b.available}</b><span>${b.available === 1 ? "credit" : "credits"}</span></button>`;
  }

  function avatar(cls = "", photo = S.me.photo, name = S.me.name) {
    const initial = ((name || "?").trim()[0] || "?").toUpperCase();
    return photo ? `<img class="avatar ${cls}" src="${esc(photo)}" alt="">` : `<div class="avatar ${cls}">${esc(initial)}</div>`;
  }

  /* ---------------- views ---------------- */

  const discoverPool = () => S.listings.filter((l) => !l.closedAt && copy(l.copyId) && copy(l.copyId).owner !== "me");

  function viewDiscover() {
    return `<div class="view">
      ${greeting()}
      <label class="search" for="q">${icon("search", 18)}<input id="q" type="search" placeholder="Title, author, or ISBN" value="${esc(ui.q)}" autocomplete="off"></label>
      <div id="results">${discoverResults()}</div>
    </div>`;
  }

  function greeting() {
    const h = new Date(now()).getHours();
    const part = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
    const name = (S.me.name || "").trim().split(/\s+/)[0];
    const n = discoverPool().filter(requestable).length;
    const sub = balances().available > 0
      ? `You have ${plural(balances().available, "credit")} to spend, and ${plural(n, "book")} ${n === 1 ? "is" : "are"} ready to request.`
      : `${plural(n, "book")} ${n === 1 ? "is" : "are"} ready to request. Send one of yours to earn a credit.`;
    return `<div class="hello" ${rv("hello")}><h1 class="page-title">${part}${name ? ", " + esc(name) : ""}</h1><p class="lede">${sub}</p></div>`;
  }

  function trendScore(bookId) {
    if (S.trend) return S.trend[bookId] || 0;
    const wants = Object.values(S.wishlist).filter((w) => w.includes(bookId)).length;
    const asks = S.requests.filter((r) => r.bookId === bookId && now() - r.at < 14 * DAY).length;
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
        hits.length ? `<div class="grid">${hits.map((l) => listingTile(l, "hit")).join("")}</div>` : `<div class="empty">${spines()}<h3>Nobody has listed that yet</h3><p>Find it under Scan and add it to your wishlist. We'll tell you the moment someone lists it.</p><button class="btn ghost sm" data-act="tab" data-id="scan">Search all books</button></div>`
      }</div>`;
    }
    let html = welcomeBanner();
    if (!pool.length) {
      return html + `<div class="empty">${spines()}<h3>The shelves are filling up</h3><p>No one near you has listed books yet. Scan yours so the first readers find them.</p><button class="btn primary sm" data-act="tab" data-id="scan">Scan my books</button></div>`;
    }
    const wished = avail.filter((l) => onWishlist(copy(l.copyId).bookId));
    const byTrend = avail.slice().sort((a, z) => trendScore(copy(z.copyId).bookId) - trendScore(copy(a.copyId).bookId));
    const pick = wished[0] || byTrend[0];
    if (pick) html += featureCard(pick, wished.length ? "On your wishlist" : "Most wanted this week");
    const moreWished = wished.filter((l) => l !== pick);
    if (moreWished.length) {
      html += `<div class="section">
        <div class="section-head"><h2>From your wishlist</h2><span class="aside">${wished.length} available</span></div>
        <div class="rail">${moreWished.map((l) => listingTile(l, "wished")).join("")}</div>
      </div>`;
    }
    const trending = byTrend.filter((l) => l !== pick && !wished.includes(l)).slice(0, 8);
    if (trending.length) {
      html += `<div class="section">
        <div class="section-head"><h2>Trending</h2><span class="aside">Most wanted</span></div>
        <div class="rail">${trending.map((l) => listingTile(l, "trend")).join("")}</div>
      </div>`;
    }
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
      <div class="chips scroll" role="group" aria-label="Condition and availability">
        ${conds.map((c) => `<button class="chip sm" data-act="cond" data-id="${c}" aria-pressed="${ui.cond === c}">${c === "all" ? "Any condition" : COND[c].label + " +"}</button>`).join("")}
        <button class="chip sm" data-act="showAll" aria-pressed="${ui.showAll}">Include books in exchanges</button>
      </div>
      ${recent.length ? `<div class="grid">${recent.map((l) => listingTile(l, "recent")).join("")}</div>` : '<p class="lede">No books match these filters yet.</p>'}
    </div>`;
    return html;
  }

  // The one book to look at first. The whole card opens the book; the button requests it.
  function featureCard(l, why) {
    const c = copy(l.copyId);
    const b = bk(c.bookId);
    const o = user(c.owner);
    const asked = S.requests.some((r) => r.listingId === l.id && r.recipient === "me" && r.status === "pending");
    const canAsk = !asked && balances().available > 0;
    return `<div class="feature" ${rv("feature:" + l.id)}>
      <button class="feature-hit" data-act="openListing" data-id="${esc(l.id)}" aria-label="${esc(b.title)} by ${esc(b.author)}"></button>
      ${cover(b, "lg")}
      <div class="who">
        <span class="eyebrow">${esc(why)}</span>
        <h3>${esc(b.title)}</h3>
        <span class="by">${esc(b.author)}</span>
        <span class="meta">${COND[c.cond].label} · @${esc(o.handle)}${o.city ? " · " + esc(o.city) : ""}</span>
        ${canAsk ? `<button class="btn primary sm" data-act="request" data-id="${esc(l.id)}">Request · 1 credit</button>` : asked ? '<span class="meta">Requested</span>' : ""}
      </div>
    </div>`;
  }

  function welcomeBanner() {
    if (S.me.welcome !== "locked") return "";
    const p = welcomeProgress();
    const next = p.listed < welcomeListings() ? 'data-act="tab" data-id="scan"' : 'data-act="topup"';
    return `<button class="card tap welcome" ${next} ${rv("welcome")}>
      <span class="eyebrow">Your first book is on us</span>
      <strong>List ${welcomeListings()} books and add to your fee balance to get a welcome credit.</strong>
      <span class="checks">
        <span class="${p.listed >= welcomeListings() ? "done" : ""}">${p.listed}/${welcomeListings()} books available</span>
        <span class="${p.paid ? "done" : ""}">${p.paid ? "Fee balance added" : "Add to fee balance"}</span>
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
        : `<div class="empty">${spines()}<h3>Nothing available yet</h3><p>Scan the books you've finished. Each one you send earns a credit.</p><button class="btn primary sm" data-act="tab" data-id="scan">Scan books</button></div>`;
    } else if (ui.shelf === "unavailable") {
      body = unavail.length
        ? `<p class="lede">Your library. Hidden from Discover until you make them available.</p><div class="grid">${unavail.map(copyTile).join("")}</div>`
        : `<div class="empty"><h3>Nothing here</h3><p>Books you keep, and books you receive, land here.</p></div>`;
    } else {
      body = wish.length
        ? `<p class="lede">You get an alert the moment someone lists one of these.</p><div class="grid">${wish.map(wishTile).join("")}</div>`
        : `<div class="empty"><h3>Your wishlist is empty</h3><p>Tap any book in Discover, or search under Scan, and add it.</p></div>`;
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
    const isbn = /^(97[89])?\d{9}[\dx]$/.test(digits) ? digits : null;
    if (LIVE) {
      if (isbn) return scanResults([], isbn);
      if (ui.searchHits === "busy") return '<p class="lede">Searching…</p>';
      if (ui.searchHits === "error") return '<p class="lede">Search isn\'t answering right now. Try again, or type the ISBN.</p>';
      if (Array.isArray(ui.searchHits) && q.length >= 2) {
        return ui.searchHits.length ? scanResults(ui.searchHits.map(decorate)) : '<p class="lede">No matches. Try the author\'s name too, or type the ISBN.</p>';
      }
      return "";
    }
    const hits = q ? CATALOG.filter((b) => (b.title + " " + b.author + " " + b.isbn).toLowerCase().includes(q)).slice(0, 6) : [];
    return scanResults(hits, isbn && !hits.length ? isbn : null);
  }

  function viewScan() {
    const camMsg = ui.cam === "unsupported" || ui.cam === "denied"
      ? (LIVE ? "Camera unavailable. Type the ISBN below." : "No camera here. Tap to simulate a scan.")
      : "Tap to start scanning";
    return `<div class="view">
      <h2 class="page-title">Scan</h2>
      <button class="viewfinder" data-act="camera" aria-label="Scan a barcode">
        <span class="screen">
          <span class="corners"></span>
          <span class="beam"></span>
          <span class="vf-text"><strong>Point at the barcode</strong><small>${camMsg}</small></span>
        </span>
        <span class="knobs"><i></i><i></i><i></i></span>
      </button>
      <div class="section">
        <p class="eyebrow">New scans start as</p>
        <div class="chips">${CONDITIONS.map((c) => `<button class="chip sm" data-act="defCond" data-id="${c.id}" aria-pressed="${ui.defCond === c.id}">${c.label}</button>`).join("")}</div>
        <p class="lede">Every scan goes straight onto your shelf as available. Fix any condition below.</p>
      </div>
      ${ui.scanned.length ? `<div class="section">
        <div class="section-head"><h2>Just added</h2><span class="aside">${plural(ui.scanned.length, "book")}</span></div>
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
    return hits.map((b) => {
      const key = LIVE ? b.isbn : b.id;
      return `<div class="result-row" ${rv("hit:" + key)}><div class="mini">${cover(b)}</div><div class="grow"><strong>${esc(b.title)}</strong><p class="lede">${esc(b.author)}${b.year ? ", " + b.year : ""}</p></div><button class="btn ghost sm" data-act="addFromSearch" data-id="${esc(key)}">Add</button><button class="btn ghost sm" data-act="wishSearch" data-id="${esc(key)}">${onWishlist(key) ? "Wished ✓" : "Wish"}</button></div>`;
    }).join("");
  }
  function scanRow(cid) {
    const c = copy(cid);
    if (!c || c.owner !== "me") return "";
    const b = bk(c.bookId);
    const on = !!openListing(c.id);
    return `<div class="scan-row" ${rv("scan:" + c.id)}>
      <div class="mini">${cover(b)}</div>
      <div class="grow">
        <strong>${esc(b.title)}</strong>
        <div class="cond-pick">${CONDITIONS.map((k) => `<button data-act="setCond" data-id="${esc(c.id)}" data-c="${k.id}" aria-pressed="${c.cond === k.id}">${k.short}</button>`).join("")}</div>
      </div>
      <button class="toggle" data-act="toggleListing" data-id="${esc(c.id)}" aria-pressed="${on}" aria-label="Available for exchange"><span></span></button>
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
      ${list.length ? `<div class="list">${list.map(dealCard).join("")}</div>` : `<div class="empty">${spines()}<h3>${empty[0]}</h3><p>${empty[1]}</p></div>`}
    </div>`;
  }

  function viewProfile() {
    const a = S.me.address;
    const b = balances();
    const mineDone = S.exchanges.filter((x) => x.status === "complete" && (x.sender === "me" || x.recipient === "me"));
    const sent = mineDone.filter((x) => x.sender === "me").length;
    const place = [S.me.city, S.me.state].filter(Boolean).join(", ");
    return `<div class="view">
      <div class="profile-head">
        ${avatar()}
        <div class="grow"><h2 class="page-title" style="font-size:var(--t-xl)">${esc(S.me.name || "New reader")}</h2><p class="lede">@${esc(S.me.handle || "you")}${place ? " · " + esc(place) : ""}${S.me.genres.length ? " · " + S.me.genres.map(esc).join(", ") : ""}</p></div>
      </div>
      <button class="link" data-act="editProfile">Edit profile</button>
      <button class="card tap wallet-card" data-act="wallet" ${rv("wallet-card")}>
        <span class="row"><span class="grow"><span class="eyebrow">Book credits</span><span class="big-num">${b.available}</span></span>${icon("arrow", 20)}</span>
        <span class="mini-stats"><span><b>${b.reserved}</b> reserved</span><span><b>${b.pending}</b> pending</span><span><b>${mineDone.length}</b> exchanges</span></span>
      </button>
      <div class="stats">
        <div class="stat" ${rv("stat:sent")}><b>${sent}</b><span>books sent</span></div>
        <div class="stat" ${rv("stat:recv")}><b>${mineDone.length - sent}</b><span>received</span></div>
        <div class="stat" ${rv("stat:fee")}><b>${money(feeFree())}</b><span>fee balance</span></div>
      </div>
      ${S.disputes ? `<button class="card tap attn" data-act="support"><span class="eyebrow">Worm support</span><strong>${S.disputes.length ? plural(S.disputes.length, "problem report") + " to review" : "No open problem reports"}</strong></button>` : ""}
      ${S.me.strikes ? `<p class="note warn"><strong>${plural(S.me.strikes, "strike")}.</strong> Missing a ship window adds one. 3 in 6 months pauses requests.</p>` : ""}
      <div class="section">
        <p class="eyebrow">Shipping address</p>
        <div class="card">
          ${a ? `<p>${esc(a.name)}<br>${esc(a.line1)}${a.line2 ? "<br>" + esc(a.line2) : ""}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}</p>` : '<p class="lede">No address yet. You\'ll add one the first time you request a book.</p>'}
          <p class="lede">Only shown to the one reader shipping you a book, and only until they ship it.</p>
          <button class="btn ghost sm" data-act="editAddress">${a ? "Edit address" : "Add address"}</button>
        </div>
      </div>
      <div class="section">
        <p class="eyebrow">Payments</p>
        <div class="card">
          <div class="kv">
            <div><span class="k">Fee to receive a book</span><span class="v">${money(fees().recipient)}</span></div>
            <div><span class="k">Fee to send a book</span><span class="v">${money(fees().sender)} + your postage</span></div>
            <div><span class="k">Fee balance</span><span class="v">${money(feeFree())}</span></div>
          </div>
          <div class="pay-methods"><span>APPLE PAY</span><span>GOOGLE PAY</span><span>CARDS</span><span>LINK</span></div>
          <p class="lede">Payments happen on Stripe's secure page. Worm never sees or stores your card number.</p>
          <button class="btn ghost sm" data-act="topup">Add to fee balance</button>
        </div>
      </div>
      <div class="section">
        <p class="eyebrow">Appearance</p>
        <div class="seg" role="group" aria-label="Appearance">${LOOKS.map(([id, label]) => `<button data-act="look" data-id="${id}" aria-pressed="${look === id}">${label}</button>`).join("")}</div>
      </div>
      <div class="section">
        <p class="eyebrow">Help</p>
        <div class="card">
          <button class="link" data-act="how">How Worm works</button>
          <button class="link" data-act="shipping">How to ship a book</button>
          <button class="link" data-act="conditions">Condition guide</button>
          <a class="link" href="legal/terms.html" target="_blank" rel="noopener">Terms</a>
          <a class="link" href="legal/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>
        </div>
      </div>
      <div class="btns">
        <button class="btn ghost" data-act="signOut">Sign out</button>
        <button class="btn danger" data-act="deleteAccount">Delete account</button>
      </div>
    </div>`;
  }

  /* ---------------- sign in ---------------- */

  // Brand marks for the sign-in buttons. Apple logo path: Font Awesome Free (CC BY 4.0).
  const APPLE_LOGO = '<svg viewBox="0 0 384 512" aria-hidden="true"><path fill="currentColor" d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>';
  const GOOGLE_LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

  function viewSignIn() {
    const codeStep = ui.otpEmail
      ? `<form id="otpForm" class="list">
          <p class="lede">We emailed a sign-in link and a 6-digit code to <strong>${esc(ui.otpEmail)}</strong>. Tap the link, or type the code here.</p>
          <div class="field"><label for="si-code">6-digit code</label><input id="si-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div>
          <button class="btn primary" type="submit">Sign in</button>
          <button class="link" type="button" data-act="otpBack">Use a different email</button>
        </form>`
      : `<form id="emailForm" class="list">
          <div class="field"><label for="si-email">Email</label><input id="si-email" name="email" type="email" required autocomplete="email" placeholder="you@example.com"></div>
          <button class="btn ghost" type="submit">Email me a sign-in link</button>
        </form>`;
    return `<div class="signin ${entering("signin")}">
      <div class="hero">${atomicDeco()}<h2>Your shelf is full of books <em>someone else wants.</em></h2>
        <p class="lede">Send the books you've finished. Earn a credit for each one. Spend credits on your next read.</p></div>
      <div class="list">
        <button class="btn auth-btn apple" data-act="signIn" data-id="apple">${APPLE_LOGO} Continue with Apple</button>
        <button class="btn auth-btn google" data-act="signIn" data-id="google">${GOOGLE_LOGO} Continue with Google</button>
      </div>
      <div class="or">or</div>
      ${codeStep}
      <p class="fine">No passwords to remember. By continuing you agree to Worm's <a href="legal/terms.html" target="_blank" rel="noopener">Terms</a> and <a href="legal/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>. Worm is for readers 18 and over in the US.</p>
    </div>`;
  }

  // Placeholder shelves that shimmer while the real ones load.
  function viewLoading() {
    const book = `<span class="skel-book"><span class="skel cover-skel"></span><span class="skel line"></span><span class="skel line w40"></span></span>`;
    return `<div class="view" aria-busy="true" aria-label="Loading your shelf">
      <div class="hello"><span class="skel title big"></span><span class="skel line w70"></span></div>
      <span class="skel pill"></span>
      <span class="skel hero"></span>
      <span class="skel title"></span>
      <div class="rail">${book.repeat(4)}</div>
      <span class="skel title"></span>
      <div class="grid">${book.repeat(6)}</div>
    </div>`;
  }

  /* ---------------- onboarding ---------------- */

  const draft = (k, fallback) => (ui.draft[k] !== undefined ? ui.draft[k] : fallback);

  function profileFields() {
    const handle = draft("handle", S.me.handle || "");
    const hint = ui.handleHint || "3 to 20 letters, numbers, dots or underscores.";
    return `<div class="row">${avatar("lg", draft("photo", S.me.photo), draft("name", S.me.name))}<label class="btn ghost sm" for="photo">${draft("photo", S.me.photo) ? "Change photo" : "Add a photo"}</label><input id="photo" type="file" accept="image/*" hidden></div>
      <div class="field"><label for="ob-name">Your name</label><input id="ob-name" data-draft="name" value="${esc(draft("name", S.me.name))}" autocomplete="name" placeholder="First and last name" maxlength="60"></div>
      <div class="field"><label for="ob-handle">Handle</label><div class="prefix"><span>@</span><input id="ob-handle" data-draft="handle" value="${esc(handle)}" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" placeholder="bookworm"></div><span class="hint ${ui.handleOk === false ? "bad" : ui.handleOk ? "good" : ""}" id="handleHint">${esc(hint)}</span></div>
      <div class="fields-city">
        <div class="field"><label for="ob-city">City</label><input id="ob-city" data-draft="city" value="${esc(draft("city", S.me.city || ""))}" autocomplete="address-level2" maxlength="60"></div>
        <div class="field"><label for="ob-state">State</label><select id="ob-state" data-draft="state" autocomplete="address-level1"><option value="">–</option>${US_STATES.map((st) => `<option ${st === draft("state", S.me.state) ? "selected" : ""}>${st}</option>`).join("")}</select></div>
      </div>
      <p class="lede">Other readers see your name, handle, photo and city. Your street address stays private.</p>`;
  }

  function viewOnboarding() {
    const step = ui.ob;
    const dots = `<div class="ob-dots" aria-label="Step ${step + 1} of 4">${[0, 1, 2, 3].map((i) => `<span class="${i <= step ? "on" : ""}"></span>`).join("")}</div>`;
    let body = "";
    if (step === 0) {
      body = `<h1 class="ob-title">Set up your reader profile</h1>
        ${profileFields()}
        <button class="btn primary" data-act="obNext">Continue</button>`;
    } else if (step === 1) {
      body = `<h1 class="ob-title">What do you like to read?</h1>
        <p class="ob-lede">We'll put the right books in front of you.</p>
        <div class="chips">${GENRES.map((g) => `<button class="chip" data-act="obGenre" data-id="${esc(g)}" aria-pressed="${S.me.genres.includes(g)}">${esc(g)}</button>`).join("")}</div>
        <button class="btn primary" data-act="obNext">Continue</button>`;
    } else if (step === 2) {
      const source = LIVE ? Object.values(S.extraBooks) : CATALOG;
      const picks = source.filter((b) => !S.me.genres.length || S.me.genres.includes(b.genre)).slice(0, 9);
      const list = picks.length ? picks : source.slice(0, 9);
      body = `<h1 class="ob-title">Any books you're hoping to read?</h1>
        <p class="ob-lede">Tap a few. We'll alert you when someone lists one.</p>
        ${list.length ? `<div class="pick">${list.map((b) => `<button class="book" data-act="obWish" data-id="${esc(b.id)}" aria-pressed="${onWishlist(b.id)}"><div class="book-cover-box">${cover(b)}</div><span class="b-title">${esc(b.title)}</span></button>`).join("")}</div>` : '<p class="note">Nobody has listed books yet. You can add wishes any time from Scan → search.</p>'}
        <button class="btn primary" data-act="obNext">Continue</button>`;
    } else {
      const steps = [
        ["List", "Scan the books you've finished. Anyone can request them."],
        ["Earn", "Ship a requested book. When it arrives, you earn 1 credit."],
        ["Discover", "Browse books from readers across the US."],
        ["Request", "Spend 1 credit + " + money(fees().recipient) + " on any available book, from anyone. You never need to want each other's books."],
      ];
      body = `<h1 class="ob-title">How Worm works</h1>
        <ol class="loop">${steps.map(([h, p]) => `<li><strong>${h}</strong><span>${p}</span></li>`).join("")}</ol>
        <p class="note stamped">List ${welcomeListings()} books and make your first fee-balance top-up, and your first credit is on us.</p>
        <button class="btn primary" data-act="obDone">Scan my first books</button>`;
    }
    return `<div class="view onboarding ${entering("ob" + step)}">${dots}${body}${step > 0 ? '<button class="link" data-act="obBack">Back</button>' : ""}</div>`;
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
    if (!l || !copy(l.copyId)) return '<p class="lede">This book is no longer listed.</p>';
    const c = copy(l.copyId);
    const b = bk(c.bookId);
    const bal = balances();
    const busy = activeExchange(c.id);
    const mine = c.owner === "me";
    const o = mine ? null : user(c.owner);
    const already = S.requests.some((r) => r.listingId === l.id && r.recipient === "me" && r.status === "pending");
    let cta;
    if (mine) cta = `<button class="btn ghost" data-act="openCopy" data-id="${esc(c.id)}">Manage this copy</button>`;
    else if (l.closedAt) cta = `<button class="btn primary" disabled>No longer available</button>`;
    else if (busy) cta = `<button class="btn primary" disabled>In an exchange right now</button>`;
    else if (already) cta = `<button class="btn primary" disabled>Requested. Waiting on ${esc(first(c.owner))}</button>`;
    else if (bal.available < 1) cta = `<button class="btn primary" disabled>You need 1 credit</button><p class="lede">Send a book from your shelf to earn one.${S.me.welcome === "locked" ? " Or list " + welcomeListings() + " books and add to your fee balance for a welcome credit." : ""}</p>`;
    else cta = `<button class="btn primary" data-act="request" data-id="${esc(l.id)}">Request this book</button>`;
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
            <div class="isbn">ISBN ${esc(b.isbn)}</div>
          </div>
        </div>
      </div>
      <p class="note">${COND[c.cond].label}: ${COND[c.cond].desc}</p>
      ${o ? `<div class="row">${avatar("sm", o.avatar, o.name)}<div class="grow"><strong>${esc(o.name)}</strong> <span class="lede">@${esc(o.handle)}</span><p class="lede">${stars(o)}${o.city ? " · ships from " + esc(o.city) : ""}</p></div></div>` : ""}
      ${o ? costBox(c) : ""}
      ${cta}
      ${o ? `<button class="btn ghost" data-act="wish" data-id="${esc(b.id)}">${onWishlist(b.id) ? "On your wishlist ✓" : "Add to wishlist"}</button>` : ""}
    `;
  }

  function sheetBook(s) {
    const b = bk(s.id);
    const avail = S.listings.filter((l) => requestable(l) && copy(l.copyId).bookId === b.id && copy(l.copyId).owner !== "me");
    return `
      <div class="detail">
        ${cover(b, "lg")}
        <div><h3>${esc(b.title)}</h3><p class="by">${esc(b.author)}${b.year ? ", " + b.year : ""}</p><p class="isbn" style="margin-top:8px">ISBN ${esc(b.isbn)}</p></div>
      </div>
      ${avail.length
        ? `<div class="section"><p class="eyebrow">Available copies</p><div class="list">${avail.map((l) => { const c = copy(l.copyId); return `<button class="card tap" data-act="openListing" data-id="${esc(l.id)}"><span class="row"><span class="cond">${COND[c.cond].short}</span><span class="grow">${esc(c.format)} · @${esc(user(c.owner).handle)}</span><span class="lede">${stars(user(c.owner))}</span></span></button>`; }).join("")}</div></div>`
        : `<p class="note">Nobody has listed this yet. You'll get an alert when someone does.</p>`}
      <button class="btn ghost" data-act="wish" data-id="${esc(b.id)}">${onWishlist(b.id) ? "Remove from wishlist" : "Add to wishlist"}</button>
    `;
  }

  function sheetRequest(s) {
    const l = listing(s.id);
    if (!requestable(l)) return '<p class="lede">This book is no longer available.</p>';
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
        <button class="link" data-act="editAddress" data-back="${esc(l.id)}">${a ? "Change address" : "Add a US shipping address"}</button>
      </div>
      ${!feeOk ? `<p class="note warn">Your fee balance is ${money(feeFree())}. Add to it to cover the ${money(fee)} fee.</p><button class="btn ghost" data-act="topup" data-back="${esc(l.id)}">Add to fee balance</button>` : ""}
      <p class="lede">${esc(first(c.owner))} has 48 hours to accept, then 3 days to ship. If either doesn't happen, your credit comes straight back. The fee is only taken when the book arrives.</p>
      <button class="btn primary" data-act="sendRequest" data-id="${esc(l.id)}" ${a && feeOk ? "" : "disabled"}>Request for 1 credit</button>
    `;
  }

  function progress(d) {
    const steps = ["Requested", "Accepted", "Shipped", "Delivered", "Complete"];
    const at = { pending: 0, accepted: 1, shipped: 2, delivered: 3, disputed: 3, complete: 4 }[d.stage];
    if (at == null) return "";
    return `<ol class="progress">${steps.map((s, i) => `<li class="${i <= at ? "on" : ""}${i === at ? " now" : ""}"><span></span>${s}</li>`).join("")}</ol>`;
  }

  function shipToCard(d) {
    const a = d.x.shipTo;
    if (a) return `<div class="card"><p class="eyebrow">Ship to</p><p>${esc(a.name)}<br>${esc(a.line1)}${a.line2 ? "<br>" + esc(a.line2) : ""}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}</p><p class="lede">This address disappears once you add tracking.</p></div>`;
    return `<div class="card"><p class="eyebrow">Ship to</p><p>${esc(user(d.other).name)}<br>${esc(user(d.other).city)}</p><p class="lede">The full street address shows here while you're shipping to them.</p></div>`;
  }

  function sheetDeal(s) {
    const r = req(s.id);
    if (!r) return '<p class="lede">We couldn\'t find that exchange.</p>';
    const d = deal(r);
    const x = d.x;
    const p = first(d.other);
    const st = stageInfo(d);
    const c = d.copy;
    const creditLine = d.role === "sender"
      ? `<p class="credit-line">${icon("credit", 18)} You earn 1 credit when ${esc(p)} confirms it arrived.</p>`
      : `<p class="credit-line">${icon("credit", 18)} 1 credit reserved. It's spent when the book arrives.</p>`;
    const confirmButtons = `<div class="btns"><button class="btn primary" data-act="confirmBook" data-id="${esc(r.id)}">It arrived. Looks right</button><button class="btn ghost" data-act="report" data-id="${esc(r.id)}">Report a problem</button></div>`;
    let main;

    if (d.stage === "pending" && d.role === "sender") {
      main = `<p class="note stamped">${esc(p)} wants your ${COND[c.cond].label} copy of <strong>${esc(d.book.title)}</strong>. Accept within ${left(r.at + REQUEST_TTL)}, then ship within 3 days.</p>
        ${creditLine}
        <div class="btns"><button class="btn primary" data-act="accept" data-id="${esc(r.id)}">Accept</button><button class="btn ghost" data-act="decline" data-id="${esc(r.id)}">Decline</button></div>
        <p class="lede">You pay the postage (about $4 to $5 with USPS Media Mail)${r.fees.sender ? " and a " + money(r.fees.sender) + " fee once it arrives" : ""}.</p>`;
    } else if (d.stage === "pending") {
      main = `<p class="note">Waiting on ${esc(p)}. They have ${left(r.at + REQUEST_TTL)} to accept.</p>${creditLine}
        <button class="btn danger" data-act="withdraw" data-id="${esc(r.id)}">Cancel request</button>`;
    } else if (d.stage === "accepted" && d.role === "sender") {
      main = `<div class="row"><div class="grow"><strong>Ship it to ${esc(p)}</strong><p class="lede">${left(x.shipBy)} left to add tracking.</p></div>${stampHTML(x.shipBy)}</div>
        ${creditLine}
        ${shipToCard(d)}
        <button class="btn primary" data-act="addTracking" data-id="${esc(r.id)}">I've shipped it: add tracking</button>
        <button class="link" data-act="shipping">How to ship a book</button>`;
    } else if (d.stage === "accepted") {
      main = `<p class="note">${esc(p)} accepted and has until ${fmtDay(x.shipBy)} to ship.</p>${creditLine}`;
    } else if (d.stage === "shipped") {
      main = `<div class="card"><p class="eyebrow">Tracking</p><p class="mono">${esc(x.carrier)} ${esc(x.tracking)}</p><p class="lede">Shipped ${fmtDay(x.shippedAt)}. We check tracking automatically.</p></div>${creditLine}
        ${d.role === "recipient" ? `<p class="lede">Already have it in your hands? Confirm it now.</p>${confirmButtons}` : ""}`;
    } else if (d.stage === "delivered" && d.role === "recipient") {
      main = `<p class="note stamped">${esc(d.book.title)} was delivered. Does it match the listing (${COND[c.cond].label}${c.flags.length ? ", " + c.flags.map(esc).join(", ").toLowerCase() : ""})? It confirms automatically in ${left(x.deliveredAt + CONFIRM_WINDOW)}.</p>
        ${confirmButtons}`;
    } else if (d.stage === "delivered") {
      main = `<p class="note">Delivered ${fmtDay(x.deliveredAt)}. ${esc(p)} has until ${fmtDay(x.deliveredAt + CONFIRM_WINDOW)} to report a problem, then your credit arrives.</p>${creditLine}`;
    } else if (d.stage === "disputed") {
      main = `<p class="note warn"><strong>Problem reported: ${esc(x.dispute)}.</strong> Support reviews photos within 1 business day. If the listing was wrong, the recipient's credit goes back to them, and the sender earns nothing and gets a strike.</p>`;
    } else if (d.stage === "complete") {
      const stars5 = rated(d);
      main = `<p class="note">${d.role === "sender" ? "You earned 1 credit for sending this book." : esc(d.book.title) + " is on your shelf under Not available. Make it available when you're done reading."}</p>
        ${stars5 ? `<p class="lede">You rated ${esc(p)} ${stars5} stars.</p>` : `<div class="section"><p class="eyebrow">Rate ${esc(p)}</p><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-act="rate" data-id="${esc(r.id)}" data-n="${n}" aria-label="${n} stars">★</button>`).join("")}</div></div>`}`;
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
    return `<form id="trackForm" class="section" data-id="${esc(r.id)}">
      <p class="lede">Ship ${esc(bk(r.bookId).title)} to ${esc(first(r.recipient))}, then enter the tracking number from your receipt.</p>
      <div class="field"><label for="t-carrier">Carrier</label><select id="t-carrier" name="carrier">${["USPS", "UPS", "FedEx"].map((c) => `<option>${c}</option>`).join("")}</select></div>
      <div class="field"><label for="t-num">Tracking number</label><input id="t-num" name="tracking" required autocomplete="off" placeholder="9400 1118 9922 ..." maxlength="40"></div>
      ${LIVE ? "" : '<button type="button" class="link" data-act="sampleTracking">Demo: fill in a sample number</button>'}
      <p class="note">Your credit arrives when the book is delivered and ${esc(first(r.recipient))} confirms it, not when you add tracking. Each tracking number can only be used once.</p>
      <button class="btn primary" type="submit">Save tracking</button>
    </form>`;
  }

  function sheetReport(s) {
    return `
      <p class="lede">Tell us what's wrong. Keep the book and packaging until this is resolved; support may ask for photos.</p>
      <div class="options">${REPORT_REASONS.map((r) => `<button class="option" data-act="pickReason" data-id="${esc(r)}" aria-pressed="${s.reason === r}"><span class="radio"></span><span><strong>${esc(r)}</strong></span></button>`).join("")}</div>
      <button class="btn primary" data-act="submitReport" data-id="${esc(s.id)}" ${s.reason ? "" : "disabled"}>Report problem</button>
    `;
  }

  function sheetCopy(s) {
    const c = copy(s.id);
    if (!c) return '<p class="lede">This book is no longer on your shelf.</p>';
    const b = bk(c.bookId);
    const l = openListing(c.id);
    const busy = activeExchange(c.id);
    const dis = busy ? "disabled" : "";
    return `
      <div class="detail" style="grid-template-columns:96px minmax(0,1fr)">${cover(b)}<div><h3>${esc(b.title)}</h3><p class="by">${esc(b.author)}</p><p class="isbn">ISBN ${esc(b.isbn)}</p></div></div>
      <div class="row"><div class="grow"><strong>Available for exchange</strong><p class="lede">${l ? "Anyone can request it." : "Hidden from Discover."}</p></div>
        <button class="toggle" data-act="toggleListing" data-id="${esc(c.id)}" aria-pressed="${!!l}" ${dis} aria-label="Available for exchange"><span></span></button></div>
      ${busy ? '<p class="note">This copy is in an exchange, so it can\'t be changed right now.</p>' : ""}
      <div class="section"><p class="eyebrow">Condition</p>
        <div class="options">${CONDITIONS.map((k) => `<button class="option" data-act="setCond" data-id="${esc(c.id)}" data-c="${k.id}" aria-pressed="${c.cond === k.id}" ${dis}><span class="radio"></span><span><strong>${k.label}</strong><span>${k.desc}</span></span></button>`).join("")}</div>
      </div>
      <div class="section"><p class="eyebrow">Format</p>
        <div class="chips">${["Hardcover", "Paperback", "Mass market"].map((f) => `<button class="chip" data-act="setFormat" data-id="${esc(c.id)}" data-f="${f}" aria-pressed="${c.format === f}" ${dis}>${f}</button>`).join("")}</div>
      </div>
      <div class="section"><p class="eyebrow">Anything to disclose?</p>
        <div class="chips">${FLAGS.map((f) => `<button class="chip" data-act="setFlag" data-id="${esc(c.id)}" data-f="${esc(f)}" aria-pressed="${c.flags.includes(f)}" ${dis}>${esc(f)}</button>`).join("")}</div>
      </div>
      <button class="btn danger" data-act="removeCopy" data-id="${esc(c.id)}" ${dis}>Remove from my shelf</button>
    `;
  }

  function sheetWallet() {
    const b = balances();
    const avail = discoverPool().filter(requestable).length;
    const mine = S.ledger.filter((e) => e.user === "me").reverse().sort((a, z) => z.at - a.at);
    const label = { grant: ["Welcome credit", "+1"], earn: ["Earned", "+1"], reserve: ["Reserved", "held"], release: ["Returned", "+1"], spend: ["Spent", "used"], reverse: ["Reversed", "−1"] };
    const pays = S.payments.filter((p) => p.user === "me").reverse().sort((a, z) => z.at - a.at);
    const payLabel = { topup: ["Added", "+"], fee: ["Fee", "−"], refund: ["Refunded", "−"] };
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
        ${pays.length ? `<div class="ledger-list">${pays.map((p) => `<div><span class="grow"><strong>${payLabel[p.kind][0]}</strong><span class="lede">${esc(p.note)}</span></span><span class="amt">${payLabel[p.kind][1]}${money(p.amount)}</span><time>${fmtDay(p.at)}</time></div>`).join("")}</div>` : '<p class="lede">No payments yet.</p>'}
        <button class="btn ghost sm" data-act="topup">Add to fee balance</button>
        <p class="lede">Fees come out of a prepaid balance, so card processing doesn't eat a third of every $1.</p>
      </div>`;
  }

  function sheetTopup(s) {
    const amounts = topupAmounts();
    const amt = s.amount || amounts[0];
    return `
      <p class="lede">One payment covers several exchanges. Fees are only taken when a book arrives.</p>
      <div class="options">${amounts.map((n) => `<button class="option" data-act="pickTopup" data-id="${n}" aria-pressed="${amt === n}"><span class="radio"></span><span><strong>${money(n)}</strong><span>Covers ${Math.floor(n / Math.max(fees().recipient, 1))} books received</span></span></button>`).join("")}</div>
      <div class="pay-methods"><span>APPLE PAY</span><span>GOOGLE PAY</span><span>CARDS</span><span>LINK</span></div>
      <p class="lede">You'll finish on Stripe's secure checkout page. Worm never sees or stores your card number.</p>
      <button class="btn primary" data-act="confirmTopup" data-back="${esc(s.back || "")}">Continue to pay ${money(amt)}</button>`;
  }

  // Demo only: stands in for Stripe's hosted checkout page.
  function sheetStripe(s) {
    return `
      <p class="note">In the real app you'd be on Stripe's own page now, at checkout.stripe.com. This preview stands in for it.</p>
      <div class="card">
        <div class="kv">
          <div><span class="k">Worm fee balance</span><span class="v">${money(s.amount)}</span></div>
        </div>
        <button class="btn auth-btn apple" data-act="demoPay" data-back="${esc(s.back || "")}">${APPLE_LOGO} Pay</button>
        <button class="btn ghost" data-act="demoPay" data-back="${esc(s.back || "")}">Pay with card</button>
      </div>
      <button class="link" data-act="close">Cancel and go back to Worm</button>`;
  }

  function sheetAddress(s) {
    const a = S.me.address || { name: S.me.name, line1: "", line2: "", city: S.me.city || "", state: S.me.state || "NY", zip: "" };
    return `<form id="addrForm" class="section" data-back="${esc(s.back || "")}">
      <div class="field"><label for="a-name">Full name</label><input id="a-name" name="name" value="${esc(a.name)}" required autocomplete="name" maxlength="80"></div>
      <div class="field"><label for="a-line1">Street address</label><input id="a-line1" name="line1" value="${esc(a.line1)}" required autocomplete="address-line1" maxlength="100"></div>
      <div class="field"><label for="a-line2">Apartment, suite (optional)</label><input id="a-line2" name="line2" value="${esc(a.line2 || "")}" autocomplete="address-line2" maxlength="100"></div>
      <div class="fields-2">
        <div class="field"><label for="a-city">City</label><input id="a-city" name="city" value="${esc(a.city)}" required autocomplete="address-level2" maxlength="60"></div>
        <div class="field"><label for="a-state">State</label><select id="a-state" name="state" required autocomplete="address-level1">${US_STATES.map((st) => `<option ${st === a.state ? "selected" : ""}>${st}</option>`).join("")}</select></div>
        <div class="field"><label for="a-zip">ZIP</label><input id="a-zip" name="zip" value="${esc(a.zip)}" required inputmode="numeric" pattern="[0-9]{5}" autocomplete="postal-code" maxlength="10"></div>
      </div>
      <p class="lede">Worm ships within the US only. Only the reader sending you a book sees this, and only until they ship.</p>
      <button class="btn primary" type="submit">Save address</button>
    </form>`;
  }

  function sheetEditProfile() {
    return `${profileFields()}
      <div class="section"><p class="eyebrow">Favorite genres</p>
        <div class="chips">${GENRES.map((g) => `<button class="chip" data-act="obGenre" data-id="${esc(g)}" aria-pressed="${S.me.genres.includes(g)}">${esc(g)}</button>`).join("")}</div>
      </div>
      <button class="btn primary" data-act="saveProfile">Save profile</button>`;
  }

  // Support accounts only (profiles.is_admin): rule on reported problems.
  function sheetSupport() {
    const list = S.disputes || [];
    if (!list.length) return '<p class="lede">No open problem reports.</p>';
    return `<p class="lede">"Recipient was right" returns their credit, gives the sender no credit and a strike. "Book matched" completes the exchange normally.</p>
      <div class="list">${list.map((x) => `<div class="card" ${rv("dispute:" + x.requestId)}>
        <strong>${esc(x.title)}</strong>
        <p class="lede">${esc(x.sender)} (@${esc(x.senderHandle)}) → ${esc(x.recipient)} (@${esc(x.recipientHandle)})</p>
        <p class="note warn">${esc(x.reason)}</p>
        <p class="lede">Listed as ${esc((COND[x.condition] || {}).label || x.condition)}. ${esc(x.carrier || "")} <span class="mono">${esc(x.tracking || "")}</span></p>
        <div class="btns"><button class="btn primary sm" data-act="rule" data-id="${esc(x.requestId)}" data-upheld="1">Recipient was right</button><button class="btn ghost sm" data-act="rule" data-id="${esc(x.requestId)}" data-upheld="0">Book matched</button></div>
      </div>`).join("")}</div>`;
  }

  function sheetDeleteAccount() {
    return `
      <p>Deleting your account removes your profile, photo, address, wishlist and alerts, takes your books off Worm, and signs you out everywhere.</p>
      <p class="lede">Unspent credits and fee balance can't be recovered. A record of past exchanges and payments is kept, without your name, because the law requires it.</p>
      <p class="note warn">If you're in the middle of an exchange, finish it first.</p>
      <button class="btn danger" data-act="confirmDelete">Delete my account</button>`;
  }

  function sheetAlerts() {
    if (!S.notes.length) return '<p class="lede">No alerts yet.</p>';
    return `${S.notes.some((n) => !n.read) ? '<button class="link" data-act="readAll">Mark all read</button>' : ""}
      <div>${S.notes.map((n) => `<button class="alert ${n.read ? "" : "unread"}" data-act="openNote" data-id="${esc(n.id)}" ${rv("note:" + n.id)}>
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
    const body = s.kind === "welcome" || !r
      ? "You listed your first books, so your first request is on us."
      : esc(bk(r.bookId).title) + " reached " + esc(first(r.recipient)) + ". It's on their shelf now.";
    return `<div class="celebrate">
      <span class="burst">${starburst()}<b>+1</b><small>credit</small></span>
      <h3>${title}</h3>
      <p>${body}</p>
      <p class="lede">You have ${plural(b.available, "credit")}. ${plural(avail, "book")} ${avail === 1 ? "is" : "are"} ready for you to discover.</p>
      <button class="btn pop" data-act="tab" data-id="discover">Find my next book</button>
    </div>`;
  }

  function sheetHow() {
    const steps = [
      ["List", "Scan your books and mark the ones you're done with as available."],
      ["Someone requests one", "Accept within 48 hours. Ship within 3 days with any carrier (USPS Media Mail is cheapest) and add tracking."],
      ["Earn a credit", "When the book is delivered and the reader confirms (or 2 days pass), you get 1 credit."],
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
      <li><strong>Add tracking in Worm</strong><br>Within 3 days of accepting. We check it automatically from there.</li>
    </ol>
    <p class="note">Coming later: buy a prepaid label right inside Worm.</p>`;
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
          <div><span class="k">Your top-ups (Stripe cost)</span><span class="v">${topups.length} (${money(cardCost)})</span></div>
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
    stripe: [sheetStripe, "Checkout"], address: [sheetAddress, "Shipping address"], alerts: [sheetAlerts, "Alerts"],
    celebrate: [sheetCelebrate, ""], how: [sheetHow, "How Worm works"], shipping: [sheetShipping, "How to ship a book"],
    conditions: [sheetConditions, "Condition guide"], demo: [sheetDemo, "Demo controls"],
    editProfile: [sheetEditProfile, "Edit profile"], deleteAccount: [sheetDeleteAccount, "Delete account"], support: [sheetSupport, "Problem reports"],
  };

  /* ---------------- render ---------------- */

  const app = document.getElementById("app");
  // Returns "entering" the first time a screen is drawn, so its parts rise in once.
  let lastScreen = null;
  let screenNow = null;
  function entering(key) {
    screenNow = key;
    return key !== lastScreen ? "entering" : "";
  }

  /* Appearance: light unless the reader picks otherwise. Saved on this device only. */
  const LOOKS = [["light", "Light"], ["dark", "Dark"], ["auto", "Match my phone"]];
  const LOOK_KEY = "worm-look";
  const systemDark = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  let look = "light";
  try { look = localStorage.getItem(LOOK_KEY) || "light"; } catch (e) { /* storage blocked: stay light */ }
  function applyLook() {
    const dark = look === "dark" || (look === "auto" && !!systemDark && systemDark.matches);
    document.documentElement.dataset.look = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
    meta.content = dark ? "#1e1a16" : "#f3ede2";
  }
  applyLook();
  if (systemDark && systemDark.addEventListener) systemDark.addEventListener("change", () => look === "auto" && applyLook());

  function render() {
    const signedOut = LIVE ? ui.screen === "signin" : !S.signedIn;
    const loading = ui.screen === "loading" && (LIVE || S.signedIn);
    const onboarding = !signedOut && !loading && (!S.me.onboarded || ui.obActive);
    const inApp = !signedOut && !loading && !onboarding;
    const unread = S.notes.filter((n) => !n.read).length;
    const todo = inApp ? myDeals().filter(needsMe).length : 0;
    const views = { discover: viewDiscover, shelf: viewShelf, scan: viewScan, exchanges: viewExchanges, profile: viewProfile };
    const tabs = [["discover", "Discover", 0], ["shelf", "My Shelf", 0], ["scan", "Scan", 0], ["exchanges", "Exchanges", todo], ["profile", "Profile", 0]];
    let sheet = "";
    if (ui.sheet && SHEETS[ui.sheet.type]) {
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
    riseOrder = 0;
    screenNow = null;
    const body = signedOut ? viewSignIn() : loading ? viewLoading() : onboarding ? viewOnboarding() : views[ui.tab]();
    lastScreen = screenNow;
    app.innerHTML = `
      <header class="top">
        <div class="brand"><h1>worm</h1></div>
        ${inApp ? creditPill() : ""}
        ${inApp ? `<button class="icon-btn" data-act="alerts" aria-label="Alerts${unread ? ", " + unread + " unread" : ""}">${icon("bell", 22)}${unread ? `<span class="badge">${unread}</span>` : ""}</button>` : ""}
        ${LIVE ? "" : '<button class="demo-btn" data-act="demo">Demo</button>'}
        ${ui.busy ? '<span class="busy-bar" role="progressbar" aria-label="Working"></span>' : ""}
      </header>
      ${body}
      ${inApp ? `<div class="tabbar"><nav>${tabs.map(([id, label, n]) => `<button class="${id === "scan" ? "scan-tab" : ""}" data-act="tab" data-id="${id}" ${ui.tab === id ? 'aria-current="page"' : ""}><span class="ti">${icon(id)}</span>${label}${n ? `<span class="badge">${n}</span>` : ""}</button>`).join("")}</nav></div>` : ""}
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

  /* ---------------- photos ---------------- */

  // Shrinks a photo to a 320px square JPEG. Redrawing it also drops the location data (EXIF)
  // that phones attach to pictures.
  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = cv.height = 320;
        const s = Math.min(img.width, img.height);
        cv.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 320, 320);
        URL.revokeObjectURL(img.src);
        cv.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't read that photo."))), "image/jpeg", 0.85);
      };
      img.onerror = () => reject(new Error("Couldn't read that photo."));
      img.src = URL.createObjectURL(file);
    });
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

  // Demo mode on a real phone: look the ISBN up straight from Open Library.
  async function demoLookupIsbn(isbn) {
    const local = CATALOG.find((b) => b.isbn === isbn) || Object.values(S.extraBooks).find((b) => b.isbn === isbn);
    if (local) return local;
    try {
      const res = await fetch("https://openlibrary.org/api/books?bibkeys=ISBN:" + isbn + "&format=json&jscmd=data");
      const d = (await res.json())["ISBN:" + isbn];
      if (!d) return null;
      const b = decorate({ id: "x" + isbn, isbn, title: d.title, author: (d.authors || []).map((a) => a.name).join(", ") || "Unknown author", year: parseInt(d.publish_date, 10) || "" });
      S.extraBooks[b.id] = b;
      return b;
    } catch (e) {
      return null;
    }
  }

  async function addByIsbn(isbn) {
    if (LIVE) return liveAddByIsbn(isbn);
    toast("Looking up " + isbn + "…");
    render();
    const b = await demoLookupIsbn(isbn);
    if (!b) return toast("Couldn't find ISBN " + isbn + ". Try searching by title."), render();
    const c = addCopy(b.id);
    ui.scanned.unshift(c.id);
    ui.scanQ = "";
    commit("Added " + b.title);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Couldn't load " + src));
      document.head.appendChild(s);
    });
  }

  // Camera scanning. Uses the browser's own barcode reader where there is one (Chrome on
  // Android), and the bundled ZXing reader elsewhere (Safari on iPhone).
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      ui.cam = "unsupported";
      return LIVE ? (toast("This browser can't use the camera. Type the ISBN below."), render()) : simulateScan();
    }
    const wrap = document.createElement("div");
    wrap.className = "camera";
    wrap.innerHTML = `<video playsinline muted></video><span class="cam-frame"></span><p class="cam-hint">Hold a barcode inside the frame</p><p class="cam-count" aria-live="polite"></p><button class="btn primary cam-done">Done</button>`;
    const video = wrap.querySelector("video");
    const count = wrap.querySelector(".cam-count");
    const seen = new Set();
    let added = 0;
    let stopReader = () => {};
    const onCode = async (code) => {
      if (!/^97[89]\d{10}$/.test(code) || seen.has(code)) return;
      seen.add(code);
      if (navigator.vibrate) navigator.vibrate(40);
      count.textContent = "Looking up " + code + "…";
      await addByIsbn(code);
      added++;
      count.textContent = plural(added, "book") + " added";
    };
    const stop = () => {
      stopReader();
      if (video.srcObject) video.srcObject.getTracks().forEach((tr) => tr.stop());
      wrap.remove();
      render();
    };
    wrap.querySelector(".cam-done").addEventListener("click", stop);
    try {
      if ("BarcodeDetector" in window) {
        const detector = new window.BarcodeDetector({ formats: ["ean_13"] });
        video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        document.body.appendChild(wrap);
        await video.play();
        let running = true;
        stopReader = () => { running = false; };
        const loop = async () => {
          if (!running) return;
          try {
            const codes = await detector.detect(video);
            for (const c of codes) await onCode(c.rawValue);
          } catch (e) { /* keep scanning */ }
          setTimeout(loop, 250);
        };
        loop();
      } else {
        await loadScript("vendor/zxing.min.js");
        const hints = new Map([[window.ZXing.DecodeHintType.POSSIBLE_FORMATS, [window.ZXing.BarcodeFormat.EAN_13]]]);
        const reader = new window.ZXing.BrowserMultiFormatReader(hints, 300);
        document.body.appendChild(wrap);
        stopReader = () => reader.reset();
        await reader.decodeFromVideoDevice(undefined, video, (result) => { if (result) onCode(result.getText()); });
      }
    } catch (e) {
      wrap.remove();
      ui.cam = "denied";
      if (LIVE) {
        toast("Camera blocked. Allow camera access in your browser settings, or type the ISBN below.");
        return render();
      }
      return simulateScan();
    }
  }

  /* ---------------- demo actions ---------------- */

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
    look(d) {
      look = LOOKS.some(([id]) => id === d.id) ? d.id : "light";
      try { localStorage.setItem(LOOK_KEY, look); } catch (e) { /* not saved, still applies now */ }
      applyLook();
      render();
    },
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
    editProfile() { ui.draft = {}; ui.handleOk = null; ui.handleHint = null; openSheet("editProfile"); },
    deleteAccount() { openSheet("deleteAccount"); },
    support() { openSheet("support"); },

    signIn() { S.signedIn = true; commit(); },
    otpBack() { ui.otpEmail = null; render(); },
    signOut() { S.signedIn = false; ui.sheet = null; clearToast(); commit("Signed out"); },
    confirmDelete() { S = seed(true); ui.sheet = null; ui.tab = "discover"; clearToast(); commit("Account deleted"); },

    wish(d) {
      const w = S.wishlist.me;
      const on = w.includes(d.id);
      S.wishlist.me = on ? w.filter((b) => b !== d.id) : w.concat(d.id);
      commit(on ? "Removed from wishlist" : "Added to wishlist. We'll alert you when a copy is listed.");
    },
    wishSearch(d) { A.wish(d); },

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
        return openSheet("topup", {});
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
      log(req(d.id), "You left a rating.");
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
    topup(d) { openSheet("topup", { back: d.back, amount: topupAmounts()[0] }); },
    pickTopup(d) { ui.sheet.amount = Number(d.id); render(); },
    confirmTopup(d) { openSheet("stripe", { back: d.back, amount: ui.sheet.amount || topupAmounts()[0] }); },
    demoPay(d) {
      const amt = ui.sheet.amount;
      S.payments.push({ id: uid("p"), user: "me", kind: "topup", amount: amt, at: S.now, requestId: null, note: "Added to fee balance" });
      ui.sheet = null;
      checkWelcome();
      if (!ui.sheet) backTo(d.back);
      commit(money(amt) + " added to your fee balance");
    },

    readAll() { S.notes.forEach((n) => (n.read = true)); commit(); },
    openNote(d) {
      const n = S.notes.find((x) => String(x.id) === String(d.id));
      n.read = true;
      save();
      if (n.go && n.go.request) return openSheet("deal", { id: n.go.request });
      if (n.go && n.go.listing && listing(n.go.listing)) return openSheet("listing", { id: n.go.listing });
      if (n.go && n.go.wallet) return openSheet("wallet");
      render();
    },

    /* onboarding and profile */
    obNext() {
      if (ui.ob === 0) {
        const err = profileError();
        if (err) return toast(err), render();
        applyDraft();
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
    saveProfile() {
      const err = profileError();
      if (err) return toast(err), render();
      applyDraft();
      closeSheet();
      commit("Profile saved");
    },

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
      clearToast();
      ui.sheet = null;
      ui.tab = "discover";
      ui.ob = 0;
      ui.scanned = [];
      ui.draft = {};
      ui.otpEmail = null;
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

  function profileError() {
    const name = String(draft("name", S.me.name) || "").trim();
    const handle = String(draft("handle", S.me.handle) || "").trim().toLowerCase();
    if (!name) return "Add your name to continue.";
    if (!/^[a-z0-9_.]{3,20}$/.test(handle)) return "Handles are 3 to 20 characters: letters, numbers, dots and underscores.";
    if (ui.handleOk === false) return "That handle is taken. Try another.";
    if (!LIVE && Object.values(DEMO_USERS).some((u) => u.id !== "me" && u.handle === handle)) return "That handle is taken. Try another.";
    return null;
  }
  function applyDraft() {
    S.me.name = String(draft("name", S.me.name)).trim();
    S.me.handle = String(draft("handle", S.me.handle)).trim().toLowerCase();
    S.me.city = String(draft("city", S.me.city) || "").trim();
    S.me.state = draft("state", S.me.state) || "";
    S.me.photo = draft("photo", S.me.photo);
    ui.draft = {};
  }

  /* ============================================================================
     Live mode: the same screens, backed by Supabase.
     ============================================================================ */

  let sb = null;
  let session = null;
  let ME_ID = null;
  const appUrl = () => location.origin + location.pathname;

  function friendly(error) {
    if (!error) return "Something went wrong. Try again.";
    if (error.code === "P0001" && error.message) return error.message;
    if (/JWT|sign in/i.test(error.message || "")) return "Please sign in again.";
    console.error(error);
    return "Something went wrong. Check your connection and try again.";
  }

  // Turns the server's get_state() answer into the same shape the demo uses, with "me"
  // standing for the signed-in reader.
  const photoUrl = (path) => (path ? sb.storage.from("avatars").getPublicUrl(path).data.publicUrl : null);

  function fromServer(d) {
    ME_ID = d.me_id;
    const id = (x) => (x === ME_ID ? "me" : x);
    const users = { me: { id: "me", name: d.me.name || "You", handle: d.me.handle || "you", city: [d.me.city, d.me.state].filter(Boolean).join(", "), rating: null, avatar: photoUrl(d.me.photo) } };
    for (const [uidKey, u] of Object.entries(d.users || {})) users[uidKey] = { id: uidKey, name: u.name, handle: u.handle, city: u.city, rating: u.rating, avatar: photoUrl(u.avatar) };
    USERS = users;
    const books = {};
    for (const b of Object.values(d.books || {})) books[b.isbn] = decorate(b);
    skew = d.now - Date.now();
    return {
      live: true, now: d.now, nextId: 1, signedIn: true,
      fees: d.fees, topupAmounts: (d.topupAmounts || []).map((c) => c / 100), welcomeListings: d.welcomeListings,
      extraBooks: books,
      copies: d.copies.map((c) => Object.assign({}, c, { owner: id(c.owner) })),
      listings: d.listings,
      requests: d.requests.map((r) => Object.assign({}, r, { sender: id(r.sender), recipient: id(r.recipient) })),
      exchanges: d.exchanges.map((x) => Object.assign({}, x, { sender: id(x.sender), recipient: id(x.recipient) })),
      ledger: d.ledger.map((e) => Object.assign({}, e, { user: "me" })),
      payments: d.payments.map((p) => Object.assign({}, p, { user: "me" })),
      notes: d.notes,
      wishlist: { me: d.wishlist || [] },
      trend: d.trend || {},
      me: {
        onboarded: !!d.me.onboarded, name: d.me.name || "", handle: d.me.handle || "", photo: photoUrl(d.me.photo), photoPath: d.me.photo || null,
        genres: d.me.genres || [], city: d.me.city || "", state: d.me.state || "", address: d.me.address || null,
        strikes: d.me.strikes || 0, paused: !!d.me.paused, welcome: d.me.welcome || "locked", ratings: {}, admin: !!d.me.admin,
      },
      disputes: d.disputes || null,
    };
  }

  async function pull() {
    const { data, error } = await sb.rpc("get_state");
    if (error) {
      if (/JWT|expired/i.test(error.message || "")) return signedOutLocally();
      toast(friendly(error));
      return false;
    }
    const known = S.live ? new Set(S.ledger.map((e) => e.id)) : null;
    S = fromServer(data);
    if (!S.me.onboarded) ui.obActive = true;
    // Celebrate credits that arrived since the last look.
    if (known) {
      const fresh = S.ledger.filter((e) => !known.has(e.id));
      const earned = fresh.find((e) => e.type === "earn");
      const grant = fresh.find((e) => e.type === "grant");
      if (earned) { ui.sheet = { type: "celebrate", kind: "earn", id: earned.requestId }; ui.sheetEnter = true; }
      else if (grant) { ui.sheet = { type: "celebrate", kind: "welcome" }; ui.sheetEnter = true; }
    }
    return true;
  }

  // Calls one database function as the signed-in reader, then refreshes.
  async function call(name, args = {}, okMsg = null) {
    ui.busy++;
    render();
    const { data, error } = await sb.rpc(name, args);
    if (error) {
      ui.busy--;
      toast(friendly(error));
      render();
      return { error };
    }
    await pull();
    ui.busy--;
    if (okMsg) toast(okMsg);
    render();
    return { data };
  }

  // Calls one edge function. Their errors carry a reader-friendly { error } body.
  async function invoke(name, body, { quiet = false } = {}) {
    if (!quiet) { ui.busy++; render(); }
    const { data, error } = await sb.functions.invoke(name, { body });
    if (!quiet) ui.busy--;
    if (error) {
      let msg = "Something went wrong. Check your connection and try again.";
      try { msg = (await error.context.json()).error || msg; } catch (e) { /* not JSON */ }
      return { error: msg };
    }
    return { data };
  }

  async function liveAddByIsbn(isbn) {
    const found = await invoke("add-book", { isbn });
    if (found.error) return toast(found.error), render();
    const added = await call("add_copy", { p_isbn: found.data.book.isbn, p_condition: ui.defCond, p_format: "Paperback" });
    if (added.error) return;
    ui.scanned.unshift(added.data);
    ui.scanQ = "";
    ui.searchHits = null;
    toast("Added " + found.data.book.title);
    render();
  }

  let searchTimer = null;
  function liveSearch(q) {
    clearTimeout(searchTimer);
    const digits = q.replace(/[^0-9xX]/g, "");
    if (q.trim().length < 2 || /^(97[89])?\d{9}[\dxX]$/.test(digits)) {
      ui.searchHits = null;
      return;
    }
    ui.searchHits = "busy";
    searchTimer = setTimeout(async () => {
      const res = await invoke("add-book", { q: q.trim() }, { quiet: true });
      if (ui.scanQ !== q) return;
      ui.searchHits = res.error ? "error" : res.data.results;
      const box = document.getElementById("scanResults");
      if (box) box.innerHTML = scanMatches(ui.scanQ);
    }, 450);
  }

  function signedOutLocally() {
    session = null;
    ME_ID = null;
    S = blankState();
    USERS = { me: DEMO_USERS.me };
    ui.screen = "signin";
    ui.sheet = null;
    ui.obActive = false;
    ui.ob = 0;
    render();
    return false;
  }

  async function saveLiveProfile() {
    const err = profileError();
    if (err) return toast(err), render(), false;
    const r = await call("save_profile", {
      p_handle: String(draft("handle", S.me.handle)).trim().toLowerCase(),
      p_display_name: String(draft("name", S.me.name)).trim(),
      p_city: String(draft("city", S.me.city) || "").trim(),
      p_state: draft("state", S.me.state) || null,
      p_genres: S.me.genres,
      p_avatar_path: draft("photoPath", S.me.photoPath) || null,
    });
    if (r.error) return false;
    ui.draft = {};
    return true;
  }

  const LIVE_ACTIONS = {
    async signIn(d) {
      const { error } = await sb.auth.signInWithOAuth({ provider: d.id, options: { redirectTo: appUrl() } });
      if (error) toast("Couldn't start sign-in with " + (d.id === "apple" ? "Apple" : "Google") + ". Try email instead."), render();
    },
    async signOut() {
      await sb.auth.signOut();
      signedOutLocally();
      toast("Signed out");
    },
    async confirmDelete() {
      const res = await invoke("delete-account", {});
      if (res.error) return toast(res.error), render();
      await sb.auth.signOut({ scope: "local" });
      signedOutLocally();
      toast("Your account was deleted.");
      render();
    },
    async wish(d) {
      const r = await call("toggle_wish", { p_isbn: d.id });
      if (!r.error) toast(r.data ? "Added to wishlist. We'll alert you when a copy is listed." : "Removed from wishlist"), render();
    },
    async wishSearch(d) {
      const found = await invoke("add-book", { isbn: d.id });
      if (found.error) return toast(found.error), render();
      await LIVE_ACTIONS.wish({ id: found.data.book.isbn });
    },
    async sendRequest(d) {
      const r = await call("request_book", { p_listing: d.id }, "Requested. 1 credit reserved.");
      if (r.error) return;
      ui.tab = "exchanges";
      ui.xTab = "incoming";
      openSheet("deal", { id: r.data });
    },
    async withdraw(d) { await call("withdraw_request", { p_req: d.id }, "Request cancelled. Your credit is back."); },
    async accept(d) {
      const r = await call("accept_request", { p_req: d.id }, "Accepted. Ship within 3 days.");
      if (r.error && /fee balance/.test(friendly(r.error))) openSheet("topup", {});
    },
    async decline(d) {
      const r = await call("decline_request", { p_req: d.id }, "Request declined");
      if (!r.error) closeSheet();
    },
    async confirmBook(d) { await call("confirm_received", { p_req: d.id }, "Confirmed. Thanks for reading with Worm."); },
    async submitReport(d) {
      const r = await call("report_problem", { p_req: d.id, p_reason: ui.sheet.reason }, "Problem reported. Support replies within 1 business day.");
      if (!r.error) openSheet("deal", { id: d.id });
    },
    async rate(d) { await call("rate_exchange", { p_req: d.id, p_stars: Number(d.n) }, "Thanks. Rating saved."); },
    async toggleListing(d) {
      const on = !!openListing(d.id);
      await call("set_available", { p_copy: d.id, p_available: !on }, on ? "Hidden from Discover" : "Available for exchange");
    },
    async setCond(d) { const c = copy(d.id); await call("update_copy", { p_copy: c.id, p_condition: d.c, p_format: c.format, p_flags: c.flags }); },
    async setFormat(d) { const c = copy(d.id); await call("update_copy", { p_copy: c.id, p_condition: c.cond, p_format: d.f, p_flags: c.flags }); },
    async setFlag(d) {
      const c = copy(d.id);
      const flags = c.flags.includes(d.f) ? c.flags.filter((x) => x !== d.f) : c.flags.concat(d.f);
      await call("update_copy", { p_copy: c.id, p_condition: c.cond, p_format: c.format, p_flags: flags });
    },
    async removeCopy(d) {
      const r = await call("remove_copy", { p_copy: d.id }, "Removed from your shelf");
      if (!r.error) closeSheet();
    },
    async addFromSearch(d) { await liveAddByIsbn(d.id); },
    async confirmTopup() {
      const cents = Math.round((ui.sheet.amount || topupAmounts()[0]) * 100);
      const res = await invoke("create-checkout", { amount: cents });
      if (res.error) return toast(res.error), render();
      location.assign(res.data.url);
    },
    async readAll() { await call("mark_read", { p_ids: null }); },
    async openNote(d) {
      const n = S.notes.find((x) => String(x.id) === String(d.id));
      if (n && !n.read) { n.read = true; sb.rpc("mark_read", { p_ids: [n.id] }); }
      if (n && n.go && n.go.request) return openSheet("deal", { id: n.go.request });
      if (n && n.go && n.go.listing && listing(n.go.listing)) return openSheet("listing", { id: n.go.listing });
      if (n && n.go && n.go.wallet) return openSheet("wallet");
      render();
    },
    async obNext() {
      if (ui.ob === 0 && !(await saveLiveProfile())) return;
      if (ui.ob === 1 && !(await saveLiveProfile())) return;
      ui.ob++;
      render();
    },
    async obWish(d) {
      const w = S.wishlist.me;
      S.wishlist.me = w.includes(d.id) ? w.filter((x) => x !== d.id) : w.concat(d.id);
      render();
      const { error } = await sb.rpc("toggle_wish", { p_isbn: d.id });
      if (error) toast(friendly(error));
    },
    async obDone() {
      ui.obActive = false;
      ui.ob = 0;
      ui.tab = "scan";
      await pull();
      toast("Scan a few books to get started");
      render();
    },
    async saveProfile() {
      if (await saveLiveProfile()) { closeSheet(); toast("Profile saved"); render(); }
    },
    async rule(d) {
      await call("resolve_dispute", { p_req: d.id, p_upheld: d.upheld === "1", p_note: null }, "Decision saved. Both readers were notified.");
    },
  };
  // Actions that change data. While one is running, further taps on these are ignored.
  const MUTATING = new Set(Object.keys(LIVE_ACTIONS).concat(["camera", "lookupIsbn"]));
  if (LIVE) Object.assign(A, LIVE_ACTIONS);

  async function bootLive() {
    try {
      await loadScript("vendor/supabase.js");
    } catch (e) {
      app.innerHTML = '<div class="signin"><p>Worm couldn\'t load. Check your connection and refresh.</p></div>';
      return;
    }
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const params = new URLSearchParams(location.search);
    const { data } = await sb.auth.getSession();
    session = data.session;
    if (params.has("code") || params.has("error_description")) {
      if (params.get("error_description")) toast(params.get("error_description"));
      params.delete("code"); params.delete("error"); params.delete("error_description");
      history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : ""));
    }
    sb.auth.onAuthStateChange((event, s) => {
      // Don't call Supabase from inside this callback; defer to the next tick.
      setTimeout(async () => {
        if (event === "SIGNED_OUT") return signedOutLocally();
        if (event === "SIGNED_IN" && !session && s) {
          session = s;
          ui.screen = "loading";
          render();
          await pull();
          ui.screen = "app";
          render();
        }
        session = s;
      }, 0);
    });
    if (!session) {
      ui.screen = "signin";
      return render();
    }
    await pull();
    ui.screen = "app";
    render();
    // Back from Stripe: the webhook credits the balance, usually within a few seconds.
    const topup = params.get("topup");
    if (topup) {
      params.delete("topup");
      history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : ""));
      if (topup === "success") {
        const before = feeBalance();
        toast("Payment received. Updating your balance…");
        render();
        for (let i = 0; i < 8 && feeBalance() === before; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          await pull();
        }
        toast(feeBalance() > before ? "Your fee balance is now " + money(feeBalance()) : "Payment received. Your balance updates in a minute.");
        render();
      } else {
        toast("Checkout cancelled. Nothing was charged.");
        render();
      }
    }
    // Pick up other readers' moves: every 30 seconds while open, and on return to the app.
    const refresh = async () => {
      if (!session || ui.busy || document.visibilityState !== "visible") return;
      const typing = document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (typing || (ui.sheet && ["tracking", "address", "topup", "editProfile", "report", "deleteAccount"].includes(ui.sheet.type))) return;
      if (await pull()) render();
    };
    setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
  }

  /* ---------------- events ---------------- */

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const name = el.dataset.act;
    const fn = A[name];
    if (!fn) return;
    e.preventDefault();
    if (LIVE && ui.busy && MUTATING.has(name)) return;
    fn(el.dataset, el);
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.draft) {
      ui.draft[t.dataset.draft] = t.value;
      if (t.dataset.draft === "handle") { ui.handleOk = null; ui.handleHint = null; }
    }
    if (t.id === "q") {
      ui.q = t.value;
      const r = document.getElementById("results");
      if (r) r.innerHTML = discoverResults();
    }
    if (t.id === "scanq") {
      ui.scanQ = t.value;
      if (LIVE) liveSearch(t.value);
      const r = document.getElementById("scanResults");
      if (r) r.innerHTML = scanMatches(ui.scanQ);
    }
  });

  // Checks a handle as soon as the reader leaves the field.
  document.addEventListener("focusout", async (e) => {
    if (e.target.id !== "ob-handle") return;
    const h = e.target.value.trim().toLowerCase();
    const hint = document.getElementById("handleHint");
    if (!/^[a-z0-9_.]{3,20}$/.test(h)) {
      ui.handleOk = false;
      ui.handleHint = "3 to 20 letters, numbers, dots or underscores.";
    } else if (LIVE) {
      const { data } = await sb.rpc("handle_available", { p_handle: h });
      ui.handleOk = !!data;
      ui.handleHint = data ? "@" + h + " is yours." : "@" + h + " is taken. Try another.";
    } else {
      ui.handleOk = !Object.values(DEMO_USERS).some((u) => u.id !== "me" && u.handle === h);
      ui.handleHint = ui.handleOk ? "@" + h + " is yours." : "@" + h + " is taken. Try another.";
    }
    if (hint) {
      hint.textContent = ui.handleHint;
      hint.className = "hint " + (ui.handleOk ? "good" : "bad");
    }
  });

  document.addEventListener("change", async (e) => {
    if (e.target.dataset && e.target.dataset.draft) ui.draft[e.target.dataset.draft] = e.target.value;
    if (e.target.id !== "photo" || !e.target.files[0]) return;
    try {
      const blob = await shrinkPhoto(e.target.files[0]);
      if (LIVE) {
        ui.busy++;
        render();
        const path = `${ME_ID}/avatar-${Date.now()}.jpg`;
        const { error } = await sb.storage.from("avatars").upload(path, await blob.arrayBuffer(), { contentType: "image/jpeg", upsert: false });
        ui.busy--;
        if (error) throw new Error("Couldn't upload that photo. Try a smaller one.");
        ui.draft.photoPath = path;
        ui.draft.photo = photoUrl(path);
      } else {
        ui.draft.photo = await new Promise((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.readAsDataURL(blob);
        });
      }
      toast("Photo added");
    } catch (err) {
      toast(err.message);
    }
    render();
  });

  document.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const back = e.target.dataset.back;
    if (e.target.id === "emailForm") {
      const email = String(f.get("email")).trim();
      if (LIVE) {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: appUrl(), shouldCreateUser: true } });
        if (error) return toast(/rate|seconds/i.test(error.message) ? "Please wait a minute before asking for another email." : "Couldn't send the email. Check the address."), render();
      }
      ui.otpEmail = email;
      toast(LIVE ? "Check your email." : "Demo: no email is sent. Type any 6 digits.");
      return render();
    }
    if (e.target.id === "otpForm") {
      const token = String(f.get("code")).trim();
      if (LIVE) {
        ui.busy++;
        render();
        const { error } = await sb.auth.verifyOtp({ email: ui.otpEmail, token, type: "email" });
        ui.busy--;
        if (error) return toast("That code didn't work. Check it, or ask for a new email."), render();
        ui.otpEmail = null;
        return;
      }
      ui.otpEmail = null;
      return A.signIn();
    }
    if (e.target.id === "addrForm") {
      const a = { name: f.get("name"), line1: f.get("line1"), line2: f.get("line2") || null, city: f.get("city"), state: f.get("state"), zip: f.get("zip") };
      if (LIVE) {
        const r = await call("save_address", { p_name: a.name, p_line1: a.line1, p_line2: a.line2, p_city: a.city, p_state: a.state, p_zip: a.zip }, "Address saved");
        if (!r.error) backTo(back);
        return;
      }
      S.me.address = a;
      backTo(back);
      return commit("Address saved");
    }
    if (e.target.id === "trackForm") {
      const r = req(e.target.dataset.id);
      const carrier = f.get("carrier");
      const raw = String(f.get("tracking")).trim();
      if (LIVE) {
        const res = await invoke("add-tracking", { request_id: r.id, carrier, tracking: raw });
        if (res.error) return toast(res.error), render();
        await pull();
        openSheet("deal", { id: r.id });
        return toast("Tracking saved. You'll earn your credit when it arrives."), render();
      }
      const t = normalizeTracking(carrier, raw);
      if (!t) return toast("That doesn't look like a " + carrier + " tracking number. Check your receipt."), render();
      if (S.exchanges.some((x) => x.carrier === carrier && x.tracking === t)) return toast("That tracking number is already used on another exchange."), render();
      ship(exOf(r.id), carrier, t);
      openSheet("deal", { id: r.id });
      return commit("Tracking saved. You'll earn your credit when it arrives.");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ui.sheet) closeSheet();
  });

  // Covers that fail to load fall back to the generated jacket underneath.
  document.addEventListener("error", (e) => {
    if (e.target && e.target.classList && e.target.classList.contains("cover-img")) e.target.remove();
  }, true);
  document.addEventListener("load", (e) => {
    const img = e.target;
    if (img && img.classList && img.classList.contains("cover-img")) {
      loadedCovers.add(img.getAttribute("src"));
      requestAnimationFrame(() => img.classList.add("loaded"));
    }
  }, true);

  if (LIVE) {
    render();
    bootLive();
  } else {
    // The demo opens the way the real app does: placeholder shelves, then the books arrive.
    ui.screen = "loading";
    render();
    setTimeout(() => { ui.screen = "app"; render(); }, 700);
  }

  // Offline support when installed as a PWA. Hosts that don't allow service workers just skip this.
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
