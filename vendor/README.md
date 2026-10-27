# Bundled libraries

Served from Worm's own domain (not a CDN), so the page's security policy can allow scripts from Worm only.

| File | Library | Version | License |
|---|---|---|---|
| `supabase.js` | [@supabase/supabase-js](https://github.com/supabase/supabase-js) UMD build | 2.45.4 | MIT |
| `zxing.min.js` | [@zxing/library](https://github.com/zxing-js/library) UMD build, used for barcode scanning on browsers without a built-in reader (Safari on iPhone) | 0.21.3 | MIT |

Loaded only when needed: `supabase.js` in live mode, `zxing.min.js` the first time the camera opens on such a browser.
