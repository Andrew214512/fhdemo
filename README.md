# Shelf Swap

A prototype of a book-exchange app. Send a book someone requests and earn a credit. Spend credits on any available book from any reader.

- **[PLAN.md](PLAN.md)**: the product plan (credit model, data model, exchange rules, fees, services, metrics).
- **The prototype**: `index.html`, `app.css`, `app.js`. Plain HTML, CSS and JavaScript with no build step. All data is fake and saved in your browser.

## Run it

```
python3 -m http.server 8000
```

Then open http://localhost:8000. On a phone on the same Wi-Fi, use your computer's IP address instead of `localhost`, and choose "Add to Home Screen" to install it. On Android Chrome, the Scan tab uses the real camera and looks books up on Open Library.

## Try it

Tap **Demo** (top right) to play the other readers and move the clock.

1. Discover → Pachinko → **Request this book** (1 credit is reserved) → Demo → **Accept my requests**, **Ship books to me**, **Packages arrive** → Exchanges → confirm it arrived.
2. Exchanges → To send → Theo's request → **Accept** → **add tracking** → Demo → **Packages arrive** to earn a credit.
3. Accept a request and don't ship, then Demo → **+3 days** to see a missed ship window.
4. Demo → **Start as a new reader** to see onboarding, the Scan tab and the welcome credit.
