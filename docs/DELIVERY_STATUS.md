# Delivery status

This is an executable full-stack implementation with tested core workflows. It is not certified or fully qualified for sensitive production deployment. No live provider or government integration has been verified.

| Phase | Implemented | Verification |
| --- | --- | --- |
| 1 | Independent workspace, PostgreSQL models/migration, session auth, CSRF, staff TOTP, responsive application shell | Prisma generation, typecheck, database migration and browser MFA/login checks |
| 2 | Scoped registry, encrypted phone fields, import preview/commit, document versions, expiry calculation, dashboard, filtered lists | Unit boundaries/import validation, API tenant isolation, browser student scope/search |
| 3 | Persistent notification outbox, university calendar schedule, bounded retry, per-local-day duplicate guard, SENDING reservations, failed-job recovery, bounded overdue tasks and heartbeat | Calendar/database delivery and mocked Redis-loss/failed-job recovery tests pass; real Redis test remains environment-gated |
| 4 | Durable multilingual Telegram commands/linking/replies; DevSMS and mock SMS adapters; HMAC callbacks, status polling, translated templates and quota checks | Provider contracts, malformed/expired/replayed linking and signed receipt isolation tested with mocked network; no live delivery test |
| 5 | Private encrypted uploads, staff review state machine, new verified versions, safe cancellation/replanning, immediate confirmation outbox | Real PostgreSQL/API submission/review/concurrent approval/obsolete-send checks |
| 6 | Live faculty/country reports, Excel and print-to-PDF export, audit views, settings/template management, Docker and CI configuration | Builds/typecheck, automated API/unit/browser checks; Docker and CI cloud execution not run locally |

## Actual local verification

- `npm run typecheck`: both workspaces pass.
- `npm run build`: API compilation and Vite production build pass.
- `npm run test:integration`: **74 passed, 0 failed, 1 skipped**. Includes 28 existing domain tests, 27 provider/template/simulator tests and 19 PostgreSQL/API tests. Redis-loss and retained-failed-job recovery are tested with a queue mock. The one real Redis/BullMQ restart test is skipped because TEST_REDIS_URL is unavailable locally; it is configured for isolated DB 15 in CI but CI has not been executed here.
- Both additive migrations apply to disposable PostgreSQL 18.6. The migration runner compares the resulting database with the Prisma schema: **No difference detected**. Existing initial migration is preserved.
- `npm run test:e2e`: **2 passed, 0 failed** using headless installed Microsoft Edge. Covers student isolation/renewal form/link token, staff MFA/search, notification monitoring, safe simulator and mobile Uzbek navigation. No live provider calls.
- Dependency installation audit: zero known vulnerabilities after dependency upgrades and tested overrides. Audit is a point-in-time check, not a security certification.
- `npm run check:compose`: YAML, required services, persistence volumes, health checks and migration dependency structure pass. Docker executable is unavailable: image builds, container lifecycle, PostgreSQL 17 image and real Redis network recovery are **not verified locally**.
- Intermediate runs found two test-fixture issues (reply due-time and consumed mock HTTP response), an ambiguous browser selector and a truncated index-name schema drift. These were corrected; final passing results above supersede those runs.

## Notification reliability update

- DevSMS is selectable per university. Credentials are AES-GCM encrypted or supplied through environment variables; neither credentials nor encrypted payload fields are exposed by monitoring APIs.
- `SMS_MODE=mock`, `TELEGRAM_MODE=mock` and `ALLOW_LIVE_NOTIFICATIONS=false` are safe defaults. Real sending requires explicit live mode plus the independent allow gate. All tests use synthetic fixtures/mocked transports; no live messages were sent.
- SMS success from send returns ACCEPTED. Only a valid tenant-specific raw-body HMAC callback or authenticated status lookup can mark it DELIVERED. Repeated/contradictory final receipts cannot downgrade delivery. Status polling is bounded and never resends accepted messages.
- Telegram commands, inline buttons and notifications support Uzbek/English/Russian. Linking checks an active authenticated student, consumes short-lived hashed tokens once and writes the command response outbox in the same transaction. Blocked channels are recorded and escalated; inbound private commands can mark a channel unblocked.
- Reminders include distinct 14-day urgent and expiry-day final templates. Restart backlog is coalesced and a persisted document-version/channel/local-day reservation prevents bursts. Pending renewals keep reminders active; verified renewals cancel obsolete pending messages and enqueue immediate confirmations atomically.
- Configurable overdue offsets default to 1, 3, 7, 14, 30 days. They create bounded, deduplicated staff tasks; they do not produce unlimited student messages.
- Explicit temporary rejections retry at most four total sends, with 30/60/120-second backoff or a longer bounded provider retry-after. Permanent failures are FAILED; ambiguous network/crash outcomes remain UNKNOWN for reconciliation.
- Monitoring includes accepted, delivered, pending, failed, uncertain, unavailable, mock and retried records, pagination, attempts and heartbeat freshness. The simulator uses the shared schedule/templates/retry decisions and mock SMS only; it creates no delivery queue jobs and never accesses real student records. It is a fast policy simulation, not proof of real provider or Redis operation.

## Remaining work / external dependencies

1. Genuine Telegram credentials, HTTPS webhook registration, official university bot identity and authorized live test.
2. DevSMS account/API token, separate webhook signing key, approved sender, HTTPS callback domain, vendor contract/status semantics and an authorized non-student live test with actual receipt evidence. Adapter code is implemented; production delivery is not verified. Its documented send route is restricted to +998 numbers. Segment-based billing/budget reconciliation still requires vendor validation.
3. Execute the opt-in real Redis suite and broader process-kill/network-partition/load tests on production-like infrastructure. Local queue-mock recovery is verified, not a substitute for those tests. Redis persistence/noeviction and worker heartbeat are configured; distributed availability and capacity remain to be qualified.
4. Legal approval of processing basis, mandatory messaging overrides, retention execution, residency and cross-border arrangements. See LEGAL_REVIEW.md and current primary legal sources.
5. Production private object storage/quarantine/malware scanning, managed encryption keys and rotation, audited restore exercises, MFA recovery, distributed rate limits and independent security/accessibility review.
6. Advanced product work: Telegram-preferred/SMS-fallback policy, complete translated interface/form copy, student profile preference UI, student account provisioning UI, comments and task-resolution UI, resubmission UI, full calendar-month/timeline controls, historical trend snapshots, cursor pagination, branding management, SIS adapters and optional Mini App. APIs/models cover several of these but the complete user experience is not yet provided.
7. Renewal rejection/correction events queue a generic multilingual request to review portal notes, without claiming invalid immigration status. Verified-renewal confirmations are queued for all three channels. Real delivery still depends on verified external setup.

The platform cannot promise exactly-once external delivery. UNKNOWN outcomes are deliberately quarantined for human/provider reconciliation. University legal approval fields are unset by default; operational reminder defaults never certify immigration compliance.
