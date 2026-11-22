# Legacy → Node Field-Level Compatibility Audit

**Date:** 2026-11-23  
**Branch:** `upgrade/real-app-auth-2026-11-18`  
**Scope:** Static comparison of the checked-in SQLAlchemy models and Node TypeScript domain interfaces. This is a design/preflight artifact only. It does not read or write production rows.

## Executive result

**Importer implementation remains blocked.** The legacy ORM and Node interfaces are not structurally compatible. Several legacy columns are nullable where Node interfaces require values; the Node interfaces also require fields that do not exist in the legacy model. The target JSONB table does not enforce relational foreign keys or runtime domain validation by itself.

Do not cast legacy rows to Node interfaces and insert them. That would make invalid records appear valid to TypeScript while preserving missing/null values at runtime.

## Confirmed field gaps

| Legacy source | Legacy model facts | Node target requirement | Safe disposition |
|---|---|---|---|
| organizations | `status` has a Python default but is not declared non-null; no `created_at` column | `status` and `createdAt` required | Preserve null/absence in migration envelope or quarantine until target model supports it. Do not synthesize historical creation time. |
| users | `organization_id` nullable; `email` nullable; `contact` nullable | Node `User.organizationId` and `contact` required; auth email is handled in a separate private collection | Null organization/contact requires an explicit target policy. Never expose legacy email through public User records. Do not create auth accounts/password hashes from legacy email. |
| drivers | no driver name, phone, or created timestamp; links to User and Organization are non-null | Node requires `name`, `phone`, `createdAt` | A name may be derived from linked User only after approval. Phone and creation time remain absent; revise target type or quarantine. |
| trucks | `lat`, `lng`, `origin`, `destination`, `departure_at`, `driver_id`, telemetry nullable | Node requires numeric `lat/lng`, string `origin/destination`; other optional/null fields differ | Target must represent unknown coordinates/routes as null/unknown. Never substitute 0,0, blank routes, or fabricated GPS. Validate optional driver link separately; legacy model does not declare it as an FK. |
| capacity_offers | `route` is a required free-form string; `price_rule` is a free-form string with default text; no `updated_at` or numeric `price_per_t` | Node requires parsed `origin`, `destination`, `pricePerT`, `updatedAt` | Parse route only with a strict documented grammar. Do not derive numeric prices from prose unless a reviewed parser and currency policy are approved. No timestamp synthesis. |
| shipments | no `reference`, `cargo_name`, `capacity_offer_id`, or `updated_at`; `price` defaults to 0 | Node requires those fields, plus price/currency | Do not invent references, cargo descriptions, offer links, or update times. A zero price must remain non-payable. Extend target schema or quarantine. |
| shipment_events | `shipment_id` required; payload is text JSON; event has no incident/truck columns | Node permits nullable shipment and incident/truck links and requires object payload, hash, actor, timestamp, proof status | Strict JSON parse and object-shape validation; preserve malformed raw text in quarantine. Do not invent incident/truck links or proof status. |
| incidents | `transcript` and `structured_summary` nullable; no source, affected shipment list, recovery-plan ID, or updated timestamp | Node requires non-null transcript/summary/source/list and updated timestamp | Preserve nullable values. Do not infer source or affected shipments from unrelated tables; quarantine or revise target model. |
| recovery_plans | serialized JSON text fields; no `updated_at`; `approved_by` nullable | Node requires arrays/options and updated timestamp | Strict parse and validate each element/reference. Keep malformed raw text in quarantine; do not generate update time. |
| payments | no `updated_at`; provider reference nullable | Node requires updated timestamp; provider details optional | No synthetic timestamp. Reconcile non-empty payments with provider records before enabling payment actions. |
| notifications | status allows legacy `UNREAD`, `READ`, `SENT` | Node supports only `PENDING`, `SENT` | Do not collapse READ/UNREAD into delivery states. Product decision required; quarantine unresolved statuses. |

## Nullability and relationship findings

- Legacy `users.organization_id` is nullable, while Node `User.organizationId` is a required string.
- Legacy `users.contact` is nullable, while Node `User.contact` is required.
- Legacy truck coordinates and route endpoints are nullable, while Node requires numeric coordinates and string endpoints.
- Legacy incident transcript and structured summary are nullable, while Node requires strings.
- Legacy organization status is not declared `nullable=False`; a Python default does not make the database column NOT NULL.
- Legacy `trucks.driver_id` and `drivers.assigned_truck_id` are not declared as SQLAlchemy foreign keys. Treat them as untrusted references and validate manually.
- The JSONB store primary key is `(collection, id)`; it does not enforce domain-level foreign keys between records. The importer must validate every relationship before any staging write.

## Required implementation contract

1. Read source through a dedicated read-only PostgreSQL connection and a consistent read-only transaction.
2. Inspect actual deployed column metadata and row values at migration time; ORM defaults do not prove that historical rows contain defaults.
3. Preserve every source primary key and original source value in a private migration audit/quarantine record.
4. Build explicit per-table transforms; reject unknown enum values and malformed JSON instead of coercing them.
5. Produce a dry-run report with row-level outcome codes but redact emails, phone numbers, message text, credentials, and payment-provider references from console output.
6. Check all declared foreign keys and manually validate the two non-FK driver/truck references before import.
7. Make the dry-run path incapable of DDL or DML. A dry run must not create the target table, indexes, ledger rows, or records.
8. Apply only to a separately named, explicitly allowlisted staging database after backup restore and reconciliation tests. Production import remains prohibited pending explicit approval.

## Required decisions before coding an importer

- Whether Node domain types should accept nullable/unknown legacy fields or legacy-only archived records should be stored outside live domain collections.
- Whether a nullable legacy user organization is supported and what permissions such a user receives.
- Whether driver display name can be joined from the linked User record; no phone/created timestamp source exists in the model.
- The exact route grammar and price-rule grammar, including currency and units.
- How shipment reference/cargo name/capacity offer ID should be represented when absent.
- The policy for nullable truck GPS/routes and nullable incident text.
- Notification READ/UNREAD semantics and proof-status mapping.
- The least-privilege treatment of AUDITOR and ambiguous OPERATOR roles.

## Verification references

- Legacy SQLAlchemy models: `backend/app/models/user.py`, `truck.py`, `shipment.py`, `incident.py`, `payment.py`, `notification.py`.
- Node interfaces: `fleetgrid/server/src/types.ts`.
- Target store: `fleetgrid/server/src/store/postgresStore.ts`.
- Earlier inventory: `LEGACY_DATABASE_INVENTORY_2026-11-23.md`.
- Earlier mapping proposal: `LEGACY_TO_NODE_MAPPING_SPEC.md`.

**Release gate: NO-GO for production migration or cutover.** This audit intentionally does not authorize schema mutation, production writes, PR merge, or deployment.
