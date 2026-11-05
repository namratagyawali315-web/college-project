# QuickBite Canteen

QuickBite is a college canteen table-ordering project built with Node.js, Express, MySQL/MariaDB, Socket.IO, and vanilla HTML/CSS/JavaScript. Customers scan a table QR code, browse the menu, place an order, complete a simulated eSewa payment, and track the order live. Admins manage live orders, the menu, tables and QR codes, reports, and settings.

Payments are a visual demo only. No real payment provider is connected and no money is charged.

## Project status

| Task | Status |
| --- | --- |
| 1. Backend application | Complete |
| 2. MySQL database and seed data | Complete |
| 3. Customer and admin frontend | Complete |
| 4. Remaining files and final end-to-end verification | In progress |

Task 4 is in progress. Security hardening and the hardened-flow verification are complete; environment/setup and Cloudflare tunnel documentation remain.

## Completed tasks

### 1. Backend application

- Express server with configuration and a MySQL connection layer
- Admin authentication using a JWT cookie
- Public APIs for the menu, tables, order creation, demo payment, and order tracking
- Admin APIs for the dashboard, orders, menu items, categories, tables/QR codes, reports, and settings
- Socket.IO events for new orders and live customer status updates
- Image upload handling for menu items
- Request validation, security middleware, rate limiting, and centralized error handling

### 2. MySQL database and seed data

- Database schema, seed SQL, and setup scripts under `database/`
- Seeded 5 categories, 20 menu items, 10 dining tables, and 1 admin account
- Idempotent setup that can be rerun without duplicating seed data
- Verified backend startup, admin login, QR generation, order creation, demo payment, tracking, and dashboard queries
- Database integrity checks pass (`mysqlcheck` reports all tables OK)

### 3. Customer and admin frontend

- Customer menu, cart, checkout, simulated eSewa payment, receipt, and live order tracking
- QR scan flow with table selection, invalid-QR handling, and manual table selection
- Menu search and category filtering
- Pending-payment resume and payment cancellation flows
- Admin login, dashboard, live order board, menu and category management, table/QR management, reports, and settings
- Menu image upload, preview, removal, availability, archive, and restore flows
- Table creation, editing, activation, QR viewing/download, token regeneration, and deletion
- Responsive customer and admin layouts, including mobile cart behavior and desktop layouts
- Windows High Contrast/forced-colors support for the report charts
- Browser verification passed for:
  - Full customer order flow through placement, preparation, ready, and completion
  - Mobile layout at 390px with no horizontal overflow
  - Admin live order updates over Socket.IO
  - Menu/category CRUD, image upload/removal, and archive/restore
  - Table/QR CRUD, activation, and token regeneration
  - Reports, forced-colors rendering, settings, and logout
- Test orders, temporary categories/items/tables, and uploaded files were removed after verification

## To be completed

### 4. Remaining files and final end-to-end verification

- [ ] Environment and setup documentation
- [ ] Cloudflare tunnel and QR demo instructions
- [x] Final security, API, payment, realtime, upload, report, and mobile checks

Security hardening is implemented and verified: rate limits, same-origin admin writes, strict Socket.IO handshake origins, header-only tracking tokens, PII removal, upload signature checks, stale-order cleanup, and production configuration guards. Full setup and run instructions will be added as part of the remaining task 4 work.

## Security and privacy

- No third-party analytics, trackers, or API keys are used. Secrets belong only in `backend/.env`, which is gitignored and never served by Express.
- Set `NODE_ENV=production` and `COOKIE_SECURE=true` behind HTTPS. Production startup rejects a missing/placeholder JWT secret shorter than 32 characters.
- Keep `TRUST_PROXY=0` for direct local access. Set it to `1` only when a reverse proxy such as Cloudflare Tunnel overwrites `X-Forwarded-For`.
- Replace the demo admin password and JWT secret before exposing the app. Use a least-privilege MySQL user instead of `root` with an empty password.
- Rate limits are in memory and reset on restart. They are suitable for this single-server deployment; use a shared store if the app is scaled horizontally.
- Customer phone numbers are returned only to authenticated admins. Customer browsers store only the cart and a minimal `{ id, trackingToken, savedAt }` active-order reference; finished orders are cleared.
- Tracking tokens are sent in the `X-Order-Token` header, not URL query strings. Admin writes require a same-origin `Origin` header.
- Uploads are limited to verified JPEG, PNG, or WebP signatures. Unpaid orders are cancelled after 45 minutes by default (`PENDING_ORDER_TTL_MINUTES`).
- Use Cloudflare Access or another access layer for the admin panel, keep backups encrypted, and protect `.env` and database dumps as sensitive files.

## Folder structure

- `backend/` - Express application, backend dependencies, environment example, and uploaded food images
- `frontend/` - customer and admin web pages
- `database/` - schema, seed SQL, and database setup files
- `TODO.md` - build checklist and task rules

## Task tracking

The authoritative checklist and task rules are in [`TODO.md`](TODO.md).
