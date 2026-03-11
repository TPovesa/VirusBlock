# Shield Antivirus — Backend API

## Деплой на VPS (91.233.168.135)

### Шаг 1 — Зайти на сервер по SSH

```bash
ssh fatalerror@91.233.168.135
# пароль: fatalerror
```

### Шаг 2 — Залить файлы на сервер

С твоего компьютера (в папке `shield-backend`):
```bash
scp -r . fatalerror@91.233.168.135:/home/fatalerror/shield-backend/
```

Или через FileZilla / WinSCP (SFTP):
- Host: 91.233.168.135
- User: fatalerror
- Password: fatalerror
- Port: 22

### Шаг 3 — Запустить setup (от root)

```bash
su root
bash /home/fatalerror/shield-backend/scripts/setup.sh
```

### Шаг 4 — Запустить API

```bash
cd /home/fatalerror/shield-backend
cp .env.example .env
# отредактируй JWT_SECRET — вставь длинную случайную строку
nano .env

npm install
npm run pm2:start
pm2 save
```

## API эндпоинты

| Метод | URL | Описание |
|-------|-----|----------|
| POST | /api/auth/register | Регистрация |
| POST | /api/auth/login | Логин |
| GET | /api/auth/me | Профиль (токен) |
| POST | /api/auth/refresh | Обновить access token |
| POST | /api/auth/logout | Закрыть текущую сессию |
| POST | /api/scans | Сохранить скан |
| GET | /api/scans | История сканов |
| DELETE | /api/scans | Очистить историю |
| POST | /api/purchases | Сохранить покупку |
| GET | /api/purchases/active | Проверить Premium |
| GET | /healths | Внутренний health check Shield backend |

## Проверить что работает

```bash
curl http://91.233.168.135:5001/healths
curl https://sosiskibot.ru/basedata
curl https://sosiskibot.ru/basedata/health
```

Ожидаемый ответ:
```json
{"status":"ok","service":"Shield Antivirus API","version":"1.0.0"}
```

Публичные маршруты в общем nginx ограничены только `/basedata` и `/basedata/health`, чтобы не затрагивать чужие сервисы под `/api/*`.

## Открыть порт в firewall

```bash
ufw allow 5001/tcp
ufw reload
```

## Таблицы базы данных

- `users` — пользователи и профиль
- `auth_sessions` — refresh-сессии и ревокации
- `login_attempts` — brute-force троттлинг
- `scans` / связанные таблицы — история сканирований
- `purchases` — покупки Premium

## Смотреть логи

```bash
pm2 logs shield-api
```
