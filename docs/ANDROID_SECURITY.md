# Android Telecaller Security

## Screenshot / screen recording

- `FLAG_SECURE` is set on `MainActivity` and the in-call overlay window.
- On supported devices this blocks normal screenshots, screen recording of the app, and recent-apps previews.
- API 34+ screenshot attempts are audited via `POST /mobile/security/screenshot-attempt`.

**Limitations:** External cameras, rooted/custom ROMs, MDM mirrors, and some OEM screen-share paths can still capture content. Treat OS protections as strong but not absolute.

## One device = one telecaller

1. First Android login registers an `ACTIVE` `UserDevice` (UUID + Keystore public key + model/OS/app).
2. Login from a different device returns **403** with:  
   `This account is already registered on another device. Please contact your administrator to authorize a new device.`
3. Every Android API call must send `X-Device-Id` matching the ACTIVE device; JWT session must still be active.

## Admin replacement

Admin Portal → **Employee Devices** (`/employees/devices`):

- **Block** / **Revoke** / **Reset** / **Replace** (authorize replacement + revoke sessions)
- After Reset/Replace, the telecaller logs in on the new phone to bind it.

## Sessions

- Access JWT TTL: `JWT_EXPIRATION` (default `15m`)
- Refresh tokens rotate via `POST /auth/refresh`
- Logout / device revoke / user block invalidates `SessionLog` and refresh tokens (enforced in JWT strategy)

## Phone numbers

- List/inbox/contacts UI: masked `98XXXXXX45`
- Active dialer card: full number (required to place the call), under `FLAG_SECURE`
- Notifications: name + status only (no full number)

## Integrity signals

Root/debugger/emulator flags are stored on the device record as risk metadata. They are **not** a hard block by default.

## Transport

- Debug builds: cleartext allowed for LAN Nest backends
- Release builds: HTTPS-only (`network_security_config`)
