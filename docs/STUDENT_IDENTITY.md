# Student ID/passport registration and device passkeys

Students can submit ID-card/passport metadata for university review, then use an enrolled device passkey to sign in without supplying a phone number or student number. Passkeys are linked to the immutable User.id. Editing a student phone or university student number does not change that link.

## What Face ID means here

This implementation uses WebAuthn/FIDO2 platform passkeys. Depending on the device, its operating system verifies Face ID, Touch ID, Windows Hello or a device PIN. The server requires the authenticator's user-verification flag and verifies a cryptographic signature. It does not receive a face photo, facial embedding or device biometric template, and cannot prove which local biometric/PIN modality was used.

This is **not** camera-to-passport photo comparison, liveness detection or government identity verification. Those capabilities are not implemented or claimed. See the primary [SimpleWebAuthn server documentation](https://simplewebauthn.dev/docs/packages/server) and [browser documentation](https://simplewebauthn.dev/docs/packages/browser/).

## University-controlled admission

1. Authorized university admins open registration on **ID / pasport tekshiruvi**. Registration is closed by default for existing/production universities. The synthetic development seed creates its demo university with registration open.
2. The student submits their university code, faculty/program/group/year, student number, name, email, password, processing acknowledgement and ID/passport metadata. No telephone or face image is required.
3. The account and student record are created atomically with a SUBMITTED identity application and PENDING_ADMISSION enrollment. Passport fields are AES-GCM encrypted; duplicate detection uses a tenant-scoped keyed HMAC. Ordinary lists show only the last four number characters.
4. While pending/rejected, the student can see their review status and manage device keys, but cannot access student/document/dashboard APIs. Existing pre-feature students retain access; they are not silently treated as newly verified passport holders.
5. A university officer with MFA opens the audited, no-store details view, checks the original identity document and person through the university's authorized process, confirms that check, records notes, and verifies or rejects. A submitted number alone is never treated as proof of identity.
6. Verified admission enables the student services. Rejected applicants must contact the office; automated document resubmission/recovery workflows are not yet provided.

## Enrolling and using a device

Use **Profil va Face ID** and provide the current password to add a named key. The browser/OS performs local device verification. Keys are discoverable platform credentials; subsequent sign-in uses **Face ID / qurilma kaliti bilan kirish**. A current password is also required to remove a key or change a phone number. Phone changes clear phone verification, so SMS requires renewed staff verification, while passkeys stay attached to the same account.

A passkey must already be enrolled on that device or available through a supported synchronized passkey manager. Changing phones does not make an unknown new device recognize a person by face automatically. Keep password-based access or another enrolled/synchronized passkey; contact the university if both are lost. Do not reset an account based solely on a supplied passport number. Privileged staff still require the existing password/TOTP workflow; student passkeys do not bypass staff MFA.

Passkeys require HTTPS in deployment. Localhost HTTP is allowed for local development. The RP ID is derived from APP_ORIGIN's hostname and the expected origin is exact, including its port. Choose the stable public domain before enrollment; changing it can make existing keys unusable. Production runs must configure the real HTTPS origin, trusted TLS ingress, and university privacy/retention/legal policies before real identity data is collected.

## Security properties and verification limits

- Five-minute, single-use server-side challenges, bound to an HttpOnly SameSite cookie. Enrollment is additionally bound to the authenticated user/session and current-password check.
- Exact Origin/RP checks, discoverable-credential userHandle/account matching, signature-counter handling, disabled-account rejection and role restrictions. Private keys remain under the authenticator/passkey provider's control.
- Tenant-scoped officer access, encrypted passport metadata, normalized keyed duplicate fingerprint, audit events without raw identity fields, and registration throttling.
- Successful local browser coverage uses a Chromium virtual CTAP2 platform authenticator with user verification. Real Face ID/Touch ID/Windows Hello hardware, cross-device synchronization, physical document verification and a public HTTPS production domain have **not** been tested here.
- Retention/deletion, managed encryption-key rotation (including the HMAC duplicate index), account recovery, abuse controls beyond in-memory rate limits, email ownership and accessibility/security assessment still require production qualification.
