# Wormy: product plan

**Your bookshelf is full of books someone else wants. Wormy helps you turn them into your next great read.**

Readers scan their books into a personal library, send books other readers request, and earn **book credits** they can spend on any available book. Wormy runs the marketplace. It doesn't own inventory or pay for shipping.

---

## 1. Decisions so far

| Topic | Decision |
|---|---|
| Exchange model | **Credits, not direct swaps.** Send a book, earn 1 credit. Spend 1 credit on any book from anyone. Nobody needs to want the other person's book |
| Fees | $1 to send + $1 to receive (pricing experiment B: recipient pays $2, sender $0) |
| How fees are paid | Prepaid **fee balance**, topped up $5, $10 or $20 on **Stripe's hosted checkout** (Apple Pay, Google Pay, cards, Link). Wormy never sees or stores card numbers |
| Deposit | **None.** The earlier $8 hold protected direct swaps. With credits, a recipient who never gets their book just has the credit returned |
| Shipping | Sender buys postage (USPS Media Mail suggested) and **enters the tracking number**. It's real tracking, not a guess: every exchange links to the carrier's own tracking page, and with EasyPost set up each carrier scan (label created, in transit, out for delivery, delivered, problems) shows in the app with the expected date. "Delivered" starts the 2-day confirm window. Recipients can also confirm by hand. In-app labels come later |
| When credits settle | When tracking shows delivered **and** the recipient confirms, or 2 days after delivery with no problem reported |
| Welcome credit | 1 credit after listing **3 available books** and a **first top-up**. A card that already unlocked a welcome credit on another account can't unlock another (Stripe card fingerprint). Logged separately so it can be measured or switched off |
| Sign-in | **Continue with Apple**, **Continue with Google**, or an **email link / 6-digit code**. No passwords |
| Profile | Name, @handle, photo, city and state (public); street address (private, shown only to the reader shipping you a book, until they ship) |
| "Points" | Read as fee-balance top-ups. Book credits still can't be bought |
| Brand | **Wormy**. The logo is a hand-drawn marker mark, traced to a vector (`brand/logo.svg`, original in `brand/logo-source.png`) and drawn in the text color so it works in light and dark. It's the header logo and the app icon. Every icon and drawing follows it: felt-tip lines with a slight wobble and rough edges, loops that overshoot, and pastel color laid a little off the line (the current tab's icon gets its color). Book-jacket art is cut into hand-made shapes in each book's colors. All of it comes from one seeded script, `brand/handdraw.py`. Eclectic mid-century look on **aged paper**: a warm off-white ground with fine grain, a high-contrast serif (Gloock) for headings, Jost for text, one bottle-green action color, and pastel accents. Books without a cover photo get a printed-style jacket in one of seven mid-century layouts (Penguin bands, Bauhaus, Swiss grid, cut paper, stripes, sunburst, framed). A few hand-drawn marks, used sparingly: a felt-tip underline under the reader's name and under "a credit" when one is earned, and a highlighter swipe on the sign-in headline and the featured pick's label. They draw on once, like someone marking up a favorite page. Discover opens with a greeting and one featured pick. Cards and books fade in as they load, over shimmering placeholder shelves |
| Region | US only (50 states + DC) |
| Book summaries | A 2–3 sentence "About this book" note, **written by Claude** from only the title and author: its own words, no quotes, no publisher copy, no spoilers, labeled as AI-written. Written once per book and shared. Optional |
| Condition ratings | When a book arrives, the recipient says what condition it's **really** in. That updates their copy, goes on that physical copy's history (shown without names), and builds each sender's "condition as described in N of M swaps" record. Bigger problems still go through Report a problem |
| Navigation | Discover · My Shelf (Available / Not available / Wishlist) · **Scan** · **Exchanges** · Profile. Credit balance (a highlighted, pen-circled "1 credit" that opens the wallet) and alerts sit in the header |

## 2. Data model

Credits are never treated as dollars, and balances are never stored as a single editable number.

| Table | What it is | Key rules |
|---|---|---|
| **books** | Canonical metadata, keyed by ISBN (Open Library, Google Books fallback), plus the saved AI summary | One row per edition. One summary per book; the first one written is kept |
| **copies** | A physical book a user owns: condition, format, flags, photos | Ownership moves to the recipient when an exchange completes |
| **listings** | A copy that's open for requests (`opened_at`, `closed_at`) | At most one open listing per copy |
| **requests** | A reader asking for a listing, with the condition the copy was listed in at that moment. Status: pending, accepted, declined, expired, withdrawn | One pending request per reader per listing |
| **exchanges** | Fulfillment of an accepted request: ship-by date, carrier, tracking, delivered, confirmed, and the condition it arrived in. Status: accepted, shipped, delivered, disputed, complete, cancelled | **At most one active exchange per copy** (database unique index on `copy_id` where status is active) |
| **credit_entries** | Append-only ledger: grant, reserve, release, spend, earn, reverse. Each moves exactly 1 credit | Never updated or deleted. Balances are computed from it |
| **payments** | Real money: fee-balance top-ups (Stripe charges) and captured fees | Fees are captured only when an exchange completes |

### Credit entries

| Entry | When | Available | Reserved |
|---|---|---|---|
| grant | Welcome credit unlocked | +1 | |
| reserve | Reader sends a request | −1 | +1 |
| release | Request declined, expired, withdrawn, or exchange cancelled | +1 | −1 |
| spend | Exchange completes (recipient side) | | −1 |
| earn | Exchange completes (sender side) | +1 | |
| reverse | A completed exchange is overturned later | −1 | |

**"Pending"** in the wallet is not a ledger entry. It counts books you've shipped that haven't completed yet. They aren't spendable, so marking a book as shipped never creates credit.

### Safeguards

- **No double-spending:** a request can only be created when available ≥ 1. The check and the reserve entry happen in one database transaction, with a row lock on the user.
- **No duplicate awards:** unique index on `(user_id, request_id, type)` for reserve, release, spend, earn and reverse. Release and spend are mutually exclusive per request.
- **No unavailable requests:** a request needs an open listing whose copy isn't in an active exchange. Accepting one request auto-declines the others for that copy.
- **Payments follow status:** a fee is set aside when a request is made (recipient) or accepted (sender), and only captured when the exchange completes.

The prototype in this repo uses exactly these records and rules (`app.js`), so it can be ported table for table.

## 3. Exchange lifecycle

```
Requested ─48h─▶ Accepted ─3 days─▶ Shipped ─▶ Delivered ─2 days─▶ Complete
    │                │                  │            │               (spend + earn + fees)
    │                │                  │            └─ Problem reported ─▶ Support decides
    │                │                  └─ No delivery in 10 days ─▶ Cancelled (lost)
    │                └─ No tracking in 3 days ─▶ Cancelled + sender strike
    └─ Declined / expired / withdrawn ─▶ Credit released
```

| Situation | Recipient | Sender |
|---|---|---|
| Completes normally | Credit spent, $1 fee | +1 credit, $1 fee |
| Owner declines or doesn't answer in 48h | Credit released | Nothing |
| Sender doesn't ship in 3 days | Credit released, nothing charged | Strike |
| Lost in the mail (10 days, no delivery) | Credit released | No credit. Insurance claim is theirs |
| Book doesn't match listing, upheld | Credit released, no fee | No credit, strike |
| Problem reported, rejected | Completes normally | Completes normally |
| 3 strikes in 6 months | | Requests and listings paused |

## 4. Fees and unit economics

Default pricing: **$1 to send, $1 to receive.** Senders also pay postage (~$4–5 with Media Mail).

| Per completed exchange | Amount |
|---|---|
| Platform fees | $2.00 |
| Card cost if each $1 were charged separately | ~$0.66 (2 × 30¢ + 2.9%) |
| Card cost with $5 top-ups (each covers 5 fees) | ~$0.18 per exchange, about $0.09 per fee |

**Pricing experiment B:** recipient pays $2, sender pays $0. Same revenue, and it may make it easier to get people to list books. The demo panel switches between the two. Each request records the pricing it was made under.

The wallet should feel like a library card, not a bank account. Credits can't be bought, cashed out or transferred, and they don't expire.

## 5. Screens

| Screen | What's there |
|---|---|
| Onboarding | Name and photo, favorite genres, a few wanted books, then List → Earn → Discover → Request |
| Discover | Search (title, author, ISBN), welcome-credit progress, wishlist matches, Trending, Recently listed, genre/condition/availability filters |
| Book page | Condition, AI summary, owner (with their condition record), the cost: **1 credit + $1 fee**, who ships and how, and this copy's history |
| Request | Credit check, address confirmation, fee from balance, reserve |
| My Shelf | Available / Not available / Wishlist. Per-copy condition, format, flags, availability toggle |
| Scan | Viewfinder (real camera on supported phones, simulated elsewhere), default condition, rapid add, quick condition fixes, title/ISBN search with Open Library lookup |
| Exchanges | To send / Coming to me / History. Step tracker, ship-by stamp, tracking entry, confirm or report, star rating, and "what condition did it arrive in?" |
| Wallet | Available / reserved / pending, credit history, fee balance and top-ups |
| Sign in | Apple, Google, or email link with a 6-digit code |
| Profile | Photo, name, @handle, city; address (US); fees and Stripe top-ups; strikes; appearance (light by default, or dark, or match the phone); help; legal; sign out; delete account; support queue for admins |
| Demo panel | Plays other readers, moves the clock, decides disputes, switches pricing, shows a small business view |

## 6. Backend (built)

| Need | Built with | Where |
|---|---|---|
| Accounts, database, photo storage, hourly timers | **Supabase** (Postgres, Auth, Storage, pg_cron) | `supabase/migrations/` |
| Fee-balance top-ups | **Stripe Checkout** (hosted page) plus a signed webhook. No Stripe Connect, since no money is paid out to readers | `supabase/functions/create-checkout`, `stripe-webhook` |
| Book lookup and search | Open Library, then Google Books (server-side, so readers can't rename books) | `supabase/functions/add-book` |
| Barcode scanning | Browser `BarcodeDetector` (Android), bundled ZXing (iPhone) | `app.js`, `vendor/` |
| Tracking | Format checks and one-use rule in the database; carrier tracking links; **EasyPost** scan updates via a signed webhook (optional) | `add-tracking`, `tracking-webhook` |
| Search | Typo-tolerant search over the whole catalog in Postgres (`pg_trgm`), editions grouped, live availability, similar-book suggestions | `search_books`, `similar_books` |
| Book summaries | **Claude** (Anthropic API), once per book, saved and shared (optional) | `book-summary` |
| Account deletion | Anonymizes the profile, removes photo and sign-in; keeps the ledgers | `delete-account` |
| Alerts | In-app, refreshed every 30 seconds. **Push and email: not built yet** | |
| Analytics | **Not built yet.** PostHog suggested, for the metrics below | |

Timers (48h accept, 24h ship reminder, 3-day ship, 2-day confirm, 10-day lost) run every hour in `worm_tick()`. The demo's `tick()` mirrors them.

### Security model

- **One door in.** Every table has Row Level Security on with no policies, and the public roles have no table access at all. The app can only call about 20 named database functions. Each one checks who is calling, what they own and what state things are in, then makes its change in a single transaction.
- **Credits and money can't be edited.** Both ledgers are append-only. A trigger blocks edits and deletes, even by the database owner. Unique indexes stop duplicate awards, and a row lock stops two simultaneous requests from spending the same credit.
- **No card data.** Payments happen on Stripe's page. The balance is only credited by a webhook whose signature is checked, and replays are ignored. Amounts must be on the allowed list and in USD.
- **Address privacy.** A street address goes only to the sender of an accepted exchange, and disappears once they add tracking.
- **Fraud brakes.** A tracking number can prove only one shipment. One card can unlock only one welcome credit. A copy can be in only one exchange. 3 strikes in 6 months pause an account. There are limits on open requests, shelf size, wishlist size, and per-reader limits on the server functions.
- **Photos.** Shrunk in the browser, which strips location data. Stored only in the reader's own folder, and saved as a path in Wormy's storage, never as an outside web address.
- **Web page hardening.** A Content Security Policy allows scripts from Wormy only (libraries are bundled, not pulled from CDNs). Every reader-entered text is escaped. `_headers` adds clickjacking, sniffing and HSTS protection.
- **Tests.** 101 automated checks, including attack attempts (see `SETUP.md`).

## 7. Search and the book catalog

**The catalog** is every book anyone on Wormy has scanned, wished for or looked up: one row per edition (ISBN) in `books`. It grows on its own. The first time a reader scans or looks up a book, the `add-book` function fetches it from Open Library (Google Books as backup) and saves it for everyone.

**Searching** happens in the database, so it covers the whole catalog, not just what the app has loaded:

- Title and author, forgiving typos ("pachnko" finds Pachinko), or an ISBN-10 or ISBN-13 typed any way (dashes and spaces are fine).
- Editions are grouped: same title (ignoring "The", subtitles and series notes) and same author surname. "Dune" is one result with every copy of every edition behind it.
- Each result says how many copies anyone could request right now. That means an open listing, not in an exchange, not yours, and from an account that still exists.
- A few copies per book come back with their owners' public profiles, so book pages work even for books the app hadn't loaded.

**What readers see:**

| Situation | Screen |
|---|---|
| Copies are free | **Available now**, with the count |
| On Wormy, nobody has one free | **Not on a shelf yet**: wishlist it, and see how many readers want it. Similar books you can get now are shown underneath |
| Not on Wormy at all | **Not on anyone's shelf yet**, with **Look it up**, which searches Open Library from the Scan tab. Picking a result adds it to the catalog so it can be wished for or added to your shelf. Also shows **Popular right now** |
| A book page with no copies | Wishlist button plus **You can get these now**: same author first, then same genre, then the most wanted |

**Wishlists cover every edition.** Listing any edition alerts everyone who wished for any edition. Receiving any edition takes it off the wishlist. Book pages list copies of every edition and mark the ones that differ.

**Edge cases handled:** typos; ISBN-10 vs 13; punctuation, "The", subtitles and series notes; "Herbert, Frank" vs "Frank Herbert"; wildcard characters typed into search; one-letter searches; your own copies never offered to you; books in an exchange not counted; deleted accounts' books hidden; books without a cover get a generated jacket; typed text is never lost when the screen refreshes.

**Not handled yet (worth deciding later):**

- Books with no ISBN (old or self-published). These need an "add by hand" form, ideally reviewed before they show to everyone.
- Two different books with the same title and author surname would be grouped. This is rare.
- Accents: "Garcia Marquez" finds "García Márquez" through fuzzy matching, but not perfectly. Postgres's `unaccent` extension would make it exact.
- Translations and series aren't linked ("next in series", "same book in Spanish").
- Searches that find nothing aren't recorded. Logging them would show which books readers want that nobody has yet, which is useful for growth.
- Results aren't sorted by distance. With flat-rate Media Mail this matters less.

## 8. Metrics

**North star: completed exchanges per monthly active user.**

| Supply | Demand and fulfillment | Business |
|---|---|---|
| Books listed per active user | % of listings that get a request | Revenue per completed exchange |
| Time from listing to first request | % of requests that complete | Card processing cost per exchange |
| Books shipped per active user | Time from request to delivery | Customer acquisition cost |
| | Repeat exchanges per user | Contribution margin per exchange |
| | Welcome credits granted vs. credits earned | |

## 9. Still open

- Uneven trades: should a hardcover cost more than 1 credit? (MVP: 1 book = 1 credit.)
- Photos: required for every listing, or only Good and Acceptable?
- Welcome credit experiment: what result would make it permanent?
- When to add in-app shipping labels (and whether to mark them up).
