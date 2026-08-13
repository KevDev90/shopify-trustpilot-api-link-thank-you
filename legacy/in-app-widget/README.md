# Legacy: in-app review collector widget (deprecated)

This folder contains the old static HTML demo for Trustpilot’s **Verified In-App Review Collector** widget.

**Do not deploy this for the Shopify Thank You invitation-link flow.**

The supported implementation is the root `index.js` Worker, which calls:

https://developers.trustpilot.com/invitation-api/#generate-service-review-invitation-link

and returns JSON `{ url, id }` — not this HTML page.
