# Hosted casting for PrismTV on GitHub Pages

The Worker exchanges pairing, media URLs and playback commands; receivers fetch video directly from the provider. It does not proxy video, discover Chromecast devices, or bypass provider restrictions. This backend enables the phone/tablet/browser-TV pairing option without `--lan`. Google Cast and AirPlay remain independent browser features.

## Deploy once

You need a Cloudflare account and Node.js. From this directory:

```sh
npx wrangler@latest login
npx wrangler@latest deploy
```

Login opens Cloudflare in your browser. Deployment creates a Worker and a SQLite-backed Durable Object namespace. Check your account's usage limits; continuous device polling makes requests while connected. The configuration allows the `https://plvtv.github.io` origin and localhost:8080. Edit `ALLOWED_ORIGINS` for another host. Do not put account tokens or secrets in the website.

Copy the HTTPS Worker URL printed by deployment (typically `https://prismtv-cast.YOUR-SUBDOMAIN.workers.dev`) into `../data/cast-config.json`:

```json
{"endpoint":"https://prismtv-cast.YOUR-SUBDOMAIN.workers.dev"}
```

Run `../publish-to-github.command`, wait for GitHub Pages deployment, and hard-refresh both devices. The workflow now includes `receive.html`.

Open a video → Cast → Connect a phone, tablet or browser TV → scan/open its link on the destination → Connect this device → select its name on the sender. The receiver link stays under `/prismtv/receive.html`. Keep both pages open; use Stop/Disconnect when finished. A receiving browser may require a tap to allow sound. HTTPS receivers require media that their browsers can fetch and play; HTTP-only sources and CORS-blocked streams may fail. There is no local Python relay on GitHub Pages.

Keys use separate sender and receiver secrets, expire after an hour of inactivity, and grant control only to the sender. Treat the receiving link as private. Restarting/deploying the Worker need not erase existing rooms; expiry alarms delete inactive room storage. At most eight active devices can join each room. New-link creation is limited to ten per minute per public IP (shared networks share that limit). Origin restrictions are browser protection, not user authentication.

## Verify

Run `node --test tests/test_cloud_cast.mjs` from the app root for the protocol tests. These use an in-memory Durable Object adapter; verify a real deployed service with two browser devices before relying on it.

Deployment reference: https://developers.cloudflare.com/durable-objects/get-started/
