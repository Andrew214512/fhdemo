# Taking Wormy live

The app, database, payments, sign-in and server code are built and tested. What's left is mostly accounts that have to be in **your** name, plus a few settings only you can switch on.

---

## Part 1: What I need from you

### Accounts to open (you own these)

| # | What | Why | Cost |
|---|---|---|---|
| 1 | **A domain name** (for example `wormybooks.com`) | Where the app lives. Apple, Google and Stripe all ask for it | About $10–20 a year |
| 2 | **Supabase** account and one project | Database, sign-in, photo storage, server code | Free to start. Pro ($25/month) recommended at launch for daily backups |
| 3 | **Stripe** account | Fee-balance payments, with Apple Pay and Google Pay built in | 2.9% + 30¢ per payment. Needs your legal name or business, tax ID, and a bank account |
| 4 | **Google Cloud** project | "Continue with Google" sign-in, plus a free Google Books key for book lookups | Free |
| 5 | **Apple Developer Program** | "Continue with Apple" sign-in | $99 a year |
| 6 | **Netlify** or **Cloudflare Pages** | Hosts the app from your GitHub repo | Free |
| 7 | **Resend** (or Postmark) | Sends sign-in emails reliably. Supabase's built-in email is capped at a handful an hour | Free tier to start |
| 8 | *Optional:* **EasyPost** | Shows each carrier scan in the app (in transit, out for delivery, delivered, problems, expected date) and marks books delivered automatically. Without it, readers still get a "Track on USPS" link and tap "It arrived" | Small per-package fee |
| 9 | A **support email** (like `help@yourdomain`) | Required on the Apple and Google sign-in screens and in the legal pages | Usually free with your email host |
| 10 | *Optional:* **Anthropic** API account (console.anthropic.com) | Writes the short "About this book" summary on each book page. Without it, book pages simply skip the summary | Under a cent per book, once (each summary is saved and reused) |

### Business and legal (before real money moves)

- **Form a business** (an LLC is common) and get an EIN. This keeps Stripe payouts and liability separate from you.
- **Have a lawyer finish the Terms and Privacy Policy.** Drafts written for Wormy are in `legal/`, with blanks marked like `[this]`.
- **Ask the lawyer two specific questions:**
  1. Whether your state requires sales tax on a $1 service fee.
  2. Whether a prepaid fee balance that can only pay Wormy's own fees needs any money-transmitter license. Usually it doesn't, but confirm.
  3. Whether the AI-written book summaries need anything more. They're short (2 or 3 sentences), written fresh from only the title and author, never quote the book or reuse the publisher's description, avoid spoilers, and are labeled as AI-written. That's the usual way to stay clear of copyright, but it's worth a quick look, and the Terms may want a line about it.
- **Run a trademark search on "Wormy"** for an app in this category before you print anything.

### Decisions only you can make

1. **Top-up amounts.** Currently $5, $10 and $20.
2. **Refunds of unused fee balance.** Yes or no? The Terms have a blank for it.
3. **Who answers support.** Your own reader account becomes the admin account that sees problem reports (step 8 below).
4. **"Buying points."** I read this as topping up the fee balance. Book credits still can't be bought, as your spec said. If you want people to buy credits, that's a small code change but a big economics decision.

### Keeping keys safe

Some keys are **public** and some are **secret**:

- **Public** (safe in GitHub and in the app): the Supabase *Project URL* and *anon key*. They go in `config.js`.
- **Secret** (never in GitHub, chat or email): the Stripe *secret key*, the Stripe *webhook signing secret*, the Supabase *service_role key*, the Google Books key, and EasyPost keys. You paste these straight into Supabase's **Edge Function Secrets** page, so nobody else ever handles them.

---

## Part 2: Setup steps

These are written so you can follow along, or hand them to a developer. Do everything with Stripe in **test mode** first, try the whole loop, then switch to live keys.

### 1. Supabase project

1. Create a project. Pick a **US** region and save the database password somewhere safe.
2. **Database → Extensions:** turn on **pg_cron**. It runs Wormy's hourly timers. (Search uses **pg_trgm**; the migrations switch that on themselves.)
3. Load the database. Either:
   - with the Supabase CLI: `supabase link --project-ref <your-ref>` then `supabase db push`, or
   - in **SQL Editor**: paste and run each file in `supabase/migrations/`, in name order.
4. **Project Settings → API:** copy the **Project URL** and **anon public** key into `config.js`.
   - If your project shows the newer "publishable" and "secret" keys instead, use the publishable key in `config.js`. Then check that edge functions still receive `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (Supabase was mid-way through changing key formats).
5. Deploy the server functions: `supabase functions deploy`. The webhook settings in `supabase/config.toml` come along automatically.

### 2. Sign-in (Supabase → Authentication)

1. **URL Configuration:** set *Site URL* to `https://yourdomain`, and add it under *Redirect URLs*.
2. **Emails → SMTP Settings:** turn on custom SMTP with your Resend details.
3. **Emails → Templates → Magic Link:** make sure the email includes `{{ .Token }}` (the 6-digit code) as well as the link. People who open the email on another device can then type the code.
4. **Providers → Google:** in Google Cloud, create an OAuth client (type: Web) with redirect URI `https://<your-ref>.supabase.co/auth/v1/callback`. Paste the client ID and secret into Supabase. Google's consent screen asks for your logo, support email, and links to `legal/privacy.html` and `legal/terms.html`.
5. **Providers → Apple:** in your Apple Developer account, create a *Services ID* and a *Sign in with Apple* key. Use the same callback URL. Paste the Services ID, Team ID, Key ID and key into Supabase.
   - **Apple's secret expires every 6 months.** Put a calendar reminder to make a new one, or "Continue with Apple" stops working.
6. Recommended before public launch: **Attack Protection → CAPTCHA** (Cloudflare Turnstile is free). It stops bots from mass-creating accounts. The app would need a small addition to show the challenge.

### 3. Stripe

1. **Developers → API keys:** copy the *Secret key*.
2. **Developers → Webhooks → Add endpoint:**
   - URL: `https://<your-ref>.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`
   - Copy the endpoint's *Signing secret*.
3. **Settings → Payment methods:** turn on Apple Pay, Google Pay and Link.
4. **Settings → Public details:** set the statement descriptor (what shows on card statements) to something like `WORMY BOOKS`.

### 4. Server secrets (Supabase → Edge Functions → Secrets)

| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | From Stripe step 1 |
| `STRIPE_WEBHOOK_SECRET` | From Stripe step 2 |
| `APP_URL` | `https://yourdomain/` |
| `APP_ORIGINS` | `https://yourdomain` |
| `GOOGLE_BOOKS_API_KEY` | Google Cloud → APIs → enable *Books API* → create an API key and restrict it to the Books API |
| `EASYPOST_API_KEY` | Optional. From EasyPost |
| `EASYPOST_WEBHOOK_SECRET` | Optional. Set when you add the EasyPost webhook pointing at `https://<your-ref>.supabase.co/functions/v1/tracking-webhook` |
| `ANTHROPIC_API_KEY` | Optional. From console.anthropic.com → API keys. Turns on book summaries. Set a monthly spend limit there too |

Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to functions automatically.

### 5. Hosting

1. In Netlify or Cloudflare Pages, connect the GitHub repo. There's no build step: the publish directory is the repo root.
2. Add your domain. HTTPS is automatic.
3. The `_headers` file applies Wormy's security headers automatically. If your Supabase project uses a custom domain, add it to `connect-src` in `_headers` and in `index.html`.

### 6. Book lookups

Google refuses lookups made without a key because the shared free quota runs out, so `GOOGLE_BOOKS_API_KEY` is required (step 4). The default free quota is 1,000 lookups a day. Request more in Google Cloud if you need it.

### 7. Try the whole loop (test mode)

Use two accounts on two phones:

1. Sign in, list 3 books, top up $5 with Stripe's test card `4242 4242 4242 4242`. The welcome credit should arrive.
2. Request a book on the other phone. Accept it, add tracking, then tap "It arrived" on the first phone.

Check **Stripe → Webhooks** shows successful deliveries, and **Supabase → Logs → Edge Functions** shows no errors.

### 8. Make yourself support

In SQL Editor:

```sql
update public.profiles set is_admin = true where handle = 'yourhandle';
```

Your Profile tab then shows **Wormy support** with any problem reports to rule on.

### 9. Go live

1. Swap in Stripe's **live** secret key, and add a live-mode webhook (it has its own signing secret).
2. On iPhone, readers install Wormy with **Share → Add to Home Screen**. On Android, Chrome offers to install it.

---

## Running the tests

The tests run the real migrations and server functions against a local Postgres, then drive the real app in a browser.

```
cd tests
npm install
npm run test:all
```

They need PostgreSQL (set `PG_ADMIN_URL`, default `postgres://postgres:postgres@localhost:5432/postgres`), Deno (`DENO_BIN`), and Playwright with Chromium.

| Suite | What it proves |
|---|---|
| `db.test.mjs` (33) | No direct table access. Credits can't be minted, double-spent or duplicated, even with simultaneous requests. Address privacy, timers, disputes, strikes, refunds, account deletion, photo-path rules, condition ratings (only the recipient, once, after it arrives), summaries server-only, search (typos, ISBN-10, editions grouped, availability, wildcards), similar books, any-edition wishlists, tracking updates |
| `functions.test.mjs` (13) | Unsigned or tampered Stripe and EasyPost events are rejected. Carrier scans are saved. Replays count once. Rate limits work. Internal errors don't leak. Book summaries: only the title and author are sent to Claude, each book is summarized once, unknown books show nothing, outages retry later (against a stand-in for the Claude API, so no key is needed) |
| `e2e.test.mjs` (55) | Sign-in (Google redirect with PKCE, email code), profile setup with photo, scanning, Stripe top-up via webhook, welcome credit, search (typos, not on a shelf yet, not on Wormy at all), a book page with a summary arriving fresh, a full exchange both ways with a condition rating, tracking rules, the support queue, sign out, account deletion |

## Not built yet

- **Push notifications and emails about exchanges.** Today, alerts appear inside the app, which checks for news every 30 seconds while open. Push needs a small addition (stored subscriptions, plus a function that sends them).
- **Shipping labels inside the app.** Senders buy postage themselves for now.
- **App Store and Play Store versions.** Wormy is an installable web app. A store version can wrap the same code later.
- **Fuller admin tools.** Refunds happen in the Stripe dashboard. Disputes are handled in the app's support queue.
