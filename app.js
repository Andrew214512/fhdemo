/* Shelfswap prototype. Everything is fake data kept in this browser.
   The Demo panel (top right) plays the other trader and fast-forwards time. */
(function () {
  "use strict";

  const DAY = 864e5;
  const HOUR = 36e5;
  const START = Date.parse("2026-10-26T10:00:00");
  const FEE = 1;
  const LABEL = 4.49;
  const OFFER_TTL = 2 * DAY;
  const SHIP_WINDOW = 3 * DAY;
  const CONFIRM_WINDOW = 2 * DAY;
  const STORE_KEY = "shelfswap-demo-v1";

  const CONDITIONS = [
    { id: "new", label: "New", short: "NEW", hold: 12, desc: "Unread. No marks, no wear." },
    { id: "ln", label: "Like New", short: "LIKE NEW", hold: 10, desc: "Read once. No creases, no marks." },
    { id: "vg", label: "Very Good", short: "V. GOOD", hold: 8, desc: "Light shelf wear. Spine intact, no writing." },
    { id: "good", label: "Good", short: "GOOD", hold: 6, desc: "Visible wear or spine creases. Any notes disclosed." },
    { id: "acc", label: "Acceptable", short: "ACCEPT.", hold: 4, desc: "Heavy wear, but complete and readable." },
  ];
  const FLAGS = ["Highlighting or notes", "Dust jacket included", "Ex-library", "Signed", "Smoke-free home"];
  const COND = Object.fromEntries(CONDITIONS.map((c) => [c.id, c]));

  // Cover colors are part of each book's identity, so they stay the same in light and dark.
  const CATALOG = [
    ["b1", "Tomorrow, and Tomorrow, and Tomorrow", "Gabrielle Zevin", 2022, "9780593321201", "#f2c14e", "#1f2a44", 1],
    ["b2", "Project Hail Mary", "Andy Weir", 2021, "9780593135204", "#0f3b5f", "#f5d36b", 3],
    ["b3", "Circe", "Madeline Miller", 2018, "9780316556347", "#c9772c", "#1a1208", 1],
    ["b4", "The Overstory", "Richard Powers", 2018, "9780393356687", "#2f5d3a", "#e9efd8", 2],
    ["b5", "Piranesi", "Susanna Clarke", 2020, "9781635577808", "#1d2b4f", "#d9c38c", 3],
    ["b6", "Station Eleven", "Emily St. John Mandel", 2014, "9780804172448", "#e7e1d3", "#a3291f", 2],
    ["b7", "The Left Hand of Darkness", "Ursula K. Le Guin", 1969, "9780441478125", "#dfe7ea", "#18324a", 3],
    ["b8", "Lessons in Chemistry", "Bonnie Garmus", 2022, "9780385547345", "#e8573c", "#fff4e6", 1],
    ["b9", "Pachinko", "Min Jin Lee", 2017, "9781455563920", "#7c1f2c", "#f3d9b8", 2],
    ["b10", "Demon Copperhead", "Barbara Kingsolver", 2022, "9780063251922", "#2a4a6b", "#f0b44c", 1],
    ["b11", "Klara and the Sun", "Kazuo Ishiguro", 2021, "9780593318171", "#f4b23c", "#3a2a10", 3],
    ["b12", "Babel", "R. F. Kuang", 2022, "9780063021426", "#efe9dc", "#7a1d1d", 2],
    ["b13", "The Song of Achilles", "Madeline Miller", 2012, "9780062060624", "#14141a", "#d7b46a", 1],
    ["b14", "Sea of Tranquility", "Emily St. John Mandel", 2022, "9780593321447", "#97c4d6", "#1d2f45", 3],
    ["b15", "Educated", "Tara Westover", 2018, "9780399590504", "#f1ede4", "#2b2b2b", 2],
    ["b16", "Remarkably Bright Creatures", "Shelby Van Pelt", 2022, "9780063204157", "#0f4c5c", "#f2c6a0", 1],
    ["b17", "The Remains of the Day", "Kazuo Ishiguro", 1989, "9780679731726", "#5e6b3a", "#f3ecd2", 2],
    ["b18", "Normal People", "Sally Rooney", 2018, "9781984822185", "#a8d5c2", "#18302a", 3],
    ["b19", "The Midnight Library", "Matt Haig", 2020, "9780525559474", "#152a4a", "#f2d27a", 1],
    ["b20", "A Gentleman in Moscow", "Amor Towles", 2016, "9780670026197", "#8a1c2b", "#efd9a7", 2],
    ["b21", "Hamnet", "Maggie O'Farrell", 2020, "9780525657606", "#2d5a3c", "#f6e3c4", 3],
    ["b22", "The Name of the Wind", "Patrick Rothfuss", 2007, "9780756404741", "#3b2416", "#e6b25c", 1],
    ["b23", "Beloved", "Toni Morrison", 1987, "9781400033416", "#5a2340", "#f4dfe8", 2],
    ["b24", "Braiding Sweetgrass", "Robin Wall Kimmerer", 2013, "9781571313560", "#7a8f3c", "#fbf6e2", 3],
  ].map(([id, title, author, year, isbn, bg, fg, motif]) => ({ id, title, author, year, isbn, bg, fg, motif }));
  const BOOK = Object.fromEntries(CATALOG.map((b) => [b.id, b]));

  const USERS = {
    me: { id: "me", name: "You", handle: "andrew.p", city: "Brooklyn, NY", rating: 5.0, trades: 3 },
    maya: { id: "maya", name: "Maya R.", handle: "mayareads", city: "Portland, OR", rating: 4.9, trades: 38 },
    jonah: { id: "jonah", name: "Jonah B.", handle: "jonahbinds", city: "Austin, TX", rating: 4.7, trades: 12 },
    priya: { id: "priya", name: "Priya S.", handle: "priyapages", city: "Chicago, IL", rating: 5.0, trades: 61 },
    theo: { id: "theo", name: "Theo T.", handle: "theo.t", city: "Denver, CO", rating: 4.8, trades: 7 },
    sam: { id: "sam", name: "Sam K.", handle: "samshelves", city: "Raleigh, NC", rating: 4.6, trades: 22 },
  };

  /* ---------------- data ---------------- */

  function seed() {
    const t = START;
    const L = (id, owner, bookId, shelf, cond, flags = [], format = "Paperback") => ({ id, owner, bookId, shelf, cond, flags, format, addedAt: t - 5 * DAY });
    const listings = [
      L("l1", "me", "b1", "trade", "ln", ["Smoke-free home"], "Hardcover"),
      L("l2", "me", "b2", "trade", "vg"),
      L("l3", "me", "b3", "trade", "good", ["Highlighting or notes"]),
      L("l4", "me", "b4", "trade", "vg"),
      L("l5", "me", "b13", "trade", "vg"),
      L("l6", "me", "b5", "keep", "ln", [], "Hardcover"),
      L("l7", "me", "b6", "keep", "good"),
      L("l20", "maya", "b9", "trade", "vg", ["Smoke-free home"]),
      L("l21", "maya", "b12", "trade", "ln", ["Dust jacket included"], "Hardcover"),
      L("l22", "maya", "b19", "trade", "good"),
      L("l23", "priya", "b10", "trade", "ln", ["Dust jacket included"], "Hardcover"),
      L("l24", "priya", "b15", "trade", "vg"),
      L("l25", "priya", "b21", "trade", "vg"),
      L("l26", "jonah", "b11", "trade", "good"),
      L("l27", "jonah", "b22", "trade", "acc", ["Highlighting or notes"]),
      L("l28", "jonah", "b17", "trade", "vg"),
      L("l29", "theo", "b14", "trade", "ln", [], "Hardcover"),
      L("l30", "theo", "b18", "trade", "vg"),
      L("l31", "sam", "b16", "trade", "new"),
      L("l32", "sam", "b20", "trade", "good", ["Ex-library"]),
      L("l33", "sam", "b24", "trade", "vg"),
    ];
    const wishlist = {
      me: ["b7", "b8", "b9", "b10", "b11", "b23"],
      maya: ["b3", "b13"],
      priya: ["b1", "b4"],
      jonah: ["b2"],
      theo: ["b2", "b5"],
      sam: ["b4"],
    };
    const trades = [
      {
        id: "t1", from: "theo", to: "me", give: "l29", get: "l2",
        status: "offered", createdAt: t - 5 * HOUR,
        log: [{ at: t - 5 * HOUR, text: "Theo offered Sea of Tranquility for your Project Hail Mary." }],
      },
      {
        id: "t2", from: "me", to: "maya", give: "l5", get: "l21",
        status: "shipping", createdAt: t - 2 * DAY, acceptedAt: t - 1 * DAY, shipBy: t - 1 * DAY + SHIP_WINDOW,
        ship: { me: { shippedAt: null, deliveredAt: null, confirmed: false }, maya: { shippedAt: t - 3 * HOUR, deliveredAt: null, confirmed: false } },
        log: [
          { at: t - 2 * DAY, text: "You offered The Song of Achilles for Maya's Babel." },
          { at: t - 1 * DAY, text: "Maya accepted. Labels created for both of you." },
          { at: t - 3 * HOUR, text: "Maya's package was scanned by USPS. Their guarantee hold was released." },
        ],
      },
      {
        id: "t0", from: "sam", to: "me", give: "l90", get: "l91",
        status: "complete", createdAt: t - 30 * DAY, acceptedAt: t - 29 * DAY, completedAt: t - 22 * DAY,
        snapshot: { give: "b22", get: "b6" }, rated: 5,
        log: [{ at: t - 22 * DAY, text: "Trade complete. You rated Sam 5 stars." }],
      },
    ];
    const notes = [
      { id: "n1", at: t - 40 * 60e3, title: "Pachinko is up for trade", body: "Maya listed a Very Good paperback. It's on your wishlist.", go: { listing: "l20" }, read: false },
      { id: "n2", at: t - 3 * HOUR, title: "Maya shipped Babel", body: "Tracking 9400 1118 9922 3456 7781 20. Your copy of The Song of Achilles ships by Thursday.", go: { trade: "t2" }, read: false },
      { id: "n3", at: t - 5 * HOUR, title: "New offer from Theo", body: "Sea of Tranquility (Like New hardcover) for your Project Hail Mary.", go: { trade: "t1" }, read: false },
      { id: "n4", at: t - 1 * DAY, title: "Demon Copperhead is up for trade", body: "Priya listed a Like New hardcover with dust jacket.", go: { listing: "l23" }, read: true },
    ];
    return {
      now: t, nextId: 200, listings, wishlist, trades, notes,
      me: {
        address: { name: "Andrew Penhollow", line1: "214 Kent Ave, Apt 3R", city: "Brooklyn", state: "NY", zip: "11249" },
        card: { brand: "Visa", last4: "4242" },
        credit: 0,
        strikes: 0,
      },
    };
  }

  let S = load() || seed();
  const ui = { tab: "discover", shelf: "trade", tradesTab: "active", q: "", filter: "all", sheet: null, sheetEnter: false, toast: null };

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

  /* ---------------- helpers ---------------- */

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$" + n.toFixed(2);
  const listing = (id) => S.listings.find((l) => l.id === id);
  const trade = (id) => S.trades.find((t) => t.id === id);
  const user = (id) => USERS[id];
  const first = (id) => (id === "me" ? "You" : user(id).name.split(" ")[0]);
  const other = (t) => (t.from === "me" ? t.to : t.from);
  const myListing = (t) => (t.from === "me" ? t.give : t.get);
  const theirListing = (t) => (t.from === "me" ? t.get : t.give);
  const bookOf = (lid, t, side) => {
    const l = listing(lid);
    if (l) return BOOK[l.bookId];
    if (t && t.snapshot) return BOOK[t.snapshot[side]];
    return CATALOG[0];
  };
  const myBook = (t) => bookOf(myListing(t), t, t.from === "me" ? "give" : "get");
  const theirBook = (t) => bookOf(theirListing(t), t, t.from === "me" ? "get" : "give");
  const holdFor = (lid) => {
    const l = listing(lid);
    return l ? COND[l.cond].hold : 8;
  };
  const onWishlist = (bookId) => S.wishlist.me.includes(bookId);
  const busy = (lid) => S.trades.some((t) => ["shipping", "delivered"].includes(t.status) && (t.give === lid || t.get === lid));

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
    if (d <= 0) return "now";
    if (d < DAY) return Math.round(d / HOUR) + " hours";
    const days = Math.floor(d / DAY);
    const hrs = Math.round((d - days * DAY) / HOUR);
    return days + (days === 1 ? " day" : " days") + (hrs ? " " + hrs + "h" : "");
  }
  function notify(title, body, go) {
    S.notes.unshift({ id: uid("n"), at: S.now, title, body, go, read: false });
  }
  function log(t, text) {
    t.log.push({ at: S.now, text });
  }
  function toast(msg) {
    ui.toast = msg;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { ui.toast = null; render(); }, 2600);
  }
  const tracking = () => "9400 1118 99" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0").replace(/(\d{2})(\d{4})(\d{2})/, "$1 $2 $3") + " 20";

  /* ---------------- trade rules ---------------- */

  function statusOf(t) {
    const p = first(other(t));
    switch (t.status) {
      case "offered":
        return t.to === "me" ? { cls: "s-act", text: "Offer for you" } : { cls: "", text: "Waiting on " + p };
      case "shipping": {
        const s = t.ship;
        if (!s.me.shippedAt) return { cls: "s-warn", text: "Ship in " + left(t.shipBy) };
        if (!s[other(t)].shippedAt) return { cls: "", text: "Waiting for " + p + " to ship" };
        return { cls: "", text: "Both in the mail" };
      }
      case "delivered":
        if (!t.ship[other(t)].confirmed) return { cls: "s-act", text: "Confirm your book" };
        return { cls: "", text: "Waiting on " + p + " to confirm" };
      case "complete":
        return t.rated ? { cls: "s-ok", text: "Complete" } : { cls: "s-act", text: "Rate " + p };
      case "disputed":
        return { cls: "s-warn", text: "Problem reported" };
      case "declined":
        return { cls: "s-off", text: "Declined" };
      case "countered":
        return { cls: "s-off", text: "Countered" };
      case "expired":
        return { cls: "s-off", text: "Expired" };
      case "withdrawn":
        return { cls: "s-off", text: "Withdrawn" };
      case "cancelled":
        return { cls: "s-off", text: "Cancelled" };
    }
    return { cls: "", text: t.status };
  }
  const isActive = (t) => ["offered", "shipping", "delivered", "disputed"].includes(t.status) || (t.status === "complete" && !t.rated);
  const needsMe = (t) => {
    if (t.status === "offered") return t.to === "me";
    if (t.status === "shipping") return !t.ship.me.shippedAt;
    if (t.status === "delivered") return !t.ship[other(t)].confirmed;
    if (t.status === "complete") return !t.rated;
    return false;
  };

  function acceptTrade(t) {
    t.status = "shipping";
    t.acceptedAt = S.now;
    t.shipBy = S.now + SHIP_WINDOW;
    t.ship = { [t.from]: { shippedAt: null, deliveredAt: null, confirmed: false }, [t.to]: { shippedAt: null, deliveredAt: null, confirmed: false } };
    // Any other open offers that involve either copy are declined automatically.
    S.trades.forEach((o) => {
      if (o !== t && o.status === "offered" && [o.give, o.get].some((x) => x === t.give || x === t.get)) {
        o.status = "declined";
        log(o, "Auto-declined: one of these books was traded elsewhere.");
      }
    });
  }

  function markShipped(t, who) {
    t.ship[who].shippedAt = S.now;
    t.ship[who].tracking = tracking();
    log(t, (who === "me" ? "Your" : first(who) + "'s") + " package was scanned by USPS. " + (who === "me" ? "Your" : "Their") + " guarantee hold was released.");
  }

  function markDelivered(t, who) {
    t.ship[who].deliveredAt = S.now;
    log(t, theirOrMy(who) + " was delivered.");
    if (Object.values(t.ship).every((s) => s.deliveredAt)) {
      t.status = "delivered";
      t.deliveredAt = S.now;
    }
  }
  const theirOrMy = (who) => (who === "me" ? "Your book" : first(who) + "'s book");

  // ship[who].confirmed means the person who received who's book said it matches the listing.
  function confirm(t, who) {
    t.ship[who].confirmed = true;
    if (Object.values(t.ship).every((s) => s.confirmed)) {
      t.status = "complete";
      t.completedAt = S.now;
      log(t, "Both books confirmed. Trade complete.");
      notify("Trade complete", "Rate " + first(other(t)) + " to finish up.", { trade: t.id });
      // Traded copies move to the new owners' "Keeping" shelves.
      const mine = listing(myListing(t));
      const theirs = listing(theirListing(t));
      t.snapshot = { give: bookOf(t.give).id, get: bookOf(t.get).id };
      if (mine) { mine.owner = other(t); mine.shelf = "keep"; }
      if (theirs) { theirs.owner = "me"; theirs.shelf = "keep"; theirs.addedAt = S.now; S.wishlist.me = S.wishlist.me.filter((b) => b !== theirs.bookId); }
    }
  }

  // Runs every time the demo clock moves: expiries, reminders, missed ship windows, auto-confirms.
  function tick() {
    S.trades.forEach((t) => {
      const p = other(t);
      if (t.status === "offered" && S.now > t.createdAt + OFFER_TTL) {
        t.status = "expired";
        log(t, "Offer expired after 48 hours. Card holds released.");
        notify("Offer expired", theirBook(t).title + " ⇄ " + myBook(t).title + ". Nobody was charged.", { trade: t.id });
      }
      if (t.status === "shipping") {
        if (!t.ship.me.shippedAt && !t.reminded && t.shipBy - S.now <= DAY && S.now < t.shipBy) {
          t.reminded = true;
          notify("24 hours left to ship", "Drop off " + myBook(t).title + " by " + fmtDay(t.shipBy) + " or your guarantee hold is charged.", { trade: t.id });
        }
        if (S.now >= t.shipBy) {
          const meMissed = !t.ship.me.shippedAt;
          const theyMissed = !t.ship[p].shippedAt;
          if (meMissed || theyMissed) {
            t.status = "cancelled";
            t.cancelledAt = S.now;
            if (meMissed && theyMissed) {
              t.outcome = "Neither of you shipped in 3 days. Holds released, fees refunded, and both accounts got a strike.";
              S.me.strikes++;
            } else if (theyMissed) {
              const hold = holdFor(theirListing(t));
              S.me.credit += hold + FEE;
              t.outcome = first(p) + " didn't ship in time. Their " + money(hold) + " guarantee and your " + money(FEE) + " fee were added to your Shelfswap credit. A prepaid return label, charged to " + first(p) + ", brings your book back.";
            } else {
              const hold = holdFor(myListing(t));
              S.me.strikes++;
              t.outcome = "You didn't ship in time. Your " + money(hold) + " guarantee hold was charged and paid to " + first(p) + " as credit. Your account got a strike (3 in 6 months pauses trading).";
            }
            log(t, "Trade cancelled: ship window closed.");
            notify("Trade cancelled", t.outcome, { trade: t.id });
          }
        }
      }
      if (t.status === "delivered" && S.now >= t.deliveredAt + CONFIRM_WINDOW) {
        Object.keys(t.ship).forEach((who) => { if (!t.ship[who].confirmed) { log(t, theirOrMy(who) + " was auto-confirmed after 2 days."); confirm(t, who); } });
      }
    });
  }

  /* ---------------- pieces ---------------- */

  const ICONS = {
    discover: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    shelf: '<path d="M4 4h3v16H4zM9 4h3v16H9z"/><path d="m14.5 5.2 2.9-.8 3.6 14.6-2.9.8z"/>',
    trades: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
    alerts: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    swap: '<path d="M7 9h12l-3-3M17 15H5l3 3"/>',
  };
  const icon = (n, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

  function cover(b, cls = "") {
    return `<div class="cover-wrap"><div class="cover m${b.motif} ${cls}" style="background:${b.bg};color:${b.fg}" role="img" aria-label="Cover of ${esc(b.title)}">
      <span class="c-mark"></span>
      <span class="c-title">${esc(b.title)}</span>
      <span class="c-author">${esc(b.author)}</span>
    </div></div>`;
  }

  function bookTile(l, opts = {}) {
    const b = BOOK[l.bookId];
    const owner = l.owner === "me" ? "" : `<span>@${esc(user(l.owner).handle)}</span>`;
    const match = opts.match ? `<span class="cond wish">${opts.matchLabel || "WISHLIST"}</span>` : "";
    const act = opts.act || `data-act="openListing" data-id="${l.id}"`;
    return `<button class="book" ${act} ${opts.pressed != null ? `aria-pressed="${opts.pressed}"` : ""}>
      <div class="book-cover-box">${cover(b)}</div>
      <span class="b-title">${esc(b.title)}</span>
      <span class="b-meta"><span class="cond">${COND[l.cond].short}</span>${match}${opts.hideOwner ? "" : owner}</span>
    </button>`;
  }

  function wishTile(bookId) {
    const b = BOOK[bookId];
    const avail = S.listings.filter((l) => l.bookId === bookId && l.owner !== "me" && l.shelf === "trade").length;
    return `<button class="book" data-act="openBook" data-id="${bookId}">
      <div class="book-cover-box">${cover(b)}</div>
      <span class="b-title">${esc(b.title)}</span>
      <span class="b-meta">${avail ? `<span class="cond wish">${avail} AVAILABLE</span>` : "<span>Watching</span>"}</span>
    </button>`;
  }

  function swapRow(t) {
    const p = user(other(t));
    return `<div class="swap">
      ${cover(myBook(t))}
      <span class="arrow">${icon("swap", 20)}</span>
      ${cover(theirBook(t))}
      <div class="who">
        <strong>${esc(myBook(t).title)}</strong>
        <span>for ${esc(theirBook(t).title)}</span>
        <span>with ${esc(p.name)} · ★ ${p.rating.toFixed(1)}</span>
      </div>
    </div>`;
  }

  function tradeCard(t) {
    const st = statusOf(t);
    const stamp = t.status === "shipping" && !t.ship.me.shippedAt ? stampHTML(t.shipBy) : "";
    return `<button class="card tap ${needsMe(t) ? "attn" : ""}" data-act="openTrade" data-id="${t.id}">
      ${swapRow(t)}
      <div class="row"><span class="status ${st.cls}">${esc(st.text)}</span><span class="grow"></span>${stamp}</div>
    </button>`;
  }

  function stampHTML(ms, label = "SHIP BY") {
    const s = fmtStamp(ms);
    return `<span class="stamp ${ms - S.now < DAY ? "late" : ""}"><small>${label}</small><b>${s.day}</b><small>${s.wd}</small></span>`;
  }

  /* ---------------- views ---------------- */

  function viewDiscover() {
    const others = S.listings.filter((l) => l.owner !== "me" && l.shelf === "trade" && !busy(l.id));
    const matches = others.filter((l) => onWishlist(l.bookId));
    const myTradeBooks = S.listings.filter((l) => l.owner === "me" && l.shelf === "trade").map((l) => l.bookId);
    const twoWay = matches.filter((l) => (S.wishlist[l.owner] || []).some((b) => myTradeBooks.includes(b)));
    return `<div class="view">
      <label class="search" for="q">${icon("search", 18)}<input id="q" type="search" placeholder="Title, author, or ISBN" value="${esc(ui.q)}" autocomplete="off"></label>
      <div id="results">${discoverResults(others, matches, twoWay)}</div>
    </div>`;
  }

  function discoverResults(others, matches, twoWay) {
    if (!others) {
      others = S.listings.filter((l) => l.owner !== "me" && l.shelf === "trade" && !busy(l.id));
      matches = others.filter((l) => onWishlist(l.bookId));
      const myTradeBooks = S.listings.filter((l) => l.owner === "me" && l.shelf === "trade").map((l) => l.bookId);
      twoWay = matches.filter((l) => (S.wishlist[l.owner] || []).some((b) => myTradeBooks.includes(b)));
    }
    const q = ui.q.trim().toLowerCase();
    if (q) {
      const hits = others.filter((l) => {
        const b = BOOK[l.bookId];
        return (b.title + " " + b.author + " " + b.isbn).toLowerCase().includes(q);
      });
      return `<div class="section"><p class="eyebrow">${hits.length} up for trade</p>${
        hits.length ? `<div class="grid">${hits.map((l) => bookTile(l, { match: onWishlist(l.bookId) })).join("")}</div>` : `<div class="empty"><h3>Nobody has that one yet</h3><p>Add it to your wishlist and we'll tell you the moment someone lists it.</p><button class="btn ghost sm" data-act="addBook">Add to wishlist</button></div>`
      }</div>`;
    }
    const conds = ["all", "ln", "vg", "good"];
    const filtered = ui.filter === "all" ? others : others.filter((l) => {
      const order = CONDITIONS.findIndex((c) => c.id === l.cond);
      return order <= CONDITIONS.findIndex((c) => c.id === ui.filter);
    });
    let html = "";
    if (twoWay.length) {
      const l = twoWay[0];
      const wants = S.listings.find((x) => x.owner === "me" && x.shelf === "trade" && (S.wishlist[l.owner] || []).includes(x.bookId));
      html += `<div class="section">
        <p class="eyebrow">Two-way match</p>
        <button class="card tap attn" data-act="openListing" data-id="${l.id}">
          <div class="swap">${cover(BOOK[wants.bookId])}<span class="arrow">${icon("swap", 20)}</span>${cover(BOOK[l.bookId])}
            <div class="who"><strong>${esc(user(l.owner).name)} has ${esc(BOOK[l.bookId].title)}</strong><span>and wants your ${esc(BOOK[wants.bookId].title)}. Good odds they say yes.</span></div>
          </div>
        </button>
      </div>`;
    }
    if (matches.length) {
      html += `<div class="section">
        <div class="section-head"><h2>From your wishlist</h2><span class="eyebrow">${matches.length} available</span></div>
        <div class="rail">${matches.map((l) => bookTile(l, { match: true })).join("")}</div>
      </div>`;
    }
    html += `<div class="section">
      <div class="section-head"><h2>Up for trade near you</h2></div>
      <div class="chips" role="group" aria-label="Condition">${conds.map((c) => `<button class="chip" data-act="filter" data-id="${c}" aria-pressed="${ui.filter === c}">${c === "all" ? "Any condition" : COND[c].label + " +"}</button>`).join("")}</div>
      <div class="grid">${filtered.map((l) => bookTile(l, { match: onWishlist(l.bookId) })).join("")}</div>
    </div>`;
    return html;
  }

  function viewShelf() {
    const mine = S.listings.filter((l) => l.owner === "me");
    const trade = mine.filter((l) => l.shelf === "trade");
    const keep = mine.filter((l) => l.shelf === "keep");
    const wish = S.wishlist.me;
    const tabs = [["trade", "Up for trade", trade.length], ["wish", "Wishlist", wish.length], ["keep", "Keeping", keep.length]];
    let body = "";
    if (ui.shelf === "trade") {
      body = `<p class="lede">Books you'll swap. People who want them can send you offers.</p>
        <div class="grid">${trade.map((l) => bookTile(l, { hideOwner: true })).join("")}</div>`;
    } else if (ui.shelf === "wish") {
      body = `<p class="lede">You get an alert the moment someone lists one of these.</p>
        <div class="grid">${wish.map(wishTile).join("")}</div>`;
    } else {
      body = `<p class="lede">Your library. These don't show up for trades, but they count toward your profile.</p>
        <div class="grid">${keep.map((l) => bookTile(l, { hideOwner: true })).join("")}</div>`;
    }
    return `<div class="view">
      <div class="section-head"><h2 style="font-size:var(--t-2xl)">My shelf</h2><button class="btn primary sm" data-act="addBook">Add a book</button></div>
      <div class="seg" role="group">${tabs.map(([id, label, n]) => `<button data-act="shelfTab" data-id="${id}" aria-pressed="${ui.shelf === id}">${label}<span class="count">${n}</span></button>`).join("")}</div>
      ${body}
    </div>`;
  }

  function viewTrades() {
    const active = S.trades.filter(isActive).sort((a, b) => needsMe(b) - needsMe(a) || b.createdAt - a.createdAt);
    const past = S.trades.filter((t) => !isActive(t)).sort((a, b) => b.createdAt - a.createdAt);
    const list = ui.tradesTab === "active" ? active : past;
    return `<div class="view">
      <h2 style="font-size:var(--t-2xl)">Trades</h2>
      <div class="seg" role="group">
        <button data-act="tradesTab" data-id="active" aria-pressed="${ui.tradesTab === "active"}">Active<span class="count">${active.length}</span></button>
        <button data-act="tradesTab" data-id="past" aria-pressed="${ui.tradesTab === "past"}">History<span class="count">${past.length}</span></button>
      </div>
      ${list.length ? `<div class="list">${list.map(tradeCard).join("")}</div>` : `<div class="empty"><h3>No trades here</h3><p>Find a book in Discover and propose a swap.</p><button class="btn ghost sm" data-act="tab" data-id="discover">Go to Discover</button></div>`}
    </div>`;
  }

  function viewAlerts() {
    const unread = S.notes.some((n) => !n.read);
    return `<div class="view">
      <div class="section-head"><h2 style="font-size:var(--t-2xl)">Alerts</h2>${unread ? '<button class="link" data-act="readAll">Mark all read</button>' : ""}</div>
      <div>${S.notes.map((n) => `<button class="alert ${n.read ? "" : "unread"}" data-act="openNote" data-id="${n.id}">
        <span class="dot"></span>
        <span><strong>${esc(n.title)}</strong><p>${esc(n.body)}</p></span>
        <time>${ago(n.at)}</time>
      </button>`).join("")}</div>
    </div>`;
  }

  function viewProfile() {
    const a = S.me.address;
    const done = S.trades.filter((t) => t.status === "complete").length + 2;
    const shelfCount = S.listings.filter((l) => l.owner === "me").length;
    return `<div class="view">
      <div class="profile-head">
        <div class="avatar">A</div>
        <div><h2 style="font-size:var(--t-xl)">@${esc(USERS.me.handle)}</h2><p class="lede">${esc(USERS.me.city)} · ★ 5.0</p></div>
      </div>
      <div class="stats">
        <div class="stat"><b>${done}</b><span>trades</span></div>
        <div class="stat"><b>${shelfCount}</b><span>on shelf</span></div>
        <div class="stat"><b>${money(S.me.credit)}</b><span>credit</span></div>
      </div>
      ${S.me.strikes ? `<p class="note warn"><strong>${S.me.strikes} strike${S.me.strikes > 1 ? "s" : ""}.</strong> A missed ship window adds a strike. 3 in 6 months pauses trading.</p>` : ""}
      <div class="section">
        <p class="eyebrow">Shipping address</p>
        <div class="card">
          <p>${esc(a.name)}<br>${esc(a.line1)}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}</p>
          <p class="lede">Only printed on shipping labels. Trade partners never see it.</p>
          <button class="btn ghost sm" data-act="editAddress">Edit address</button>
        </div>
      </div>
      <div class="section">
        <p class="eyebrow">Payment</p>
        <div class="card">
          <div class="kv">
            <div><span class="k">Card</span><span class="v">${esc(S.me.card.brand)} ending ${esc(S.me.card.last4)}</span></div>
            <div><span class="k">Trade fee</span><span class="v">${money(FEE)} per trade</span></div>
            <div><span class="k">Shipping</span><span class="v">USPS Media Mail, about ${money(LABEL)}</span></div>
          </div>
          <p class="lede">Payments in the real app go through Stripe. This demo charges nothing.</p>
        </div>
      </div>
      <div class="section">
        <p class="eyebrow">Help</p>
        <div class="card">
          <button class="link" data-act="how">How trades work</button>
          <button class="link" data-act="conditions">Condition guide</button>
        </div>
      </div>
    </div>`;
  }

  /* ---------------- sheets ---------------- */

  function sheetListing(s) {
    const l = listing(s.id);
    const b = BOOK[l.bookId];
    const mine = l.owner === "me";
    const o = user(l.owner);
    const theyWant = mine ? [] : S.listings.filter((x) => x.owner === "me" && x.shelf === "trade" && (S.wishlist[l.owner] || []).includes(x.bookId));
    const inTrade = busy(l.id);
    return `
      <div class="detail">
        ${cover(b, "lg")}
        <div>
          <h3>${esc(b.title)}</h3>
          <p class="by">${esc(b.author)}, ${b.year}</p>
          <div class="facts">
            <div><span>Condition</span> <strong>${COND[l.cond].label}</strong></div>
            <div><span>Format</span> ${esc(l.format)}</div>
            ${l.flags.length ? `<div><span>Notes</span> ${l.flags.map(esc).join(", ")}</div>` : ""}
            <div class="isbn">ISBN ${b.isbn}</div>
          </div>
        </div>
      </div>
      <p class="note">${COND[l.cond].label}: ${COND[l.cond].desc}</p>
      ${mine ? "" : `<div class="row"><div class="avatar sm">${o.name[0]}</div><div class="grow"><strong>${esc(o.name)}</strong> <span class="lede">@${esc(o.handle)}</span><p class="lede">★ ${o.rating.toFixed(1)} · ${o.trades} trades · ${esc(o.city)}</p></div></div>`}
      ${theyWant.length ? `<p class="note stamped">${esc(o.name.split(" ")[0])} has your <strong>${esc(BOOK[theyWant[0].bookId].title)}</strong> on their wishlist.</p>` : ""}
      ${mine
        ? `<div class="btns">
            <button class="btn ghost" data-act="moveListing" data-id="${l.id}">${l.shelf === "trade" ? "Move to Keeping" : "Put up for trade"}</button>
            <button class="btn danger" data-act="removeListing" data-id="${l.id}">Remove</button>
          </div>`
        : `<div class="btns">
            <button class="btn primary" data-act="propose" data-id="${l.id}" ${inTrade ? "disabled" : ""}>${inTrade ? "In a trade right now" : "Propose a trade"}</button>
            <button class="btn ghost" data-act="wish" data-id="${b.id}">${onWishlist(b.id) ? "On your wishlist ✓" : "Add to wishlist"}</button>
          </div>`}
    `;
  }

  function sheetBook(s) {
    const b = BOOK[s.id];
    const avail = S.listings.filter((l) => l.bookId === b.id && l.owner !== "me" && l.shelf === "trade");
    return `
      <div class="detail">
        ${cover(b, "lg")}
        <div><h3>${esc(b.title)}</h3><p class="by">${esc(b.author)}, ${b.year}</p><p class="isbn" style="margin-top:8px">ISBN ${b.isbn}</p></div>
      </div>
      ${avail.length
        ? `<div class="section"><p class="eyebrow">Copies up for trade</p><div class="list">${avail.map((l) => `<button class="card tap" data-act="openListing" data-id="${l.id}"><div class="row"><span class="cond">${COND[l.cond].short}</span><span class="grow">${esc(l.format)} · @${esc(user(l.owner).handle)}</span><span class="lede">★ ${user(l.owner).rating.toFixed(1)}</span></div></button>`).join("")}</div></div>`
        : `<p class="note">Nobody has listed this yet. You'll get an alert when someone does.</p>`}
      <button class="btn ghost" data-act="wish" data-id="${b.id}">${onWishlist(b.id) ? "Remove from wishlist" : "Add to wishlist"}</button>
    `;
  }

  function feeLedger(giveLid, note) {
    const hold = holdFor(giveLid);
    return `<dl class="ledger">
      <div><dt>Shelfswap fee</dt><dd>${money(FEE)}</dd></div>
      <div><dt>USPS Media Mail label</dt><dd>${money(LABEL)}</dd></div>
      <div class="total"><dt>Charged when accepted</dt><dd>${money(FEE + LABEL)}</dd></div>
      <div><dt>Guarantee hold<br><span class="sub">Released the moment USPS scans your package</span></dt><dd>${money(hold)}</dd></div>
    </dl>
    <p class="lede">${note}</p>`;
  }

  function sheetPropose(s) {
    const l = listing(s.id);
    const b = BOOK[l.bookId];
    const o = user(l.owner);
    const mine = S.listings.filter((x) => x.owner === "me" && x.shelf === "trade" && !busy(x.id));
    const wants = S.wishlist[l.owner] || [];
    return `
      <p class="lede">Pick a book from your trade shelf to offer ${esc(o.name.split(" ")[0])} for <strong>${esc(b.title)}</strong>.</p>
      <div class="pick">${mine.map((x) => bookTile(x, { hideOwner: true, match: wants.includes(x.bookId), matchLabel: "THEY WANT IT", act: `data-act="pickGive" data-id="${x.id}"`, pressed: s.pick === x.id })).join("")}</div>
      ${s.pick ? `<div class="card">${feeLedger(s.pick, `Your ${esc(S.me.card.brand)} ending ${esc(S.me.card.last4)} is authorized now and charged only if ${esc(o.name.split(" ")[0])} accepts. The offer expires in 48 hours.`)}</div>` : ""}
      <button class="btn primary" data-act="sendOffer" ${s.pick ? "" : "disabled"}>Send offer</button>
    `;
  }

  function sheetCounter(s) {
    const t = trade(s.id);
    const p = other(t);
    const theirs = S.listings.filter((x) => x.owner === p && x.shelf === "trade" && x.id !== t.give && !busy(x.id));
    return `
      <p class="lede">Keep your <strong>${esc(myBook(t).title)}</strong> on the table, but ask ${esc(first(p))} for a different book.</p>
      <div class="pick">${theirs.map((x) => bookTile(x, { hideOwner: true, match: onWishlist(x.bookId), act: `data-act="pickCounter" data-id="${x.id}"`, pressed: s.pick === x.id })).join("")}</div>
      <button class="btn primary" data-act="sendCounter" ${s.pick ? "" : "disabled"}>Send counter-offer</button>
    `;
  }

  function sheetPay(s) {
    const t = trade(s.id);
    return `
      ${swapRow(t)}
      <div class="card">${feeLedger(myListing(t), "You'll get a prepaid label right away. You have 3 days to drop your book at any post office or USPS box.")}</div>
      <div class="kv card">
        <div><span class="k">Ships from</span><span class="v">${esc(S.me.address.city)}, ${esc(S.me.address.state)}</span></div>
        <div><span class="k">Pay with</span><span class="v">${esc(S.me.card.brand)} ending ${esc(S.me.card.last4)}</span></div>
      </div>
      <button class="btn primary" data-act="confirmAccept" data-id="${t.id}">Accept and pay ${money(FEE + LABEL)}</button>
    `;
  }

  function lanes(t) {
    const rows = ["me", other(t)].map((who) => {
      const s = t.ship[who];
      const step = s.confirmed ? 3 : s.deliveredAt ? 2 : s.shippedAt ? 1 : 0;
      const labels = ["Not shipped yet", "In the mail", "Delivered", "Confirmed"];
      const book = who === "me" ? myBook(t) : theirBook(t);
      return `<div class="lane"><span class="lane-who">${who === "me" ? "You" : esc(first(who))}</span>
        <div class="steps"><span class="${step >= 1 ? "on" : ""}"></span><span class="${step >= 2 ? "on" : ""}"></span><span class="${step >= 3 ? "on" : ""}"></span></div>
        <span class="lane-label">${esc(book.title)}: ${labels[step]}${s.tracking && step < 2 ? " · " + s.tracking : ""}</span></div>`;
    });
    return `<div class="card"><p class="eyebrow">Shipping</p><div class="lanes">${rows.join("")}</div></div>`;
  }

  function sheetTrade(s) {
    const t = trade(s.id);
    const p = other(t);
    const st = statusOf(t);
    let main = "";

    if (t.status === "offered" && t.to === "me") {
      main = `<p class="note stamped">${esc(first(p))} wants your <strong>${esc(myBook(t).title)}</strong> (${COND[listing(myListing(t)).cond].label}) and is offering <strong>${esc(theirBook(t).title)}</strong> (${COND[listing(theirListing(t)).cond].label}, ${esc(listing(theirListing(t)).format.toLowerCase())}). Offer expires in ${left(t.createdAt + OFFER_TTL)}.</p>
        <div class="btns"><button class="btn primary" data-act="accept" data-id="${t.id}">Accept</button><button class="btn ghost" data-act="counter" data-id="${t.id}">Counter</button></div>
        <button class="btn danger" data-act="decline" data-id="${t.id}">Decline</button>`;
    } else if (t.status === "offered") {
      main = `<p class="note">Waiting on ${esc(first(p))}. The offer expires in ${left(t.createdAt + OFFER_TTL)}. Your card is authorized but not charged.</p>
        <button class="btn danger" data-act="withdraw" data-id="${t.id}">Withdraw offer</button>`;
    } else if (t.status === "shipping") {
      const meShipped = t.ship.me.shippedAt;
      main = `${!meShipped ? `<div class="row"><div class="grow"><strong>Ship ${esc(myBook(t).title)}</strong><p class="lede">${left(t.shipBy)} left. Miss it and your ${money(holdFor(myListing(t)))} guarantee goes to ${esc(first(p))}.</p></div>${stampHTML(t.shipBy)}</div>` : ""}
        ${lanes(t)}
        ${!meShipped ? `<div class="btns"><button class="btn primary" data-act="label" data-id="${t.id}">Show shipping label</button></div>
          <button class="btn ghost" data-act="myShip" data-id="${t.id}">Demo: USPS scans my package</button>
          <p class="lede">In the real app nobody types a tracking number. The first USPS scan marks your book as shipped.</p>` : ""}`;
    } else if (t.status === "delivered") {
      const mustConfirm = !t.ship[p].confirmed;
      main = `${lanes(t)}
        ${mustConfirm ? `<p class="note stamped">${esc(theirBook(t).title)} arrived. Check it against the listing: ${COND[listing(theirListing(t)).cond].label}${listing(theirListing(t)).flags.length ? ", " + listing(theirListing(t)).flags.map(esc).join(", ").toLowerCase() : ""}. Auto-confirms in ${left(t.deliveredAt + CONFIRM_WINDOW)}.</p>
          <div class="btns"><button class="btn primary" data-act="confirmBook" data-id="${t.id}">Looks right</button><button class="btn ghost" data-act="report" data-id="${t.id}">Report a problem</button></div>` : ""}`;
    } else if (t.status === "complete") {
      main = !t.rated
        ? `<p class="note">Your book's new home is ${esc(first(p))}'s shelf. ${esc(theirBook(t).title)} is now on your Keeping shelf.</p>
           <div class="section"><p class="eyebrow">Rate ${esc(first(p))}</p><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-act="rate" data-id="${t.id}" data-n="${n}" aria-label="${n} stars">★</button>`).join("")}</div></div>`
        : `<p class="note">Complete. You rated ${esc(first(p))} ${t.rated} stars.</p>`;
    } else if (t.status === "disputed") {
      main = `${lanes(t)}<p class="note warn"><strong>Problem reported: ${esc(t.dispute)}.</strong> Our team reviews your photos within 1 business day. If ${esc(first(p))}'s listing was wrong, they pay for a return label and get a strike. You don't need to do anything right now.</p>`;
    } else if (t.status === "cancelled") {
      main = `<p class="note warn">${esc(t.outcome)}</p>`;
    } else {
      main = `<p class="note">${esc(st.text)}. Nobody was charged.</p>`;
    }

    return `
      ${swapRow(t)}
      <span class="status ${st.cls}">${esc(st.text)}</span>
      ${main}
      <div class="section"><p class="eyebrow">History</p>
        <ol class="timeline">${t.log.slice().reverse().map((e) => `<li><time>${fmtDay(e.at)}, ${new Date(e.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time>${esc(e.text)}</li>`).join("")}</ol>
      </div>
    `;
  }

  function sheetLabel(s) {
    const t = trade(s.id);
    const a = S.me.address;
    const p = user(other(t));
    return `
      <div class="label">
        <div class="row"><span class="big grow">M</span><span>USPS MEDIA MAIL<br>POSTAGE PAID · ${money(LABEL)}</span></div>
        <div>FROM: ${esc(a.name.toUpperCase())}<br>${esc(a.line1.toUpperCase())}<br>${esc(a.city.toUpperCase())} ${esc(a.state)} ${esc(a.zip)}</div>
        <div>SHIP TO: ${esc(p.name.toUpperCase())} (SHELFSWAP #${t.id.toUpperCase()})<br>ADDRESS PRINTED ON THE REAL LABEL<br>${esc(p.city.toUpperCase())}</div>
        <div class="barcode" aria-hidden="true"></div>
        <div>USPS TRACKING # 9400 1118 9922 0${t.id.replace(/\D/g, "").padStart(3, "0")} 4410 72<br>CONTENTS: 1 BOOK · ${esc(myBook(t).title.toUpperCase())}</div>
      </div>
      <p class="lede">Print it, or show the QR code at the post office counter and they'll print it for you. Media Mail is for books only, so don't add notes or bookmarks with ads.</p>
      <button class="btn primary" data-act="myShip" data-id="${t.id}">Demo: USPS scans my package</button>
    `;
  }

  function sheetReport(s) {
    const reasons = ["Condition is worse than listed", "Wrong book or edition", "Damaged in the mail", "Missing pages or writing not disclosed"];
    return `
      <p class="lede">Tell us what's wrong. You'll add photos next. Keep the book and packaging until this is resolved.</p>
      <div class="options">${reasons.map((r) => `<button class="option" data-act="pickReason" data-id="${esc(r)}" aria-pressed="${s.reason === r}"><span class="radio"></span><span><strong>${esc(r)}</strong></span></button>`).join("")}</div>
      <button class="btn primary" data-act="submitReport" data-id="${s.id}" ${s.reason ? "" : "disabled"}>Report problem</button>
    `;
  }

  function sheetAdd(s) {
    if (!s.bookId) {
      const q = (s.q || "").trim().toLowerCase();
      const hits = CATALOG.filter((b) => !q || (b.title + " " + b.author + " " + b.isbn).toLowerCase().includes(q)).slice(0, 9);
      return `
        <label class="search" for="addq">${icon("search", 18)}<input id="addq" type="search" placeholder="Search title or type an ISBN" value="${esc(s.q || "")}" autocomplete="off"></label>
        <button class="btn ghost sm" data-act="scan">Scan the barcode on the back</button>
        <div class="pick" id="addResults">${addHits(hits)}</div>
      `;
    }
    const b = BOOK[s.bookId];
    const shelves = [["trade", "Up for trade", "People can send you offers for it"], ["wish", "Wishlist", "Get an alert when someone lists it"], ["keep", "Keeping", "Part of your library, not for trade"]];
    return `
      <div class="detail" style="grid-template-columns:80px minmax(0,1fr)">${cover(b)}<div><h3>${esc(b.title)}</h3><p class="by">${esc(b.author)}</p><p class="isbn">ISBN ${b.isbn}</p></div></div>
      <div class="section"><p class="eyebrow">Which shelf?</p>
        <div class="options">${shelves.map(([id, l, d]) => `<button class="option" data-act="addShelf" data-id="${id}" aria-pressed="${s.shelf === id}"><span class="radio"></span><span><strong>${l}</strong><span>${d}</span></span></button>`).join("")}</div>
      </div>
      ${s.shelf !== "wish" ? `
      <div class="section"><p class="eyebrow">Condition</p>
        <div class="options">${CONDITIONS.map((c) => `<button class="option" data-act="addCond" data-id="${c.id}" aria-pressed="${s.cond === c.id}"><span class="radio"></span><span><strong>${c.label}</strong><span>${c.desc}</span></span></button>`).join("")}</div>
      </div>
      <div class="section"><p class="eyebrow">Format</p>
        <div class="chips">${["Hardcover", "Paperback", "Mass market"].map((f) => `<button class="chip" data-act="addFormat" data-id="${f}" aria-pressed="${s.format === f}">${f}</button>`).join("")}</div>
      </div>
      <div class="section"><p class="eyebrow">Anything to disclose?</p>
        <div class="chips">${FLAGS.map((f) => `<button class="chip" data-act="addFlag" data-id="${esc(f)}" aria-pressed="${s.flags.includes(f)}">${esc(f)}</button>`).join("")}</div>
        ${["good", "acc"].includes(s.cond) ? '<p class="note">Photos are required for Good and Acceptable copies. In the real app you\'d add 1–4 here.</p>' : ""}
      </div>` : ""}
      <button class="btn primary" data-act="addSave">${s.shelf === "wish" ? "Add to wishlist" : "Add to shelf"}</button>
    `;
  }
  function addHits(hits) {
    return hits.map((b) => `<button class="book" data-act="addPick" data-id="${b.id}"><div class="book-cover-box">${cover(b)}</div><span class="b-title">${esc(b.title)}</span><span class="b-meta">${esc(b.author)}</span></button>`).join("") || '<p class="lede">No books match. The real app searches millions of ISBNs through Open Library.</p>';
  }

  function sheetAddress() {
    const a = S.me.address;
    return `<form id="addrForm" class="section">
      <div class="field"><label for="a-name">Full name</label><input id="a-name" name="name" value="${esc(a.name)}" required autocomplete="name"></div>
      <div class="field"><label for="a-line1">Street address</label><input id="a-line1" name="line1" value="${esc(a.line1)}" required autocomplete="address-line1"></div>
      <div class="fields-2">
        <div class="field"><label for="a-city">City</label><input id="a-city" name="city" value="${esc(a.city)}" required autocomplete="address-level2"></div>
        <div class="field"><label for="a-state">State</label><input id="a-state" name="state" value="${esc(a.state)}" required maxlength="2" autocomplete="address-level1"></div>
        <div class="field"><label for="a-zip">ZIP</label><input id="a-zip" name="zip" value="${esc(a.zip)}" required inputmode="numeric" pattern="[0-9]{5}" autocomplete="postal-code"></div>
      </div>
      <p class="lede">The real app checks this with USPS address validation before you can trade.</p>
      <button class="btn primary" type="submit">Save address</button>
    </form>`;
  }

  function sheetHow() {
    const steps = [
      ["Offer", "Pick a book of yours for a book of theirs. Your card is authorized, not charged. Offers last 48 hours."],
      ["Accept", "Both of you pay the $1 fee and a USPS Media Mail label (about $4.49). Each card also gets a small guarantee hold."],
      ["Ship within 3 days", "Drop your book off. The first USPS scan releases your guarantee hold. If one person doesn't ship, their hold goes to the other person as credit."],
      ["Confirm", "When your book arrives you have 2 days to say it looks right or report a problem. After that it confirms on its own."],
      ["Rate", "Rate each other. Ratings and strikes keep the shelf honest."],
    ];
    return `<ol class="timeline">${steps.map(([h, p]) => `<li><strong>${h}</strong><br>${p}</li>`).join("")}</ol>
      <p class="note">Your address is never shown to the other person. It only appears on the shipping label.</p>`;
  }

  function sheetConditions() {
    return `<div class="kv">${CONDITIONS.map((c) => `<div><span class="k"><strong style="color:var(--ink)">${c.label}</strong><br>${c.desc}</span><span class="v cond">${money(c.hold)} hold</span></div>`).join("")}</div>
      <p class="lede">The guarantee hold is sized to the copy's condition. You only lose it if you don't ship.</p>`;
  }

  function sheetDemo() {
    const t = new Date(S.now);
    return `
      <p class="lede">You're playing yourself. These buttons play everyone else and move the clock, so you can see what happens in each situation.</p>
      <p class="clock">Demo clock: ${t.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
      <div class="section"><p class="eyebrow">Other traders</p>
        <div class="btns">
          <button class="btn ghost sm" data-act="dAccept">They accept my offers</button>
          <button class="btn ghost sm" data-act="dShip">They ship</button>
          <button class="btn ghost sm" data-act="dDeliver">Packages arrive</button>
          <button class="btn ghost sm" data-act="dOffer">Someone sends me an offer</button>
          <button class="btn ghost sm" data-act="dMatch">A wishlist book gets listed</button>
        </div>
      </div>
      <div class="section"><p class="eyebrow">Time</p>
        <div class="btns">
          <button class="btn ghost sm" data-act="dTime" data-n="0.25">+6 hours</button>
          <button class="btn ghost sm" data-act="dTime" data-n="1">+1 day</button>
          <button class="btn ghost sm" data-act="dTime" data-n="3">+3 days</button>
        </div>
        <p class="lede">Try +3 days with a trade you haven't shipped to see a missed ship window.</p>
      </div>
      <button class="btn danger" data-act="dReset">Reset demo</button>
    `;
  }

  const SHEETS = {
    listing: [sheetListing, "Listing"], book: [sheetBook, "Book"], propose: [sheetPropose, "Propose a trade"],
    counter: [sheetCounter, "Counter-offer"], pay: [sheetPay, "Accept trade"], trade: [sheetTrade, "Trade"],
    label: [sheetLabel, "Shipping label"], report: [sheetReport, "Report a problem"], add: [sheetAdd, "Add a book"],
    address: [sheetAddress, "Shipping address"], how: [sheetHow, "How trades work"], conditions: [sheetConditions, "Condition guide"],
    demo: [sheetDemo, "Demo controls"],
  };

  /* ---------------- render ---------------- */

  const app = document.getElementById("app");

  function render() {
    const unread = S.notes.filter((n) => !n.read).length;
    const todo = S.trades.filter(needsMe).length;
    const views = { discover: viewDiscover, shelf: viewShelf, trades: viewTrades, alerts: viewAlerts, profile: viewProfile };
    const tabs = [["discover", "Discover", 0], ["shelf", "Shelf", 0], ["trades", "Trades", todo], ["alerts", "Alerts", unread], ["profile", "You", 0]];
    let sheet = "";
    if (ui.sheet) {
      const [fn, title] = SHEETS[ui.sheet.type];
      const enter = ui.sheetEnter ? " enter" : "";
      sheet = `<div class="scrim${enter}" data-act="close"></div>
        <section class="sheet${enter}" role="dialog" aria-modal="true" aria-label="${title}">
          <span class="grabber"></span>
          <div class="sheet-head"><h2>${title}</h2><button class="x" data-act="close" aria-label="Close">${icon("x", 18)}</button></div>
          ${fn(ui.sheet)}
        </section>`;
      ui.sheetEnter = false;
    }
    const prevScroll = document.querySelector(".sheet")?.scrollTop;
    app.innerHTML = `
      <header class="top">
        <div class="brand"><h1>Shelfswap</h1><small>${fmtDay(S.now)}</small></div>
        <button class="demo-btn" data-act="demo">Demo</button>
      </header>
      ${views[ui.tab]()}
      <div class="tabbar"><nav>${tabs.map(([id, label, n]) => `<button data-act="tab" data-id="${id}" ${ui.tab === id ? 'aria-current="page"' : ""}>${icon(id)}${label}${n ? `<span class="badge">${n}</span>` : ""}</button>`).join("")}</nav></div>
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
    if (fresh) {
      render();
      const sh = document.querySelector(".sheet");
      if (sh) sh.scrollTop = 0;
      return;
    }
    render();
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

  /* ---------------- actions ---------------- */

  const A = {
    tab(d) { ui.tab = d.id; ui.sheet = null; window.scrollTo(0, 0); render(); },
    shelfTab(d) { ui.shelf = d.id; render(); },
    tradesTab(d) { ui.tradesTab = d.id; render(); },
    filter(d) { ui.filter = d.id; render(); },
    close: closeSheet,
    demo() { openSheet("demo"); },
    how() { openSheet("how"); },
    conditions() { openSheet("conditions"); },
    openListing(d) { openSheet("listing", { id: d.id }); },
    openBook(d) { openSheet("book", { id: d.id }); },
    openTrade(d) { openSheet("trade", { id: d.id }); },

    wish(d) {
      const w = S.wishlist.me;
      const on = w.includes(d.id);
      S.wishlist.me = on ? w.filter((b) => b !== d.id) : w.concat(d.id);
      commit(on ? "Removed from wishlist" : "Added to wishlist. We'll alert you when copies appear.");
    },

    propose(d) { openSheet("propose", { id: d.id, pick: null }); },
    pickGive(d) { ui.sheet.pick = d.id; render(); },
    sendOffer() {
      const l = listing(ui.sheet.id);
      const t = {
        id: uid("t"), from: "me", to: l.owner, give: ui.sheet.pick, get: l.id, status: "offered", createdAt: S.now,
        log: [{ at: S.now, text: "You offered " + BOOK[listing(ui.sheet.pick).bookId].title + " for " + first(l.owner) + "'s " + BOOK[l.bookId].title + ". Card authorized, not charged." }],
      };
      S.trades.push(t);
      ui.sheet = null;
      ui.tab = "trades";
      ui.tradesTab = "active";
      commit("Offer sent to " + first(l.owner) + ". It expires in 48 hours.");
    },

    accept(d) { openSheet("pay", { id: d.id }); },
    confirmAccept(d) {
      const t = trade(d.id);
      acceptTrade(t);
      log(t, "You accepted. " + money(FEE + LABEL) + " charged. Labels created for both of you.");
      openSheet("trade", { id: t.id });
      commit("Trade on. Ship by " + fmtDay(t.shipBy) + ".");
    },
    decline(d) {
      const t = trade(d.id);
      t.status = "declined";
      log(t, "You declined. " + first(other(t)) + "'s card hold was released.");
      closeSheet();
      commit("Offer declined");
    },
    withdraw(d) {
      const t = trade(d.id);
      t.status = "withdrawn";
      log(t, "You withdrew the offer. Card hold released.");
      closeSheet();
      commit("Offer withdrawn");
    },
    counter(d) { openSheet("counter", { id: d.id, pick: null }); },
    pickCounter(d) { ui.sheet.pick = d.id; render(); },
    sendCounter() {
      const old = trade(ui.sheet.id);
      const p = other(old);
      old.status = "countered";
      log(old, "You countered with a different book.");
      const want = listing(ui.sheet.pick);
      const t = {
        id: uid("t"), from: "me", to: p, give: myListing(old), get: want.id, status: "offered", createdAt: S.now,
        log: [{ at: S.now, text: "You countered: " + myBook(old).title + " for " + BOOK[want.bookId].title + "." }],
      };
      S.trades.push(t);
      openSheet("trade", { id: t.id });
      commit("Counter-offer sent to " + first(p));
    },

    label(d) { openSheet("label", { id: d.id }); },
    myShip(d) {
      const t = trade(d.id);
      markShipped(t, "me");
      openSheet("trade", { id: t.id });
      commit("USPS scanned your package. Guarantee hold released.");
    },
    confirmBook(d) {
      const t = trade(d.id);
      log(t, "You confirmed " + theirBook(t).title + " matches the listing.");
      confirm(t, other(t));
      render();
      commit(t.status === "complete" ? "Trade complete" : "Confirmed");
    },
    report(d) { openSheet("report", { id: d.id, reason: null }); },
    pickReason(d) { ui.sheet.reason = d.id; render(); },
    submitReport(d) {
      const t = trade(d.id);
      t.status = "disputed";
      t.dispute = ui.sheet.reason;
      log(t, "You reported a problem: " + ui.sheet.reason + ". Auto-confirm paused.");
      openSheet("trade", { id: t.id });
      commit("Problem reported. We'll reply within 1 business day.");
    },
    rate(d) {
      const t = trade(d.id);
      t.rated = Number(d.n);
      log(t, "You rated " + first(other(t)) + " " + d.n + " stars.");
      commit("Thanks. Rating saved.");
    },

    moveListing(d) {
      const l = listing(d.id);
      l.shelf = l.shelf === "trade" ? "keep" : "trade";
      closeSheet();
      commit(l.shelf === "trade" ? "Now up for trade" : "Moved to Keeping");
    },
    removeListing(d) {
      S.listings = S.listings.filter((l) => l.id !== d.id);
      closeSheet();
      commit("Removed from your shelf");
    },

    addBook() { openSheet("add", { q: ui.q, bookId: null, shelf: ui.shelf === "wish" ? "wish" : "trade", cond: "vg", format: "Paperback", flags: [] }); },
    scan() { toast("The real app opens your camera and reads the ISBN barcode."); render(); },
    addPick(d) {
      ui.sheet.bookId = d.id;
      if (S.wishlist.me.includes(d.id)) ui.sheet.shelf = "keep";
      render();
      const sh = document.querySelector(".sheet");
      if (sh) sh.scrollTop = 0;
    },
    addShelf(d) { ui.sheet.shelf = d.id; render(); },
    addCond(d) { ui.sheet.cond = d.id; render(); },
    addFormat(d) { ui.sheet.format = d.id; render(); },
    addFlag(d) {
      const f = ui.sheet.flags;
      ui.sheet.flags = f.includes(d.id) ? f.filter((x) => x !== d.id) : f.concat(d.id);
      render();
    },
    addSave() {
      const s = ui.sheet;
      const b = BOOK[s.bookId];
      if (s.shelf === "wish") {
        if (!S.wishlist.me.includes(b.id)) S.wishlist.me.push(b.id);
      } else {
        S.listings.push({ id: uid("l"), owner: "me", bookId: b.id, shelf: s.shelf, cond: s.cond, flags: s.flags, format: s.format, addedAt: S.now });
      }
      ui.sheet = null;
      ui.tab = "shelf";
      ui.shelf = s.shelf;
      commit(b.title + (s.shelf === "trade" ? " is up for trade" : s.shelf === "wish" ? " added to your wishlist" : " added to Keeping"));
    },

    editAddress() { openSheet("address"); },

    readAll() { S.notes.forEach((n) => (n.read = true)); commit(); },
    openNote(d) {
      const n = S.notes.find((x) => x.id === d.id);
      n.read = true;
      save();
      if (n.go && n.go.trade) return openSheet("trade", { id: n.go.trade });
      if (n.go && n.go.listing && listing(n.go.listing)) return openSheet("listing", { id: n.go.listing });
      render();
    },

    /* demo: the other side of every trade */
    dAccept() {
      const mine = S.trades.filter((t) => t.status === "offered" && t.from === "me");
      if (!mine.length) return toast("You have no open offers. Propose a trade from Discover first."), render();
      mine.forEach((t) => {
        acceptTrade(t);
        log(t, first(t.to) + " accepted. " + money(FEE + LABEL) + " charged. Labels created for both of you.");
        notify(first(t.to) + " accepted your offer", "Ship " + myBook(t).title + " by " + fmtDay(t.shipBy) + ". Your label is ready.", { trade: t.id });
      });
      commit(mine.length + " offer" + (mine.length > 1 ? "s" : "") + " accepted");
    },
    dShip() {
      const list = S.trades.filter((t) => t.status === "shipping" && !t.ship[other(t)].shippedAt);
      if (!list.length) return toast("Nobody owes you a package right now."), render();
      list.forEach((t) => {
        markShipped(t, other(t));
        notify(first(other(t)) + " shipped " + theirBook(t).title, "Tracking " + t.ship[other(t)].tracking + ".", { trade: t.id });
      });
      commit("Partner packages scanned by USPS");
    },
    dDeliver() {
      const list = S.trades.filter((t) => t.status === "shipping");
      let n = 0;
      list.forEach((t) => {
        const p = other(t);
        if (t.ship[p].shippedAt && !t.ship[p].deliveredAt) {
          markDelivered(t, p);
          notify(theirBook(t).title + " was delivered", "Check it against the listing within 2 days.", { trade: t.id });
          n++;
        }
        if (t.ship.me.shippedAt && !t.ship.me.deliveredAt) {
          markDelivered(t, "me");
          t.ship.me.confirmed = true;
          log(t, first(p) + " confirmed your book looks right.");
          n++;
        }
        if (t.status === "shipping" && Object.values(t.ship).every((s) => s.deliveredAt)) { t.status = "delivered"; t.deliveredAt = S.now; }
      });
      if (!n) return toast("Nothing in the mail yet. Ship something first."), render();
      commit(n + " package" + (n > 1 ? "s" : "") + " delivered");
    },
    dOffer() {
      const mine = S.listings.filter((l) => l.owner === "me" && l.shelf === "trade" && !busy(l.id));
      const theirs = S.listings.filter((l) => l.owner !== "me" && l.shelf === "trade" && !busy(l.id) && !S.trades.some((t) => t.status === "offered" && (t.give === l.id || t.get === l.id)));
      if (!mine.length || !theirs.length) return toast("No free books to build an offer from."), render();
      const g = theirs[Math.floor(Math.random() * theirs.length)];
      const w = mine[Math.floor(Math.random() * mine.length)];
      const t = {
        id: uid("t"), from: g.owner, to: "me", give: g.id, get: w.id, status: "offered", createdAt: S.now,
        log: [{ at: S.now, text: first(g.owner) + " offered " + BOOK[g.bookId].title + " for your " + BOOK[w.bookId].title + "." }],
      };
      S.trades.push(t);
      notify("New offer from " + first(g.owner), BOOK[g.bookId].title + " (" + COND[g.cond].label + ") for your " + BOOK[w.bookId].title + ".", { trade: t.id });
      commit("New offer from " + first(g.owner));
    },
    dMatch() {
      const want = S.wishlist.me.filter((b) => !S.listings.some((l) => l.bookId === b && l.owner !== "me" && l.shelf === "trade"));
      if (!want.length) return toast("Every wishlist book already has a copy listed."), render();
      const bookId = want[0];
      const owner = ["sam", "jonah", "theo", "priya"][Math.floor(Math.random() * 4)];
      const l = { id: uid("l"), owner, bookId, shelf: "trade", cond: "vg", flags: [], format: "Paperback", addedAt: S.now };
      S.listings.push(l);
      notify(BOOK[bookId].title + " is up for trade", first(owner) + " listed a Very Good paperback. It's on your wishlist.", { listing: l.id });
      commit("Wishlist match: " + BOOK[bookId].title);
    },
    dTime(d) {
      const steps = Math.round(Number(d.n) * 24);
      for (let i = 0; i < steps; i++) { S.now += HOUR; tick(); }
      commit("Clock moved to " + fmtDay(S.now));
    },
    dReset() {
      S = seed();
      ui.sheet = null;
      ui.tab = "discover";
      ui.q = "";
      commit("Demo reset");
    },
  };

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const fn = A[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el.dataset, el); }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id === "q") {
      ui.q = e.target.value;
      const r = document.getElementById("results");
      if (r) r.innerHTML = discoverResults();
    }
    if (e.target.id === "addq" && ui.sheet) {
      ui.sheet.q = e.target.value;
      const q = e.target.value.trim().toLowerCase();
      const hits = CATALOG.filter((b) => !q || (b.title + " " + b.author + " " + b.isbn).toLowerCase().includes(q)).slice(0, 9);
      const r = document.getElementById("addResults");
      if (r) r.innerHTML = addHits(hits);
    }
  });

  document.addEventListener("submit", (e) => {
    if (e.target.id !== "addrForm") return;
    e.preventDefault();
    const f = new FormData(e.target);
    S.me.address = { name: f.get("name"), line1: f.get("line1"), city: f.get("city"), state: String(f.get("state")).toUpperCase(), zip: f.get("zip") };
    closeSheet();
    commit("Address saved");
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
