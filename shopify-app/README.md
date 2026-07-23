# Shopify Review Collector (Invitation Link Architecture)

Lightweight Shopify Checkout UI Extension for the Thank You page, paired with a Cloudflare Worker middleware that calls Trustpilot's Invitation API.

## Architecture

```text
Shopify Thank You Extension
  -> fetch(Cloudflare Worker)
     -> OAuth client_credentials (cached in KV)
     -> POST /invitation-links
  <- unique 1:1 review URL
  -> native button opens URL in new tab
```

The Trustpilot widget is **not** embedded in Shopify checkout (sandbox restriction). Instead, each customer gets a unique invitation link.

## 1) Deploy Cloudflare Worker

From repo root:

```bash
wrangler secret put TRUSTPILOT_API_KEY
wrangler secret put TRUSTPILOT_API_SECRET
wrangler secret put TRUSTPILOT_BUSINESS_USER_ID
wrangler secret put WORKER_API_KEY
wrangler secret put TRUSTPILOT_REDIRECT_URI
wrangler deploy
```

Optional vars in `wrangler.toml`:
- `TRUSTPILOT_BUSINESS_UNIT_ID`
- `TRUSTPILOT_LOCALE`

Test:

```bash
curl -s -X POST "https://trustpilot-invitation-middleware.YOUR_SUBDOMAIN.workers.dev" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_WORKER_API_KEY" \
  -d '{"email":"test@example.com","firstName":"Test","lastName":"User","referenceId":"1001"}'
```

Expected:

```json
{"url":"https://www.trustpilot.com/evaluate-link/...","id":"..."}
```

## 2) Deploy Shopify extension only

```bash
cd shopify-app
npm install
shopify app config link
shopify app deploy
```

In Shopify Admin:
1. Settings -> Checkout -> Customize
2. Thank you page
3. Add block: **review-collector-thank-you**
4. Configure:
   - Worker URL
   - Worker API key (if enabled)
   - Heading / description / button label

## Notes

- `redirectUri` is supported by Trustpilot Invitation API (configured via Worker secret `TRUSTPILOT_REDIRECT_URI`).
- OAuth access tokens are cached in KV (`TOKEN_CACHE`) and refreshed automatically.
- Client credentials grant requires `TRUSTPILOT_BUSINESS_USER_ID` for invitation endpoints.

## Protected customer data (required for email)

The Thank You block reads the buyer email via `shopify.buyerIdentity.email`. Shopify only exposes that when the app has protected customer data access.

For dev stores (no app review needed):

1. Partner Dashboard -> Apps -> **trustpilot-link-generator**
2. **API access requests** -> **Protected customer data access** -> **Request access**
3. Enable **Protected customer data**
4. Enable the **Email** field (and **Name** if you want first/last name on invitations)
5. Save, then reinstall the app on the dev store (or run `shopify app dev` again)

If email is still missing after that, confirm the test checkout actually collected an email address.
