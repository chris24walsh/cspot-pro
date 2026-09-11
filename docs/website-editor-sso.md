# Website editor sign-in contract

## Decision

CSpot uses a signed HTTP-only session cookie and resolves permissions from the
active user's current roles on each protected request. Strapi 5's supported
administrator SSO is an Enterprise/Cloud feature. The deployed self-hosted
Strapi installation has no Enterprise license configured, so this integration
uses a deliberately small OAuth-style authorization-code bridge.

The bridge never shares a CSpot session or reusable Strapi token. The only
browser-visible credential is a random, hashed-at-rest, 60-second, single-use
code. Existing Strapi username/password administrator login remains available.

## CSpot permissions

- `website_editor` grants `website:edit` (draft content and permitted media).
- `website_publisher` grants both `website:edit` and `website:publish`.
- `administrator` does not implicitly include either permission. Website access
  is an explicit, individually assigned decision. No Strapi account created by
  this bridge may be assigned Strapi Super Admin.

These roles appear in CSpot's existing user-role administration. Both the UI
entry point and CSpot authorization endpoint require `website:edit`. The
exchange rechecks that the CSpot user is active and still has the permission.

## Browser and server flow

1. CSpot opens `GET /api/v1/integrations/website-editor/start` in a new tab.
2. CSpot redirects only to configured `WEBSITE_EDITOR_START_URL`, with the
   allowlisted destination key `website-home`.
3. Strapi creates at least 256 bits of random `state`, stores it in a short-lived
   HTTP-only, Secure, SameSite=Lax flow cookie, and redirects to CSpot's
   `/api/v1/integrations/website-editor/authorize?state=...&destination=website-home`.
4. CSpot rechecks session and permission, stores only a SHA-256 code hash, and
   redirects to configured `WEBSITE_EDITOR_CALLBACK_URL`. Responses use
   `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
5. Strapi callback compares `state` with the flow cookie in constant time,
   deletes that cookie, and exchanges the code from its backend. It must never
   send the exchange secret or code to admin JavaScript.
6. Strapi maps/provisions the individual account and establishes its normal
   administrator session, then redirects to the fixed homepage visual editor:
   `/cms/admin/content-manager/single-types/api::website-home.website-home?status=draft&visual=1`.

The Strapi start and callback endpoints must reject missing/expired/mismatched
state, clear the flow cookie on every terminal outcome, and render a generic,
useful error page without code, state, secrets, or upstream response bodies.
They must set `Cache-Control: no-store` and must not log query strings.

## Strapi endpoint contract

Configure these server-only values in both deployments, using an independent
random secret of at least 32 bytes:

```text
CSpot WEBSITE_EDITOR_START_URL=https://lcf.walsh.qzz.io/cms/cspot-sso/start
CSpot WEBSITE_EDITOR_CALLBACK_URL=https://lcf.walsh.qzz.io/cms/cspot-sso/callback
CSpot WEBSITE_EDITOR_CLIENT_ID=lcf-strapi
CSpot WEBSITE_EDITOR_CLIENT_SECRET=<shared secret>
CSpot WEBSITE_EDITOR_HANDOFF_SECONDS=60

Strapi CSPOT_BASE_URL=<internal or public CSpot API origin>
Strapi CSPOT_EDITOR_CLIENT_ID=lcf-strapi
Strapi CSPOT_EDITOR_CLIENT_SECRET=<same shared secret>
Strapi CSPOT_EDITOR_SESSION_MINUTES=<chosen administrator session lifetime>
```

Strapi calls:

```http
POST {CSPOT_BASE_URL}/api/v1/integrations/website-editor/exchange
Content-Type: application/json
X-CSpot-Client-Id: lcf-strapi
X-CSpot-Client-Secret: <shared secret>

{"code":"<one-time code>","destination":"website-home"}
```

Success is HTTP 200:

```json
{
  "subject": "<stable CSpot user UUID>",
  "email": "person@example.org",
  "name": "Person Name",
  "permissions": ["website:edit"]
}
```

Responses are `401` for an invalid CMS client, `400` for invalid, expired or
replayed codes/destinations, and `403` when the user was disabled or access was
revoked. Do not distinguish invalid-code causes in user-facing output.

## Strapi account and role policy

Add a private immutable mapping field/table from CSpot `subject` to Strapi admin
user ID. Never map by mutable email after initial provisioning. On first login,
create one Strapi admin user for that subject, with a random unusable local
password if the schema requires one. Subsequent email/name changes update that
same mapped account. A mapping collision or an email already owned by a different
subject must stop for administrator resolution; never merge accounts silently.

Create two non-Super-Admin Strapi roles:

- **CSpot Website Draft Editor**: admin-panel access; Content Manager read/create/
  update for each supported `website-*`, shared website, news index and post type;
  Media Library read, upload, update, crop/replace, and asset-folder access as
  actually used by the editor. No delete, publish, user/role, token, settings,
  plugin configuration, transfer, marketplace, audit, or schema permissions.
- **CSpot Website Publisher**: the same permissions plus Content Manager publish
  and unpublish for the explicitly supported content types. Publishing remains
  absent unless exchange claims `website:publish`.

Validate the exact action IDs against Strapi's role editor on the deployed
5.51.2 build because content-type and upload action names are generated. Test
every supported single type; granting only the homepage is acceptable for the
initial allowlisted destination, but fields linking to shared types still need
read access.

On every successful handoff, reconcile the two managed role assignments from
the returned permissions and remove the other managed role. Never remove roles
outside this integration automatically. If CSpot returns disabled/revoked,
create no Strapi session. Optionally disable the mapped Strapi account when a
revocation is observed; do not delete it, preserving attribution/audit history.

## Session and revocation policy

CSpot disablement or role removal blocks authorization and exchange immediately.
It does **not** terminate an already-issued Strapi administrator session. Existing
CMS sessions remain valid until the configured Strapi expiry, the user logs out
of Strapi, or a Strapi administrator disables the mapped account/revokes sessions.
CSpot logout likewise does not end the CMS session. Keep the Strapi session short
(recommended 4 hours) and state this clearly in the UI/operations documentation.

For immediate cross-system revocation, a future separately authenticated webhook
may disable the mapped Strapi account and revoke its sessions; it is outside this
narrow initial integration.
