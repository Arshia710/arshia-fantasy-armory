Arshia Fantasy Armory Website v9
================================
Local Three.js (no CDN) — works better on Opera GX / offline.

Run:
  python -m http.server 8080

Cloudflare Pages:
  1. dash.cloudflare.com → Workers & Pages → Create → Pages
  2. Upload this folder (or connect Git)
  3. Build command: (empty)
  4. Output directory: /
  5. Deploy

Structure:
  index.html, script.js, viewer.js, style.css
  data/database.json
  vendor/three/   (local Three.js)
  models/*.gltf
  thumbs/*.png    (optional)
