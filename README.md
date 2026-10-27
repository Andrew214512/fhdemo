# Wormy

A book-exchange app. Send a book someone requests and earn a credit. Spend credits on any available book from any reader.

- **[SETUP.md](SETUP.md)**: what's needed from you to go live, and the step-by-step setup. **Start here.**
- **[PLAN.md](PLAN.md)**: the product plan: credit model, exchange rules, fees, security model, metrics.

## What's in here

| Path | What it is |
|---|---|
| `index.html`, `app.css`, `app.js` | The app. Plain HTML, CSS and JavaScript, with no build step. Installs to a phone's home screen |
| `config.js` | Empty = clickable demo with fake readers. Your Supabase URL and public key = the real app |
| `supabase/migrations/` | The database: tables, security rules, and every action readers can take |
| `supabase/functions/` | Server code: Stripe checkout and webhook, book lookup, tracking, account deletion |
| `vendor/` | Bundled libraries (Supabase client, ZXing barcode reader) |
| `legal/` | Draft Terms and Privacy Policy, for a lawyer to finish |
| `tests/` | Database, server-function and full-browser tests |
| `_headers` | Security headers for Netlify or Cloudflare Pages |

## Try the demo

```
python3 -m http.server 8000
```

Open http://localhost:8000 and tap **Demo** (top right) to play the other readers and move the clock. **Start as a new reader** shows sign-in, profile setup and the welcome credit.
