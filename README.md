# NeuralV Security Platform

NeuralV теперь живёт как единая многоплатформенная линейка поверх общего backend `/basedata`.

## Что в репозитории
- `app/` — Android клиент на Jetpack Compose + Material 3
- `shield-backend/` — Node.js backend, auth, Android deep scans, desktop scan subsystem, release manifest
- `desktop-core/` — shared Kotlin/JVM слой для desktop-клиентов
- `desktop-app/` — Compose Desktop GUI для Windows и Linux
- `shell/` — Linux shell/TUI + resident daemon scaffold на Go
- `web/neuralv/` — responsive MD3 website для `/neuralv/`
- `branding/` — общие brand tokens и logo assets

## Ключевые принципы
- Android `applicationId` остаётся `com.shield.antivirus`, чтобы не ломать обновления.
- Единая авторизация идёт через `/basedata/api/auth`.
- Android deep scan и desktop scans разделены на уровне API и БД.
- Website читает release manifest из `/basedata/api/releases/manifest`.
- Linux shell устанавливается через `curl -fsSL https://neuralvv.org/install/linux.sh | bash`.

## CI/CD
GitHub Actions теперь готовятся собирать:
- Android release APK
- Windows desktop GUI
- Linux desktop GUI
- Linux shell binaries
- Website bundle
- отдельные publish-ветки:
  - `site-builds`
  - `android-builds`
  - `windows-builds`
  - `linux-builds`
- aggregated manifest через `/basedata/api/releases/manifest`

## Сборка
По требованию проекта локальные тяжёлые билды не являются основным путём. Основной путь — GitHub Actions.
