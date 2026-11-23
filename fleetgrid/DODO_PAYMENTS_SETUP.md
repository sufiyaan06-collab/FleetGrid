# Dodo Payments — disabled for FleetGrid shipment settlements

> **Do not follow the old setup instructions.** FleetGrid does not use Dodo to collect shipment payments, transfer funds to independent carriers, or provide escrow. That marketplace settlement model is not supported by the Dodo account flow previously evaluated for this project.

On the integration branch, the Node Dodo checkout/status/confirmation/webhook endpoints and the auxiliary Python Dodo payment routes return HTTP 410; the dormant Python payment service fails closed. These candidate changes are not live yet: the production services still track `main` and have not been redeployed. Do not add Dodo API keys, product IDs, webhook secrets, or live-payment flags to Render for this workflow.

## Current project demonstration

The Payments Hub uses the **FleetGrid Demo Simulator**:

1. A signed-in shipper selects one of their own driver-confirmed shipments.
2. The server creates a pending payment using the agreed amount stored on that shipment.
3. The user explicitly selects **Simulate successful demo payment**.
4. The server validates ownership and payment state, then records an idempotent simulated settlement and audit event.

This is a project demonstration only. It does not contact a bank, card network, wallet, or payment provider. It does not move money, issue a tax invoice, or prove that a real shipment has been paid.

## If real payments are ever required

Treat that as a separate, future architecture and compliance decision. First establish who is the seller/merchant, who receives funds, whether a marketplace/split-settlement product is required, and whether the provider has approved that exact business model. Do not enable a provider based only on the availability of a hosted checkout API.
