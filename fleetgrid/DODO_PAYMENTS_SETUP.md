# Dodo Payments setup for FleetGrid

FleetGrid uses Dodo's hosted Checkout Sessions API. Card and bank credentials stay on Dodo's hosted checkout; FleetGrid stores the shipment amount, provider session ID, and verified payment result.

## Dodo dashboard prerequisites

1. Create a **one-time, pay-what-you-want** product in the Dodo account. The session amount override is supported only for a pay-what-you-want product.
2. Note that product's ID and its configured base currency (for example, INR).
3. Create a webhook endpoint pointing to:

   `https://fleetgrid-app.onrender.com/payments/dodo/webhook`

4. Subscribe to `payment.succeeded`, `payment.failed`, and `payment.cancelled`.
5. Copy the webhook signing secret. Do not put it in Git or a chat message.

## Render environment variables

Set these on the **FleetGrid production server service**, not the static frontend:

| Variable | Value |
|---|---|
| `DODO_PAYMENTS_API_KEY` | Dodo **test-mode** API key to start |
| `DODO_PRODUCT_ID` | ID of the pay-what-you-want product |
| `DODO_PRODUCT_CURRENCY` | Exact three-letter product currency, e.g. `INR` |
| `DODO_PAYMENTS_WEBHOOK_KEY` | Signing secret for the webhook endpoint above |
| `DODO_ENVIRONMENT` | `test_mode` |
| `DODO_PAYMENTS_WEBHOOK_ENABLED` | `false` until the webhook test succeeds |
| `DODO_LIVE_PAYMENTS_ENABLED` | `false` |
| `APP_BASE_URL` | `https://fleetgrid-app.onrender.com` |

Never expose the API key or webhook signing key in frontend variables (such as `VITE_*`).

## Safe activation sequence

1. Configure the Dodo dashboard product and webhook.
2. Add the test-mode values above to the Render server environment.
3. Deploy the payment integration to a safe test target only after the production database transition and deployment plan are approved. Do not connect the new Node app to the legacy database before migration.
4. Send a Dodo test event and verify the signature is accepted. Complete a test checkout using a confirmed test shipment.
5. Confirm that the webhook updates the exact FleetGrid payment to `PAID`, with matching currency and amount (excluding separately reported tax), and that duplicate webhook deliveries do not create duplicate settlements.
6. Only then set `DODO_PAYMENTS_WEBHOOK_ENABLED=true` and test another checkout. The readiness endpoint reports configuration presence, not proof that Dodo has delivered a successful test event.

## Live payments

Live mode is intentionally blocked unless both `DODO_ENVIRONMENT=live_mode` and `DODO_LIVE_PAYMENTS_ENABLED=true` are set. Do not enable either live setting until the owner explicitly approves live charges and the test flow has been verified.

## Payment rules enforced by FleetGrid

- Only the shipment's server-stored agreed price and currency are used; client-supplied totals are ignored.
- The driver must accept the shipment before checkout is available.
- Amounts are converted to the currency's smallest unit (paise for INR, cents for USD).
- The Dodo product currency must match the shipment currency.
- The webhook signature, checkout session, FleetGrid metadata, provider status, currency, and paid amount are checked before a payment is marked `PAID`.
- Browser redirects never mark payments as paid.
- Payment history and FleetGrid records are not substitutes for Dodo's official tax invoice.
