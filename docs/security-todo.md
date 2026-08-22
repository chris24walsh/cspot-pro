# Security TODO

Current posture: suitable for controlled church-community use, but not yet
hardened for unrestricted public registration or high-value regulated data.

## Before general public registration

- [ ] Add CSRF protection to authenticated state-changing requests using a
  session-bound token or required custom header, with strict Origin validation.
- [ ] Enforce request and upload size limits in Nginx and FastAPI.
- [ ] Limit expanded archive size and document-conversion CPU, memory, and time.
- [ ] Add durable proxy-level throttling for login, registration, verification,
  and password recovery; add Cloudflare Turnstile or equivalent bot protection.
- [ ] Add MFA and require it for administrators.
- [ ] Introduce revocable server-side sessions, active-session management, and
  "sign out all devices"; revoke sessions after password or security changes.
- [ ] Add production browser headers: Content-Security-Policy, HSTS,
  X-Content-Type-Options, Referrer-Policy, frame-ancestors, and
  Permissions-Policy.
- [ ] Run the API and conversion processes as non-root, drop unnecessary Linux
  capabilities, enable no-new-privileges, and reduce writable filesystem scope.

## Supply chain and operations

- [ ] Upgrade the audited Vite, PostCSS, and NanoID dependency chains.
- [ ] Add npm and Python vulnerability checks to CI, with an agreed failure
  threshold for exploitable production dependencies.
- [ ] Add a security-event audit trail for authentication failures, user
  approvals/rejections, role and permission changes, password resets,
  integration changes, and destructive archive/restore actions.
- [ ] Disable or administrator-protect production OpenAPI documentation.
- [ ] Perform and document a full backup restoration drill.
- [ ] Complete mobile/tablet/desktop acceptance checks for registration,
  verification, approval, rejection, login, and password recovery.
- [ ] Commission an external authenticated penetration test before describing
  the service as broadly public.

## Controls already present

- HTTPS via Cloudflare with a valid certificate.
- Secure, HttpOnly, SameSite=Lax session cookies in production.
- Salted scrypt password hashes with a 12-character minimum.
- Hashed, expiring, single-use invitation/reset/verification tokens.
- Exact production CORS allowlist.
- Server-side permission checks and livestream-only Viewer access.
- Inactive, administrator-approved self-registration with email verification.
- Baseline in-process authentication throttling.
- Authorization-gated camera playback and restricted camera proxy routes.
- Private API/database container ports.
- CI tests and builds, Dependabot coverage, and successful scheduled backups.
