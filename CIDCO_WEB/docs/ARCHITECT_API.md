# CIDCO Architect Integration API

This is the reference for an **architect's system** integrating with the CIDCO AQI portal over the
handshake + token flow. Every call is testable from Postman — import
`postman/CIDCO-Architect-Handshake.postman_collection.json`.

The CIDCO officer manages the other side from the admin dashboard (`/`, the "CIDCO Admin" tabs):
issuing credentials, approving validation requests, approving token requests, and watching the
communication log. Architects have their own dashboard at **`/architect`**, where CIDCO's messages —
including the tokens and the endpoint URLs — are delivered.

> This is the **API channel**. If CIDCO gave you an *SFTP* user id and password instead, you are on
> the other channel — see [`SFTP_CHANNEL.md`](./SFTP_CHANNEL.md). The two are separate: API
> credentials do not open the SFTP server, and SFTP credentials do not open the API.

All responses share one envelope:

```jsonc
{ "success": true,  "data":  { /* ... */ } }
{ "success": false, "error": "message", "details": { /* field errors */ } }
```

Base URL below is written as `{{baseUrl}}` (e.g. `http://localhost:3000`).

---

## The flow

| # | Who | Action | Endpoint |
|---|-----|--------|----------|
| 1 | CIDCO | Emails you a user id and password: `{clientId, clientSecret, expiryDate}` | (admin dashboard) |
| 2 | You | Present those credentials **+ IP + device info** → queued for CIDCO approval (**202**) | `POST /api/architect/validate` |
| 3 | CIDCO | An officer checks you, your IP and your device, then approves | (admin dashboard) |
| 4 | CIDCO | Delivers your **access + refresh tokens and every endpoint URL** as a message | `/architect` → Messages |
| 5 | You | Create your own username and password and fill in your details | `POST /api/architect/register` |
| 6 | You | Send AQI data with the access token, automated every 3 h | `POST /api/architect/data` |
| 7 | You | Access token expired (503) → ask CIDCO for a new one with your refresh token | `POST /api/architect/token-requests` |
| 8 | You | Refresh token expired too (503) → start again from step 2 | `POST /api/architect/validate` |
| — | You | Check status / read the log any time | `GET /api/architect/status`, `GET /api/architect/logs` |

---

## 0. The credential CIDCO sends you

CIDCO emails this out of band. It is only a user id, a password and an expiry date — the endpoint
URLs are in this document, and CIDCO repeats them in the message it delivers with your tokens, so
you can copy them straight from your dashboard. The `clientSecret` is shown only once — store it
securely.

```json
{
  "clientId": "ARCH-582397C8A863",
  "clientSecret": "hs_sec_50fda6539cf711974dc4e983c86ae95a...",
  "expiryDate": "2026-09-13T07:00:39.540Z"
}
```

The endpoints you will need:

| Purpose | Endpoint |
|---------|----------|
| Present your credentials | `POST {{baseUrl}}/api/architect/validate` |
| Create your own login after approval | `POST {{baseUrl}}/api/architect/register` |
| Check where your validation stands | `POST {{baseUrl}}/api/architect/handshake-status` |
| Send AQI data | `POST {{baseUrl}}/api/architect/data` |
| Ask for a new access token | `POST {{baseUrl}}/api/architect/token-requests` |
| Your exchange log | `GET {{baseUrl}}/api/architect/logs` |
| Your dashboard | `{{baseUrl}}/architect` |

---

## 1. Validate — present your credentials for CIDCO approval

`POST /api/architect/validate`

Send the credentials **plus the IP address and device info** you want CIDCO to whitelist.

```json
{
  "clientId": "ARCH-582397C8A863",
  "clientSecret": "hs_sec_...",
  "ipAddress": "203.0.113.9",
  "deviceInfo": "RaspberryPi-4 | station STN-KHR-07"
}
```

`ipAddress` and `deviceInfo` are optional — if you omit `ipAddress`, CIDCO uses the IP the request
arrived from. Once CIDCO whitelists that IP/device, every later call (validate, token request, data)
must come from the same IP or it is refused.

**No tokens are issued here.** The request is queued on the CIDCO dashboard so an officer can see
who you are, which IP you are calling from and which device you are using.

- **202 Accepted** — your request is with CIDCO, awaiting approval:

```jsonc
{
  "success": true,
  "data": {
    "message": "Credentials accepted and sent to CIDCO for approval. …",
    "status": "AWAITING_APPROVAL",
    "requestId": "…",
    "presentedIp": "203.0.113.9",
    "deviceInfo": "RaspberryPi-4 | station STN-KHR-07"
  }
}
```

- **504 Gateway Timeout** — validation failed (unknown `clientId`, wrong secret, expired/revoked
  credential, or a non-whitelisted IP). In the CIDCO protocol **504 means "handshake not validated."**

### 1a. Check where your request stands

`POST /api/architect/handshake-status` with `{clientId, clientSecret}` — works before you have a
portal account:

```jsonc
{
  "status": "ESTABLISHED",
  "approved": true,
  "needsAccountSetup": true,      // you still have to choose a username and password
  "accountEmail": null,
  "latestRequest": { "status": "APPROVED", "presentedIp": "203.0.113.9", "reviewedAt": "…" }
}
```

### 1b. What approval delivers

When the officer approves, CIDCO generates the pair and puts it on your dashboard at `/architect` →
**Messages**, together with all the endpoint URLs, ready to copy:

- access token — send AQI data with it (7 days by default)
- refresh token — ask for a new access token with it (30 days by default)

Each approval issues a fresh pair and **revokes the previous one**, so only one pair is ever live.

> The expiry windows (7 / 30 days by default) are set by CIDCO per architect from its dashboard, so
> the values you receive may differ — always read the expiry dates in the message.

---

## 2. Create your own login

`POST /api/architect/register` — after CIDCO approves you, swap the CIDCO-issued credentials for a
username and password of your own, and fill in the details CIDCO will see against you.

```json
{
  "clientId": "ARCH-582397C8A863",
  "clientSecret": "hs_sec_...",
  "email": "rhea@nairdesign.in",
  "password": "your-own-password",
  "name": "Ar. Rhea Nair",
  "firmName": "Nair Design Studio",
  "councilRegNo": "CA/2019/12345",
  "phone": "+91 98200 11223",
  "designation": "Principal Architect",
  "address": "Plot 7, Sector 15, CBD Belapur"
}
```

- **201 Created** — the account is set up and you are signed in to `/architect`. Everything you
  entered here appears on the CIDCO dashboard under **Architect Handshakes → Manage**.
- **409** — CIDCO has not approved you yet, or that username is already taken.
- **504** — the CIDCO-issued credentials did not verify.

Only `email`, `password` and `name` are required; the rest are optional but CIDCO expects them.
On the dashboard this is the same form you get after approval — the API is there so the whole flow
is testable from Postman.

---

## 3. Send AQI data

`POST /api/architect/data` — authenticate with `Authorization: Bearer <token>`. Each call inserts
one reading row, so a monitoring station can post on a schedule.

**Full monitoring-station payload (JSON):**

```
POST /api/architect/data
Authorization: Bearer cidco_tok_xxxxxxxxxxxxxxxx
Content-Type: application/json
```
```json
{
  "projectSiteId": "CIDCO-KHR-012",
  "monitoringStationId": "STN-KHR-07",
  "oem": "Aeroqual",
  "deviceModel": "AQY-1",
  "measuredAt": "2026-08-14T06:00:00Z",
  "aqiValue": 176,
  "pm25": 78.3, "pm10": 152.9,
  "no2": 41.2, "so2": 12.7, "co": 0.9, "ozone": 48.6,
  "temperature": 33.4, "humidity": 62.1,
  "integrationMethod": "Automated API (3h)",
  "otherParams": { "windSpeed": 3.2, "windDir": "NW", "noise_dB": 58 }
}
```

**Parameters** (only `measuredAt` and `aqiValue` are required):

| Field | Parameter | Also accepts |
|-------|-----------|--------------|
| `projectSiteId` | Project / Site ID | `siteId`, `Project/Site ID` |
| `monitoringStationId` | AQI Monitoring Station / Device ID | `stationId`, `deviceId` |
| `oem` | OEM | `manufacturer` |
| `deviceModel` | Model | `model` |
| `measuredAt` | Date & Time of Reading (ISO 8601) | `dateTime`, `timestamp` |
| `aqiValue` | AQI Value (0–1000) | `aqi` |
| `pm25` / `pm10` | PM2.5 / PM10 | `PM2.5`, `PM10` |
| `no2` / `so2` / `co` / `ozone` | NO₂ / SO₂ / CO / O₃ | `o3` |
| `temperature` | Temperature (°C) | `temp` |
| `humidity` | Humidity (% RH) | `rh` |
| `integrationMethod` | Data Source / Integration Method | `dataSource` |
| `otherParams` | Other environmental parameters (object) | — |

The **Data Receipt Timestamp** (`receivedAt`) is stamped by CIDCO on arrival — you don't send it.
Field names are matched loosely, so you may send the human-readable labels (`"PM2.5"`, `"O₃"`,
`"Station/Device ID"`, `"Data Source / Integration Method"`) directly. If you omit
`siteName`/`location` (typical for a station feed), CIDCO fills them from the Project/Site and
Station IDs.

**multipart/form-data** is also accepted (readings + a signed `document` + repeatable `boardPhotos`
files) for the report-style submission.

**201 Created** — stored in CIDCO's database with a reference number:

```json
{ "success": true, "data": { "report": { "referenceNo": "CIDCO/AQI/2026/00025", "aqiValue": 176, "receivedAt": "..." } } }
```

**Token errors on this endpoint**

| Code | When | What to do |
|------|------|-----------|
| **503** | Access token expired, refresh token still valid (**CASE 2**) | `POST /api/architect/refresh` with your refresh token |
| **503** | Refresh token expired — the pair is dead, whatever the access token says (**CASE 3**) | `POST /api/architect/validate` with your clientId + clientSecret |
| **403** | Request came from a non-whitelisted IP | Ask CIDCO to reset the whitelist |
| **401** | Token missing, unknown or revoked | Re-validate |

Both 503 responses carry a machine-readable hint:

```jsonc
{
  "success": false,
  "error": "Access token has expired. Please request a new access token using your refresh token (POST /api/architect/refresh).",
  "details": { "reason": "ACCESS_EXPIRED", "action": "POST /api/architect/refresh with your refresh token" }
}
```

Nothing is written to CIDCO's database when a send is rejected — resend after renewing.

### Automating the feed (every 3 hours)

Each POST is one reading, so schedule it and the database fills itself. In **Postman**: open the
*Send AQI data* request → **⋯ → Schedule run** (or create a **Monitor**), set the interval to
**every 3 hours**, keep `Authorization: Bearer {{token}}`, and use the dynamic variable
`{{$isoTimestamp}}` for `measuredAt` so each run stamps the current time:

```json
{
  "monitoringStationId": "STN-KHR-07",
  "projectSiteId": "CIDCO-KHR-012",
  "measuredAt": "{{$isoTimestamp}}",
  "aqiValue": 176,
  "pm25": 78.3, "pm10": 152.9, "no2": 41.2, "so2": 12.7, "co": 0.9, "ozone": 48.6,
  "temperature": 33.4, "humidity": 62.1,
  "integrationMethod": "Automated API (3h)"
}
```

Tokens last 7 days, so a 3-hourly monitor keeps running until then — raise a renewal before it
lapses. Any cron/scheduler that can send an HTTP POST works the same way.

---

## 4. Renew the access token (CASE 2)

`POST /api/architect/refresh` — when a data send returns **503 / `ACCESS_EXPIRED`**.

```json
{ "refreshToken": "cidco_ref_..." }
```

```jsonc
{
  "success": true,
  "data": {
    "message": "Access token renewed. Keep using your existing refresh token.",
    "accessToken": "cidco_tok_…",
    "expiresInDays": 7,
    "accessTokenExpiresAt": "...",
    "refreshTokenExpiresAt": "..."
  }
}
```

Update your stored access token and resume sending. **Your refresh token does not change** — keep
using the same one until its own 30-day window closes.

If the refresh token has itself expired this returns **503 / `BOTH_EXPIRED`** — go back to step 1
and validate with your clientId + clientSecret (**CASE 3**).

### Optional: ask CIDCO for a manual re-issue

`POST /api/architect/token-requests` with `{ clientId, clientSecret, reason }` raises a ticket a
CIDCO officer fulfils from the dashboard. Use this only if the automatic refresh above is not
available to you.

### When CIDCO re-issues tokens to you

CIDCO can regenerate tokens from its dashboard at any time and may send you:

| What you receive | What to do |
| ---------------- | ---------- |
| **Both tokens** | Replace both. Your previous pair stops working immediately. |
| **An access token only** | Replace the access token; **keep your existing refresh token**. |
| **A refresh token only** | Replace the refresh token; **keep your existing access token**, so a running feed is not interrupted. |

Whatever you are not given is unchanged and keeps working.

---

## 5. Status & logs

Both accept either `Authorization: Bearer <token>` **or** the headers `x-client-id` and
`x-client-secret` (so you can check status before a token exists).

- `GET /api/architect/status` — handshake state, credential expiry, whether a live token exists,
  pending renewal count.
- `GET /api/architect/logs` — your timestamped trail: every validation, token event and data
  transfer for your handshake.

```
GET /api/architect/logs
x-client-id: ARCH-582397C8A863
x-client-secret: hs_sec_...
```
```json
{ "success": true, "data": { "count": 6, "logs": [
  { "createdAt": "...", "direction": "ARCHITECT_TO_ADMIN", "event": "DATA_RECEIVED", "statusCode": 201 }
] } }
```

---

## Status codes

| Code | Meaning |
|------|---------|
| 200 | Read OK |
| 201 | Data stored / your account created |
| **202** | **Accepted and queued for a CIDCO officer** (validate, token request) |
| 401 | Token missing, unknown or revoked |
| 403 | Request came from a non-whitelisted IP |
| 409 | Handshake not established yet — validate first |
| 422 | Invalid body (see `details` for field errors) |
| **503** | **Token expired** — `ACCESS_EXPIRED` → refresh; `BOTH_EXPIRED` → re-validate |
| 504 | **Handshake validation failed** (CIDCO protocol convention) |

---

## The three cases at a glance

| | Trigger | CIDCO responds | You do |
|---|---|---|---|
| **CASE 1** | First-time setup | **202**, then an officer approves and delivers access + refresh tokens to your dashboard, IP/device whitelisted | Save both, send data every 3 h |
| **CASE 2** | Access token expired | **503** `ACCESS_EXPIRED`, with your unsent reading echoed back | `POST /token-requests` with your refresh token → CIDCO delivers a new access token |
| **CASE 3** | Refresh token expired (access token irrelevant) | **503** `BOTH_EXPIRED` | `POST /validate` with clientId + clientSecret → officer approves → new pair |

---

## curl walk-through

```bash
BASE=http://localhost:3000
CID=ARCH-XXXX; SECRET=hs_sec_XXXX          # from the credential CIDCO sent you

# 1. present your credentials → 202 queued for CIDCO (or 504 if wrong)
curl -s -X POST $BASE/api/architect/validate -H 'content-type: application/json' \
  -d "{\"clientId\":\"$CID\",\"clientSecret\":\"$SECRET\",\"deviceInfo\":\"RaspberryPi-4 | STN-KHR-07\"}"

# 1a. poll until CIDCO approves
curl -s -X POST $BASE/api/architect/handshake-status -H 'content-type: application/json' \
  -d "{\"clientId\":\"$CID\",\"clientSecret\":\"$SECRET\"}"

# 2. once approved, create your own login (details land on the CIDCO dashboard)
curl -s -X POST $BASE/api/architect/register -H 'content-type: application/json' \
  -d "{\"clientId\":\"$CID\",\"clientSecret\":\"$SECRET\",\"email\":\"you@firm.in\",\"password\":\"your-own-password\",\"name\":\"Ar. Your Name\",\"firmName\":\"Your Studio\"}"

# 3. take the access token from /architect → Messages, then send data
TOKEN=cidco_tok_XXXX
curl -s -X POST $BASE/api/architect/data -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"siteName":"Kharghar Sector 12 Site","location":"Kharghar, Navi Mumbai","measuredAt":"2026-08-12T09:30:00Z","aqiValue":168}'

# 4. renewal request when the access token expires (CASE 2)
curl -s -X POST $BASE/api/architect/token-requests -H 'content-type: application/json' \
  -d "{\"clientId\":\"$CID\",\"clientSecret\":\"$SECRET\",\"refreshToken\":\"cidco_ref_XXXX\",\"reason\":\"access token expired\"}"

# 5. your logs, any time
curl -s $BASE/api/architect/logs -H "x-client-id: $CID" -H "x-client-secret: $SECRET"
```
