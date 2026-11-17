# UniVisa Control

Independent university immigration-document management application. React/TypeScript/Vite frontend; Express/Prisma/PostgreSQL API; Redis/BullMQ worker. All seed records are synthetic. No FOOD project code, database, configuration or credentials are used.

## Local setup

Requires Node 22.12+ (Node 22 LTS recommended), PostgreSQL 17 and Redis 7. Docker Compose can supply the latter two services.

1. Copy `.env.example` to `.env`. Set a unique database password, a 64-character hex `ENCRYPTION_KEY`, and distinct seed passwords of at least 14 characters. Match `DATABASE_URL` to the database credentials. Do not commit `.env`.
2. `npm ci`
3. `docker compose up -d postgres redis` (or start dedicated local instances).
4. Load `.env` into your shell for Prisma CLI commands. On PowerShell: `Get-Content .env | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { $pair = $_ -split '=',2; [Environment]::SetEnvironmentVariable($pair[0],$pair[1],'Process') }`.
5. `npm run db:generate` then `npm run db:migrate` and `npm run db:seed`.
6. `npm run dev` and, in a second terminal, `npm run worker`.
7. Open http://localhost:5173. University code: `demo`. Admin email: your `SEED_ADMIN_EMAIL`; student email: `student1@example.invalid`. Use the passwords you supplied. Enroll a staff authenticator before reading university records.

## Checks

- `npm run typecheck`
- `npm test`: calendar, reminder schedule, workflow and import tests. PostgreSQL integration cases run only with `TEST_DATABASE_URL` set; skipped tests are not evidence of integration success.
- `npm run build`
- `npm run test:integration`: creates a dedicated disposable PostgreSQL cluster with random credentials, applies migrations, runs all API/unit tests and stops the database. Test data stays in ignored `test-results/` for diagnosis. On Linux, run as a normal user; Windows uses pg_ctl's restricted launch token.
- `npm run test:e2e`: uses the same isolated database setup, synthetic seed and local servers to test staff/student flows in installed Microsoft Edge. Set `PLAYWRIGHT_CHANNEL=chrome` to use installed Chrome. No real provider requests are made. Servers are stopped afterward.
- To run API integration tests, create an isolated disposable database, migrate it using `DATABASE_URL` pointing there, then set `TEST_DATABASE_URL` to the same URL and run `npm test`. Tests create/delete only their own tenant fixtures. Never use a production database.

## Delivery scope

Implemented: session authentication and staff TOTP MFA; tenant/student/faculty scopes; registry create/edit/archive API; CSV/Excel preview and transactional commit; document versioning; encrypted private upload/download; renewal review and idempotent verification; PostgreSQL notification outbox and Redis reconciliation worker; durable multilingual Telegram commands and one-time linking; DevSMS and mock SMS adapters; signed SMS receipts and bounded polling; notification monitoring and safe 30-day simulator; English/Uzbek/Russian templates; dashboard, student portal, calendar list, reports, exports and audit views; settings and staff management.

Production qualification remains open. DevSMS adapter contracts are tested with mock HTTP responses; real delivery requires credentials, approved sender and an authorized end-to-end test. Telegram live mode requires genuine credentials, HTTPS webhook registration, and an authorized test. A bot API acceptance is not a read/delivery receipt. There is no government integration. See `docs/DELIVERY_STATUS.md` for gaps and verification results.

## Notification setup and safe testing

Keep `SMS_MODE=mock`, `TELEGRAM_MODE=mock`, `ALLOW_LIVE_NOTIFICATIONS=false` for development. Start API/frontend and the worker as above. Staff can open **Notifications → Xavfsiz simulator** to exercise 30/21/14/7–1/0-day reminders, renewal confirmation, failures and overdue staff tasks instantly. The simulator never writes delivery jobs or sends real messages.

University admins select **SMS management → DevSMS** and enter token, webhook HMAC key and approved sender; credentials are encrypted and never returned. Alternatively set `DEVSMS_TOKEN`, `DEVSMS_WEBHOOK_KEY`, `DEVSMS_SENDER` in the server secret environment and select DevSMS without entering credentials. The callback is `https://YOUR_UNIVERSITY_HOST/api/sms/devsms/UNIVERSITY_ID`. Do not change live gates until a separate authorized test with a non-student test account is arranged. Actual live configuration requires `SMS_MODE=live` / `TELEGRAM_MODE=live` as applicable and `ALLOW_LIVE_NOTIFICATIONS=true`.

Provider reference: [DevSMS official API documentation](https://devsms.uz/api/docs.php?lang=en). Telegram reference: [official Bot API](https://core.telegram.org/bots/api). No live delivery was performed during this development work.

Current checks: **74 unit/API tests passed, 1 real Redis test skipped; 2 browser tests passed; builds/typechecks and dependency audit passed**. Both migrations apply with no Prisma schema drift. `npm run check:compose` validates YAML/structure only; Docker is unavailable on the current Windows host.

To test real queue persistence in an isolated Redis instance, set `TEST_REDIS_URL=redis://127.0.0.1:6379/15` in your shell and run `npm run test:integration`. DB 15 must be dedicated to tests; do not use production Redis. CI declares a Redis 7 service for this test, but cloud CI execution has not been observed here.

For a **required** Redis check, run `npm run test:redis` instead. This command fails before starting PostgreSQL if `TEST_REDIS_URL` is missing. CI sets `REQUIRE_REDIS_TESTS=true`, so a missing Redis service cannot silently turn these checks into skipped tests. The four recovery tests use real PostgreSQL delivery records and the application processor, with a unique Redis queue prefix per run. They cover worker replacement, loss of queue data, replay prevention and retained failed jobs. No external notification providers are called; only synthetic in-app messages are processed. Local Windows verification on 17 November: 74 tests passed and 4 Redis cases skipped because no Redis runtime is installed.

Reminder thresholds are operational defaults, **not immigration law**. Authorized legal staff must verify rules, processing basis, retention, and deployment residency before production.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md) and [OpenAPI](docs/openapi.yaml)
- [Deployment](docs/DEPLOYMENT.md)
- [Notification rules](docs/NOTIFICATION_RULES.md)
- [Delivery status](docs/DELIVERY_STATUS.md)
