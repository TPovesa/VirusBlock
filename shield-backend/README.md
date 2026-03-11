# Shield Antivirus — Backend API

## Деплой на VPS (91.233.168.135)

### Шаг 1 — Зайти на сервер по SSH

```bash
ssh vertiggo@91.233.168.135
# пароль: vertiggo
```

### Шаг 2 — Залить файлы на сервер

С твоего компьютера (в папке shield-backend):
```bash
scp -r . vertiggo@91.233.168.135:/home/vertiggo/shield-backend/
```

Или через FileZilla / WinSCP (SFTP):
- Host: 91.233.168.135
- User: vertiggo  
- Password: vertiggo
- Port: 22

### Шаг 3 — Запустить setup (от root)

```bash
su root
bash /home/vertiggo/shield-backend/scripts/setup.sh
```

### Шаг 4 — Запустить API

```bash
cd /home/vertiggo/shield-backend
cp .env.example .env
# отредактируй JWT_SECRET — вставь любую длинную случайную строку
nano .env

npm install
npm start
```

### Шаг 5 — Автозапуск (PM2)

```bash
pm2 startup
pm2 save
```

---

## API эндпоинты

| Метод | URL | Описание |
|-------|-----|----------|
| POST | /api/auth/register | Регистрация |
| POST | /api/auth/login | Логин |
| GET | /api/auth/me | Профиль (токен) |
| POST | /api/scans | Сохранить скан |
| GET | /api/scans | История сканов |
| DELETE | /api/scans | Очистить историю |
| GET | /api/scans/stats/summary | Статистика |
| POST | /api/purchases | Сохранить покупку |
| GET | /api/purchases/active | Проверить Premium |
| GET | /health | Проверить что сервер жив |

## Проверить что работает

```bash
curl http://91.233.168.135:3001/health
```

Должен ответить:
```json
{"status":"ok","service":"Shield Antivirus API","version":"1.0.0"}
```

## Открыть порт в firewall (если не работает)

```bash
ufw allow 3001
ufw reload
```

## Таблицы базы данных

- **users** — пользователи (id, name, email, password_hash, is_premium)
- **scan_sessions** — история сканирований
- **purchases** — покупки Premium
- **threat_reports** — отчёты об угрозах

## Смотреть логи

```bash
pm2 logs shield-api
```
