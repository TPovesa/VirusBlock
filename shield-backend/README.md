# Shield Antivirus — Backend API

## Deploy

```bash
ssh fatalerror@91.233.168.135
cd /home/fatalerror/shield-backend
cp .env.example .env
nano .env
npm install
npm run check
npm run pm2:restart
pm2 save
mysql -u root shield_auth < scripts/schema.sql
```

## Required mail env
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `MAIL_FROM`
- `APP_RESET_URL`
- `VT_API_KEY` for VirusTotal hash lookups
- `AIH_API_KEY` for server-side scan explanations
- optional `AIH_MODEL` to pin a specific upstream model

For Gmail SMTP use:
- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587`
- `SMTP_SECURE=false`
- `SMTP_PASS=<Google app password, not the normal account password>`
- `APP_RESET_URL=shieldsecurity://auth/reset-password`

## Auth API

### Two-step register
- `POST /api/auth/register/start`
- body:
```json
{
  "name": "Fatal Error",
  "email": "user@example.com",
  "password": "secret123",
  "device_id": "android-device-id"
}
```

- `POST /api/auth/register/verify`
- body:
```json
{
  "challenge_id": "...",
  "code": "123456",
  "device_id": "android-device-id"
}
```

### Two-step login
- `POST /api/auth/login/start`
- `POST /api/auth/login/verify`

### Password reset
- `POST /api/auth/password-reset/request`
- body:
```json
{ "email": "user@example.com" }
```

- `POST /api/auth/password-reset/confirm`
- body:
```json
{
  "token": "raw-reset-token",
  "email": "user@example.com",
  "password": "newSecret123"
}
```

## Other API
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/scans/deep/start`
- `GET /api/scans/deep/:id`
- `POST /api/scans`
- `GET /api/scans`
- `DELETE /api/scans`
- `POST /api/ai/explain-scan`
- `POST /api/purchases`
- `GET /api/purchases/active`
- `GET /healths`

## Deep scan API

### Start a deep scan job
- `POST /api/scans/deep/start`
- auth: `Bearer <access_token>`
- body example:
```json
{
  "app_name": "Telegram",
  "package_name": "org.telegram.messenger",
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "installer_package": "com.android.vending",
  "permissions": [
    "android.permission.INTERNET",
    "android.permission.SYSTEM_ALERT_WINDOW"
  ],
  "target_sdk": 34,
  "is_debuggable": false,
  "uses_cleartext_traffic": false
}
```

- response:
```json
{
  "success": true,
  "scan": {
    "id": "uuid",
    "status": "QUEUED",
    "created_at": 1710000000000
  }
}
```

### Poll deep scan status/result
- `GET /api/scans/deep/:id`
- auth: `Bearer <access_token>`
- response contains:
  - `status`: `QUEUED | RUNNING | COMPLETED | FAILED`
  - `verdict`: `clean | low_risk | suspicious | malicious`
  - `risk_score`
  - `summary`
  - `findings`
  - VirusTotal counters when available

Deep scan combines:
- local server heuristics on package metadata, install source, permission combos, debuggable/cleartext flags
- VirusTotal file-hash reputation if `VT_API_KEY` is configured and `sha256` is present
- APK structure checks from the bundled analyzer script
- `YARA` rules for packers, C2 markers, shell execution, dynamic dex loading, root/evasion strings
- `APKiD` fingerprints for packers, obfuscators, and anti-analysis markers when `apkid` is installed
- `Androguard` manifest/DEX analysis for hardcoded endpoints, public IPs, dynamic loaders, shell execution, and accessibility automation markers when installed
- `Quark-Engine` behavior rules when `quark` and its rule set are installed
- archive and native-string heuristics (resource config markers, nested payloads, native endpoint/IP markers)

Deep scan execution is now two-stage:
- Stage 1: metadata + hash reputation for `FULL/SELECTIVE`
- Stage 2: automatic APK enrichment when risk remains suspicious (client upload), plus optional server-side APK fetch by hash if configured

If VirusTotal is not configured, deep scan still runs heuristics and returns a result.

### Optional analyzer setup

```bash
cd /home/fatalerror/shield-backend
chmod +x scripts/setup_analyzers.sh
./scripts/setup_analyzers.sh
```

Then add to `.env`:
- `APK_ANALYZER_PYTHON=/home/fatalerror/shield-backend/.venv-analyzers/bin/python`
- `QUARK_RULES_DIR=/root/.quark-engine/quark-rules`
- `APK_ANALYZER_TIMEOUT_MS=120000`
- optional server-side APK fetch:
  - `DEEP_SCAN_APK_FETCH_URL_TEMPLATE=https://your-apk-source.local/files/{sha256}.apk`
  - `DEEP_SCAN_APK_FETCH_TIMEOUT_MS=12000`
  - `DEEP_SCAN_APK_FETCH_MAX_BYTES=268435456`

## AI scan explain API

- `POST /api/ai/explain-scan`
- auth: `Bearer <access_token>`
- body example:
```json
{
  "summary": {
    "verdict": "suspicious",
    "risk_score": 58
  },
  "result": {
    "findings": [
      {
        "title": "Overlay permission",
        "detail": "Screen overlays are often used for phishing."
      }
    ]
  }
}
```

The backend calls the upstream compatible API at `https://sosiskibot.ru/api/v1/chat/completions` with a bearer key from env, so the Android client never sees the key.

## Health checks
```bash
curl http://91.233.168.135:5001/healths
curl https://sosiskibot.ru/basedata
curl https://sosiskibot.ru/basedata/health
```

## Schema additions
- `email_auth_challenges` — one-time mail codes for login and registration
- `password_reset_tokens` — one-time reset links
- `deep_scan_jobs` — queued deep scan tasks and completed findings

## Logs
```bash
pm2 logs shield-api
```
