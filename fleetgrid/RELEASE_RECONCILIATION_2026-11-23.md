# FleetGrid release reconciliation — 2026-11-23

## Scope
This is a working release branch only. It is not connected to Render and is not a staging deployment. Production `main`, Render services, and the production database are not modified by this record.

## Branch comparison
- Production base: `main` at `64dbf635d6739a2b9286223d4d8a5ff362b544ac`.
- Candidate implementation: `upgrade/real-app-auth-2026-11-18` at `3cde39e2f0a327c65f51d8b60614b449ec717eb9`.
- Dashboard branch: `release/professional-dashboard-2026-11-23` at `12849079921a8cde761e8586db8b063c57adbc00`.
- The upgrade branch is 302 commits ahead of main. The dashboard branch is 181 commits ahead of main.
- The dashboard branch is divergent from the upgrade branch (one unique dashboard-branch commit and 122 commits not present on that branch at comparison time).

## Dashboard reconciliation decision
The dashboard branch's unique commit is titled "Replace demo reroute modal with live incident focus and safe refresh". Its intent is sound: remove fabricated AI reroute claims and demo-reset controls, focus the map on a real active incident, and refresh authoritative server state. The newer upgrade branch already contains the safe incident-focus and refresh behavior, and additionally derives the operator identity from the authenticated session. Therefore, do not merge the older dashboard branch wholesale or overwrite the newer Control Tower implementation.

## Payment scope decision
FleetGrid is a final-year engineering project. Do not activate Dodo Payments for shipper-to-carrier shipment collections. Implement a clearly labelled, test-only payment demonstration with server-side state transitions and no real money movement. Browser redirects or client-side claims must never mark a payment as paid. Preserve provider integration code for review, but keep it unreachable/disabled for shipment settlement.

## Database safety
The Node application supports PostgreSQL JSONB collections through `fleetgrid_records`, while the existing production PostgreSQL contains legacy relational tables used by the Python backend. Do not point the Node application at production storage or run migration writes until backup/restore is verified, the read-only source preview is reviewed, nullable-field handling is complete, and rollback is rehearsed. Preserve the legacy tables and all existing records.

## Verification snapshot
GitHub Actions run `45071345190` for candidate commit `3cde39e2f0a327c65f51d8b60614b449ec717eb9` completed successfully: frontend/backend build, backend end-to-end tests, and frontend browser integration tests all passed. These checks do not establish production email delivery, live provider settlement, production database compatibility, or production deployment health.

## Release gates still open
1. Implement and test the test-only payment workflow.
2. Confirm all production authentication and role/ownership rules through tests.
3. Complete nullable legacy field compatibility in domain logic and UI.
4. Run the read-only legacy database preview against a controlled read-only source.
5. Verify backup and restore capability before any target writes.
6. Verify persistent storage behavior and deployment health without switching production.
7. Review final changes and explicit production cutover approval before merging to `main`.
