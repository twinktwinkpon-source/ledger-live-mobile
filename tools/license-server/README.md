# License Server

Сервер лицензий для Ledger Wallet Desktop.

## Quick Start

```bash
# Установить Node.js 22+ на VPS
# Зайти на сервер
ssh root@94.156.114.31

# Скопировать папку license-server на VPS
# (дальше команды на VPS)

# Установить pm2 глобально
npm install -g pm2

# Запустить сервер
cd /root/license-server
node server.js

# Или через pm2 (автостарт при перезагрузке)
pm2 start server.js --name flex-license-server
pm2 save
pm2 startup
```

## Переменные окружения (опционально)

| Переменная | По умолчанию | Описание |
|-----------|-------------|----------|
| `FLEX_PORT` | `9000` | Порт |
| `FLEX_HOST` | `0.0.0.0` | Хост |
| `FLEX_ADMIN_SECRET` | `flex-dev-2024` | **ОБЯЗАТЕЛЬНО СМЕНИТЬ** на продакшене |
| `FLEX_ENCRYPT_KEY` | SHA256 от "flex-demo-encryption-key" | Ключ шифрования балансов в БД |
| `HWID_SALT` | `ledger-2024` | Соль для HWID-хеша |

## Проверка что сервер работает

```bash
curl http://94.156.114.31:9000/health
# → {"status":"ok","timestamp":...}
```

## Эндпоинты

- `GET /health` — проверка
- `POST /generate-key` — создать ключ (admin)
- `POST /activate` — привязать ключ к HWID
- `POST /validate` — проверить ключ+HWID
- `POST /balances` — получить балансы
- `POST /admin/set-balances` — изменить балансы
- `POST /admin/set-profile` — изменить профиль
- `POST /list-keys` — список ключей (admin)
- `POST /deactivate-key` — деактивировать ключ (admin)
