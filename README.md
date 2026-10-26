# Shelfswap

A prototype of a book-trading app: list the books you've finished, keep a wishlist, and trade one book for another by mail.

- **[PLAN.md](PLAN.md)**: the product plan (trade rules, edge cases, payments, shipping, services to use).
- **The prototype**: `index.html`, `app.css`, `app.js`. Plain HTML, CSS and JavaScript with no build step. All data is fake and saved in your browser.

## Run it

```
python3 -m http.server 8000
```

Then open http://localhost:8000. On a phone on the same Wi-Fi, use your computer's IP address instead of `localhost`, and choose "Add to Home Screen" to install it as an app.

## Try it

Tap **Demo** (top right) to play the other traders and move the clock. Things to try:

1. Discover → tap a wishlist book → **Propose a trade** → Demo → **They accept my offers**.
2. Trades → Theo's offer → **Accept** → **Show shipping label** → USPS scans my package.
3. Demo → **They ship** → **Packages arrive** → open the trade → **Looks right** → rate.
4. Accept a trade, don't ship, then Demo → **+3 days** to see a missed ship window.
