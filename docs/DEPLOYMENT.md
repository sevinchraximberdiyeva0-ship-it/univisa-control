# Deployment and recovery

## Development

Use dedicated PostgreSQL/Redis and the `.env.example` variables. Never share this database with other projects. Seed is disabled when NODE_ENV=production. Provider modes default to mock. Start API, frontend and worker separately using the README instructions.

## Production

1. Provision approved data-resident infrastructure with university legal/security review. No statement of Uzbekistan legal compliance is implied by this repository.
2. Use unique secrets from a secret manager, TLS at the ingress, encrypted disks/volumes, restricted database and Redis access, and a private storage volume. Set APP_ORIGIN to the exact HTTPS origin.
3. `docker compose build` and `docker compose up -d`. Migrations run as a prerequisite service. The bundled Nginx binds localhost:8080; terminate TLS at a reviewed host ingress and forward the public origin consistently. PostgreSQL/Redis localhost ports are for local administration; remove published ports on production hosts.
4. Provision the initial administrator through a controlled administrative script/process; do not run the synthetic development seed in production. No default production password exists.
5. Configure Telegram HTTPS webhook with the official Bot API setWebhook secret_token matching TELEGRAM_WEBHOOK_SECRET. Never put a bot token in source control, logs or browser code. Test linking and channel blocking with an authorized test account before live use.
6. Select DevSMS in SMS Management or the provider API. Configure an API token, independent HMAC webhook key and approved sender in encrypted tenant settings or DEVSMS_* secret environment variables. Configure the HTTPS university-specific callback route and verify signed receipts/status polling against the vendor account. Keep SMS_MODE=mock and ALLOW_LIVE_NOTIFICATIONS=false until an authorized synthetic-recipient test is arranged. An accepted send is never treated as delivered; segment billing and vendor-specific evidence still need validation.
7. Monitor `/api/health`, worker `scheduler_tick` timestamps, oldest PENDING row, FAILED/UNKNOWN/UNAVAILABLE counts, database backups, storage capacity and Redis errors. API health currently checks PostgreSQL; worker/Redis readiness requires external monitoring. Alert if no scheduler tick occurs for 90 seconds.

Containers run API/worker as an unprivileged node user. Nginx is a separate image. Docker runtime and production Compose have not been qualified unless explicitly recorded in DELIVERY_STATUS.

## Backups

Schedule encrypted PostgreSQL backups with WAL archiving appropriate to the university's RPO; back up private files consistently and preserve encryption-key versions separately in a secret manager. Redis append-only persistence improves recovery; the database outbox is authoritative. Test restoration into isolated infrastructure and verify documents, versions, pending reminders and tenant boundaries. Never restore production personal data into an unapproved developer machine.

## Recovery

Stop senders before point-in-time restores. Restore database/files and keys together, reconcile external provider IDs/UNKNOWN outcomes, then restart API and worker. Rebuilt Redis queues reconcile from PENDING rows. Review potentially accepted messages around the recovery point before allowing replay. Key loss makes encrypted files/phones unrecoverable; do not rotate ENCRYPTION_KEY without a migration strategy.

## Privacy and remaining hardening

Have authorized counsel verify lawful basis, consent and mandatory communication policy, cross-border transfer, residency, access rights, retention and incident response against current applicable law. This is a deployment checklist, not legal advice. Retention setting currently records policy only; implement a reviewed deletion/anonymization runner that respects audit retention, legal holds and backup expiry. Add malware scanning/quarantine, secure object storage lifecycle policies, MFA recovery, session management UI, distributed rate-limit storage and tamper-resistant audit replication before sensitive production use.

See [legal review input](LEGAL_REVIEW.md) for the primary 2026 amendment reviewed. Older localization summaries may not reflect that amendment; no data classification or hosting decision is automatically approved here.
