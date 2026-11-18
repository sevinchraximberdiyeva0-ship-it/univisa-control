# REST API

All paths use `/api`. JSON errors have `error` and optional validation `issues`. 401 means missing/invalid authentication; 403 means authorization/MFA/CSRF failure; 404 hides inaccessible objects; 409 denotes identity/workflow conflict. Private records require a session cookie. All mutations except login/provider webhooks require exact APP_ORIGIN and X-CSRF-Token from the login response/uv_csrf cookie.

| Method and path | Access | Behavior |
| --- | --- | --- |
| GET /health | Public | Database readiness and provider modes |
| POST /auth/login | Public/rate limited | university slug, email, password, optional otp; returns user/CSRF, sets opaque session |
| GET /auth/registration-options?university= | Public | Open university registration metadata/faculties only |
| POST /auth/student-registration | Exact origin, rate limited | ID/passport metadata and student details; processing acknowledgement; creates pending identity/application and own session |
| GET /auth/identity | Own student session | Masked identity review status/notes; available while admission pending |
| POST /auth/email-verification/send | Own active student + CSRF | Sends an eight-digit code to the account email when delivery is enabled. Returns 204 on provider acceptance, 429 during the resend limit, or 503 when unavailable. |
| POST /auth/email-verification/confirm | Own active student + CSRF | Consumes the current `{code}` and marks the account email verified. Codes expire after 15 minutes and allow five incorrect attempts. |
| POST /auth/passport-login/start | Public + exact Origin | Body `university`, `number`, and optional `document` with `type` and `country`. Returns the same 202 response for matching and nonmatching accounts. Only approved students with a verified email can receive a sign-in code. |
| POST /auth/passport-login/confirm | Same browser + exact Origin | Sends the same identification fields plus `code`. A valid single-use code creates a normal student session. |
| POST /auth/account-recovery/complete | Single-use officer-issued code + exact Origin | Accepts `{code,password}`. Sets a different password, revokes old sessions and device keys, and starts a fresh student session. |
| POST /auth/identity/resubmit | Own student session + CSRF | Submit corrected `identity` metadata and `consent: true` for a rejected application. Reopens the review task and returns 204. |
| PATCH /auth/student-phone | Own student + current password | Update encrypted phone, clear verification; preserve user/passkey IDs |
| POST /auth/passkeys/authentication/options | Exact origin, rate limited | Discoverable student-key authentication challenge; no phone/email/student number needed |
| POST /auth/passkeys/authentication/verify | Challenge-bound browser | Verify signature, RP/origin, user handle, user verification and counter; creates student session |
| GET /auth/passkeys | Own student session | List safe device-key metadata |
| POST /auth/passkeys/registration/options | Own student + current password + CSRF | Require resident platform credential with user verification |
| POST /auth/passkeys/registration/verify | Own session + challenge + CSRF | Persist verified public key, counter and metadata; no biometric image |
| DELETE /auth/passkeys/:id | Own student + current password + CSRF | Revoke an owned device key |
| GET /identity/applications | Officer/admin with MFA | Tenant-scoped masked identity review queue. Supply `page`, `pageSize`, or `status` for a paginated response. Requests without those parameters return an array of up to 200 entries. |
| GET /identity/applications/pending-count | Officer/admin with MFA | Count of submitted applications for active registry records in the caller’s university |
| GET /identity/applications/:id | Officer/admin with MFA | Audited/no-store decrypted metadata and current `submissionVersion` |
| POST /identity/applications/:id/review | Officer/admin with MFA + CSRF | VERIFIED/REJECTED, notes, explicit `originalChecked` confirmation and the `submissionVersion` returned by the details view. Omitted version defaults to 1. Stale versions return 409. |
| POST /identity/applications/:id/recovery | Officer/admin with MFA + CSRF | Issues a single-use 30-minute recovery link for an active, verified student in the same university after `{originalChecked: true}`. A new link replaces the previous one. |
| PUT /identity/registration-policy | Admin with MFA + CSRF | Open/close registration for own university |
| GET /auth/me | Authenticated | Safe user fields and MFA session status |
| POST /auth/logout | Authenticated | Revoke session |
| POST /auth/mfa/setup | Authenticated, not enrolled | TOTP secret and provisioning URI |
| POST /auth/mfa/verify | Authenticated, not enrolled | Verify enrollment code, revoke other sessions |
| GET /university, /faculties | Scoped read | Current tenant metadata |
| GET /rules | Scoped read | Enabled reminder milestones |
| GET /universities, POST /universities | Super-admin | List/provision university and initial administrator |
| GET /profile | Own student | Current notification language and channel preferences |
| PATCH /profile | Own student + CSRF | Updates notification language (`uz`, `tk`, `en`, `ru`, `ko`, `zh`) and optionally the SMS and Telegram channel flags |
| GET /dashboard | Scoped read | Statistics for authorized student records |
| GET /students?search= | Scoped read | Maximum 500; sensitive phone ciphertext omitted |
| POST /students | Officer/admin | Validated student creation; phone initially unverified |
| PATCH /students/:id | Officer/admin | Complete validated registry update |
| DELETE /students/:id | Admin | Archive and cancel pending messages |
| POST /students/:id/phone-verification | Officer/admin | Record human verification evidence |
| POST /import/preview | Officer/admin | Multipart CSV/XLSX, 1000-row limit; validation/duplicate preview |
| POST /import/commit | Officer/admin | Revalidate rows and references; atomic commit |
| GET /export/students | Staff scoped read | Sanitized Excel export, audited |
| GET /documents | Scoped read | Current documents and version history; local remaining days |
| POST /documents | Officer/admin | Create initial verified record with verification notes |
| POST /files | Student/officer/admin | Multipart file + studentId; private encrypted storage |
| GET /files/:id | Scoped read | Audited attachment download |
| GET /renewals | Scoped read | Renewal applications |
| POST /renewals | Student/officer/admin | Submit dates and own supporting file |
| POST /renewals/:id/review | Officer/admin | Review state transition; verifier differs from submitter |
| POST /renewals/:id/resubmit | Original scoped submitter | Correct a returned application and resubmit |
| GET /notifications | Scoped read | Last 500 jobs with attempts and safe message snapshots; no phone or encrypted payload fields |
| GET /notifications/monitor | Scoped staff read | Paginated state/channel filters, delivery attempts, retry count, snapshot message and worker heartbeat. Query: state=ALL/ACCEPTED/DELIVERED/PENDING/SENDING/FAILED/UNKNOWN/UNAVAILABLE/CANCELED/MOCK/RETRIED; channel=ALL/SMS/TELEGRAM/IN_APP; page=1... |
| POST /notifications/simulate | Officer/admin | Synthetic-only 30-day policy simulation. Body: expirationDate, language (uz/tk/en/ru/ko/zh), renewAtDays (0–30 or null), smsFailure (none/temporary/permanent/ambiguous), telegramStarted (boolean). No student IDs, network sends or queue jobs |
| PUT /notifications/sms-provider | Admin | provider=mock/devsms; optional credentials={token,webhookKey,sender}, encrypted at rest; never returned. ENV credential fallback supported |
| PUT /notifications/overdue-policy | Admin | offsets: at most 12 unique days after expiry (1–365); [] disables future offset tasks |
| POST /notifications/:id/acknowledge | Own student | Record acknowledgement |
| GET /staff, POST /staff | Admin | List/create scoped staff; no super-admin creation |
| GET /tasks | Scoped staff | Outstanding human review tasks |
| GET /audit | Admin/auditor | Last 500 scoped audit events |
| GET /settings, PUT /settings | Admin | Delivery timezone/hours/thresholds and retention policy |
| PUT /templates | Admin | Edit supported language/kind body |
| PUT /sms/settings | Admin | Update mock-provider quota and unit cost |
| POST /telegram/link-token | Own student | Hashed, single-use five-minute linking token |
| POST /telegram/webhook | Telegram secret | Private-chat commands; update ID deduplication |
| POST /sms/receipts | Legacy shared secret | Legacy-provider rows only; cannot change DevSMS/mock jobs |
| POST /sms/devsms/:universityId | Tenant-specific HMAC | X-DevSMS-Timestamp and X-DevSMS-Signature over exact raw body, five-minute freshness. Valid final statuses advance matching accepted/uncertain records monotonically |

The paginated identity queue accepts `status` as `SUBMITTED`, `VERIFIED`, or `REJECTED`. `page` is one-based and defaults to 1. `pageSize` defaults to 25 and accepts 1–100. The response contains `rows`, `page`, `pageSize`, `total`, and `totalPages`. Requests past the last page return the last available page. Empty results return page 1 with `total: 0`, `totalPages: 1`, and an empty `rows` array. The latest updated applications appear first, including resubmissions.

See `openapi.yaml`. Faculty coordinators cannot mutate records; students cannot list staff/audit/settings. Every staff data request requires MFA even for auditors.
