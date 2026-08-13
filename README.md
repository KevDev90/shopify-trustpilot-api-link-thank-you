# Shopify Trustpilot API Link (Thank You page)

Generate a unique Trustpilot **service review invitation link** after checkout, and show it as a button on the Shopify **Thank You** page.

This is **not** the Trustpilot in-app review collector widget. It uses Trustpilot’s Invitation API:

- Docs: [Generate service review invitation link](https://developers.trustpilot.com/invitation-api/#generate-service-review-invitation-link)
- Endpoint: `POST https://invitations-api.trustpilot.com/v1/private/business-units/{businessUnitId}/invitation-links`

## Architecture

```text
Shopify Thank You Extension
  -> POST Cloudflare Worker (JSON: email, name, referenceId)
     -> OAuth client_credentials (token cached in KV)
     -> Trustpilot Invitation Links API
  <- { url, id }
  -> native Shopify button opens the Trustpilot evaluate URL
```

## Repo layout

| Path | Purpose |
| --- | --- |
| `index.js` + `wrangler.toml` | Cloudflare Worker middleware (deploy this) |
| `shopify-app/` | Shopify Checkout UI Extension for Thank You page |
| `shopify-app/README.md` | Detailed Shopify + Worker setup steps |
| `legacy/in-app-widget/` | **Deprecated** old HTML widget UI — do not deploy |

## Quick start (Worker)

1. Update `TRUSTPILOT_BUSINESS_UNIT_ID` in `wrangler.toml` to your BUID.
2. Set secrets:

```bash
wrangler secret put TRUSTPILOT_API_KEY
wrangler secret put TRUSTPILOT_API_SECRET
wrangler secret put TRUSTPILOT_BUSINESS_USER_ID
wrangler secret put WORKER_API_KEY
# optional:
wrangler secret put TRUSTPILOT_REDIRECT_URI
```

3. Deploy from **repo root** (folder containing this `index.js`):

```bash
wrangler deploy
```

4. Test with **POST** (not GET):

```bash
curl -s -X POST "https://YOUR-WORKER.workers.dev" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_WORKER_API_KEY" \
  -d '{"email":"test@example.com","name":"Test User","referenceId":"1001"}'
```

Expected JSON (not HTML):

```json
{"url":"https://www.trustpilot.com/evaluate-link/...","id":"..."}
```

## Shopify extension

See [`shopify-app/README.md`](shopify-app/README.md) for:

- Installing / deploying the Thank You block
- Protected customer data (required to read buyer email)
- Pointing the block at your Worker URL + API key

## Important

- Deploy **`index.js`** with Wrangler. Do **not** deploy `legacy/in-app-widget/index.html` as the Worker.
- If Postman GET returns an HTML email form, or POST returns 405, you are hitting the wrong deployment — redeploy this Worker and use the URL Wrangler prints.
