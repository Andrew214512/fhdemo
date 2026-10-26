# Shelfswap — product plan

Working name: **Shelfswap**. Other options: *Dog-Ear*, *Spine Swap*, *Swapshelf*, *Library Trader*. Check trademarks and app-store names before you commit to one.

**What it is:** a one-for-one book trading app. You list books you've finished, keep a wishlist, and trade a book for a book. Shelfswap charges a **$1 fee per person per trade**, and each person pays for their own shipping label.

---

## 1. Lessons from Poshmark

| Poshmark does | What we copy | What changes for trades |
|---|---|---|
| Sends a prepaid shipping label, so tracking is automatic | **We generate both labels.** Nobody types in a tracking number; the first carrier scan tells us the book shipped | There are two shipments, one in each direction |
| Seller has 7 days to ship, or the buyer can cancel | **3-day ship window** after a trade is accepted | Both people have to ship, so we need a guarantee that covers whoever doesn't |
| Buyer has 3 days after delivery to accept or open a case | **2 days after delivery** to confirm "as described" or report a problem. If you do nothing, it auto-confirms | Each person confirms the book they received |
| Holds the money until the buyer accepts | **Guarantee hold** on each person's card (see §3) | No money goes from one trader to the other |
| Offers are binding (payment is taken when you offer) | Card is authorized when you send an offer, charged when it's accepted | Offers expire after 48 hours |
| Closet, likes, "price drop" alerts | **Library** (Up for trade / Keeping / Wishlist) and **match alerts** | Matching is two-sided: "they have what you want *and* you have what they want" |

## 2. Core objects

- **Book**: one edition, found by ISBN (Open Library or Google Books API). The ISBN barcode can be scanned with the phone camera.
- **Copy (listing)**: your physical copy. It records the shelf (Up for trade / Keeping), condition, format (hardcover/paperback), flags, and 1–4 photos.
- **Wishlist entry**: a book you want, with an optional minimum condition ("Very Good or better").
- **Trade**: two copies, two people, and a status (below).

### Condition scale (same as AbeBooks/Amazon so people already know it)

| Grade | Meaning |
|---|---|
| New | Unread, no marks |
| Like New | Read once, no creases or marks |
| Very Good | Light shelf wear, spine intact, no writing |
| Good | Visible wear, spine creases, any notes must be disclosed |
| Acceptable | Heavy wear, but complete and readable |

**Flags:** highlighting/notes, dust jacket included, ex-library, signed, smoke-free home. Photos are required for Good and Acceptable.

## 3. Trade lifecycle

```
Offer ──48h──▶ Accepted ──3 days──▶ Both shipped ──▶ Both delivered ──2 days──▶ Complete ──▶ Rate each other
  │  │                    │
  │  └ Countered          └ Someone misses the ship window ──▶ Cancelled (guarantee applies)
  └ Declined / Expired
```

**Money at each step (per person):**

| Step | Charged | Held | Released |
|---|---|---|---|
| Send offer | — | $1 fee + label (~$4.50) + guarantee | — |
| Offer accepted | $1 fee + label | Guarantee stays held | — |
| Your book's first carrier scan | — | — | **Guarantee released** |
| You miss the 3-day window | **Guarantee charged**, paid to your partner as credit | — | Partner's fee refunded |
| Offer declined or expired | — | — | Everything released |

The **guarantee** is a flat **$8** card hold on each person, whatever the book. It ends the "what if they don't ship" problem: shipping is the only way to get the hold released.

### Edge cases

| Case | What happens |
|---|---|
| Partner never ships | Day 2: reminder push. Day 3: trade cancelled, partner's guarantee goes to you as credit, your fee is refunded, partner gets a strike. If your book is already moving, we issue a return label charged to them |
| Neither ships | Cancelled, both holds released, both get a strike |
| Book isn't as described | "Report a problem" within 2 days, with photos. If upheld, the other person pays for a return label and gets a strike |
| Lost or damaged in the mail | Label insurance covers it (Shippo/EasyPost add-on). You get credit for the book's value |
| A book is in two offers | Accepting one auto-declines the others for that copy |
| Someone cancels after accepting | Treated as missing the window |
| 3 strikes in 6 months | Account paused, so bad actors can't build up a history |
| New users | Card on file and a verified address before the first offer. Limit 2 open trades until the first one completes |

## 4. Notifications

| Trigger | Channel |
|---|---|
| Someone lists a book on your wishlist (**match**) | Push + daily digest email |
| Two-way match ("Maya has *Pachinko* and wants *Circe*") | Push, top of Discover |
| You receive an offer or counter | Push + email |
| Offer accepted (time to ship) | Push + email with label PDF |
| 24 hours left to ship | Push |
| Partner shipped / book delivered | Push |
| Confirm or report (auto-confirm in 24h) | Push |

On iPhone, web push only works after the user adds the PWA to the home screen (iOS 16.4+). The app should prompt for this after the first trade, when the user has a reason to say yes.

## 5. Services to integrate

| Need | Recommended | Why |
|---|---|---|
| **Payments** | **Stripe** (Payment Element + Apple Pay/Google Pay) | Save card with SetupIntent; charge the fee and label; use a *manual-capture* PaymentIntent for the guarantee hold. A Stripe card hold lasts 7 days, which covers 48h offer + 3-day ship window |
| Payouts to users? | **Not needed** | Penalties are paid out as Shelfswap credit, not cash. That means no Stripe Connect, no identity checks for payouts, and no money-transmitter questions. Check this with a lawyer before launch |
| **Shipping labels + tracking** | **Shippo** or **EasyPost** | Buy USPS **Media Mail** labels (~$4–5 for one book), get tracking webhooks (shipped/delivered), add insurance |
| **Address** | Shippo/EasyPost address validation + Google Places autocomplete | Addresses are **never shown to the other trader**; they only appear on the label |
| Book data + covers | Open Library (free), Google Books as fallback | ISBN lookup, covers, authors |
| Barcode scan | Browser `BarcodeDetector`, with ZXing as fallback | Scan the ISBN on the back cover |
| Accounts, database, photo storage | **Supabase** (Postgres + Auth + Storage + Edge Functions) | One service, generous free tier, runs the Stripe/Shippo webhooks |
| Push | Web Push (VAPID) through the service worker | Works in a PWA without app stores |
| Email | Resend or Postmark | Offers, labels, receipts |
| Sales tax on the $1 fee | Stripe Tax | Some states tax service fees |

**Unit economics (one trade):** each person pays $1 + ~$4.50 label = ~$5.50. Stripe takes ~2.9% + 30¢ per charge, which would eat a third of a $1 fee. Charge the fee and the label together as one payment so the 30¢ only applies once. Shelfswap nets roughly **$0.55 per person per trade**. Fixes for later: a $2 fee, or prepaid "trade credits" (buy 5 trades for $5) to cut card fees.

**Media Mail rules:** books only, nothing promotional inside the package, and it's slower (2–8 days). Tell users this when they create the label.

## 6. Build phases

1. **Clickable prototype (this repo):** PWA, fake data, a demo panel to fast-forward time and simulate the other trader.
2. **MVP:** Supabase auth and database, ISBN lookup, Stripe test mode, Shippo test labels, web push. US only.
3. **Launch:** strikes and disputes admin view, insurance, ratings, two-way match feed.
4. **Later:** 2-for-1 trades, local meetup trades (no shipping, no label fee), book clubs and shared shelves, "trade circles" (A→B→C→A).

## 7. Decisions

- **Fee:** $1 from each person, per trade.
- **Guarantee:** flat $8 hold per person, released at the first carrier scan.
- **Region:** US only (50 states + DC). Addresses outside the US are rejected at signup.

### Still open

- Allow uneven trades (hardcover for paperback), or only match on condition?
