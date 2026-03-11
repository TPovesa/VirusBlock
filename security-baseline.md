# Shield Security Baseline

This project uses only legal, public references. No leaked source code or stolen APK internals were used.

## Implemented in this repo now

- `HTTPS-only` Android API traffic with cleartext disabled and a network security config.
- Encrypted local session storage with `EncryptedSharedPreferences`.
- `Access token + refresh token` auth flow with refresh rotation and server-side session revocation.
- Login throttling with DB-backed lock windows.
- Local-first scanner with bundled heuristic rules and optional VirusTotal fallback.
- Nginx reverse proxy design for `/api/*`, `/health`, and `phpMyAdmin` under `/basedata`.

## Recommended next controls

- Play Integrity API attestation before privileged backend actions.
- Hardware-backed key attestation or device binding for sensitive premium/account actions.
- Root/emulator/tamper signals treated as risk inputs, not as a single hard block.
- Signed server-driven threat intel updates for the local scanner.
- Separate admin access path for `/basedata` via SSH tunnel or VPN.

## Official references

- Android security best practices:
  `https://developer.android.com/privacy-and-security/security-best-practices`
- Play Integrity overview:
  `https://developer.android.com/google/play/integrity/overview`
- OWASP MASVS:
  `https://mas.owasp.org/MASVS/`
- OWASP Authentication Cheat Sheet:
  `https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html`
- OWASP Password Storage Cheat Sheet:
  `https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html`
- phpMyAdmin docs:
  `https://docs.phpmyadmin.net/en/latest/`
- Certbot docs:
  `https://eff-certbot.readthedocs.io/en/stable/using.html`

## Legal OSS references worth studying

- Hypatia Android malware scanner:
  `https://github.com/Divested-Mobile/Hypatia`
- APKiD Android/APK fingerprinting:
  `https://github.com/rednaga/APKiD`
- Mobile Verification Toolkit:
  `https://github.com/mvt-project/mvt`
- YARA rules:
  `https://github.com/Yara-Rules/rules`

## Notes on the local scanner

- The current local scanner is intentionally conservative: exact local signature matches win immediately, while heuristic hits are scored from risky permission clusters, suspicious package markers, and untrusted installers.
- VirusTotal is used only as a fallback signal when a local verdict is absent or low-confidence.
- The bundled rule file is at `app/src/main/res/raw/local_threat_intel.json` and is designed to be replaced by a curated signed intel feed later.
