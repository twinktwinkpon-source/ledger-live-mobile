# FLEX_DEMO — Руководство администратора и клиента

## Архитектура системы

```
┌──────────────────────────────────────────────────────────┐
│                    ЛИЦЕНЗИОННЫЙ СЕРВЕР                     │
│                   (server/index.js:9000)                  │
│                                                          │
│  data.json — хранилище ключей и балансов                  │
│                                                          │
│  Endpoints:                                              │
│    POST /generate-key    — создать ключ (админ)           │
│    POST /activate        — привязать ключ к HWID          │
│    POST /validate        — проверить ключ                 │
│    POST /balances        — получить балансы               │
│    POST /update-balances — изменить балансы (админ)       │
│    POST /list-keys       — список ключей (админ)          │
│    GET  /health          — проверка сервера               │
└──────────────────────────────────────────────────────────┘
          ▲                              ▲
          │                              │
          │ Админ                        │ Клиент
          │ (manager.ps1)                │ (Ledger Wallet Desktop)
          │                              │
┌─────────┴──────────┐         ┌────────┴───────────────────┐
│  PowerShell CLI    │         │  Electron App             │
│  manager.ps1       │         │                           │
│                    │         │  1. Запуск → checkLicense()│
│  - generate        │         │  2. Нет ключа? → окно      │
│  - list            │         │     активации             │
│  - update          │         │  3. Ввод ключа → /activate│
│  - health          │         │  4. OK → загрузка балансов│
│                    │         │  5. Главный экран         │
└────────────────────┘         └───────────────────────────┘
```

---

## ЧАСТЬ 1. ИНСТРУКЦИЯ ДЛЯ АДМИНИСТРАТОРА

### 1.1. Запуск сервера

```powershell
# Вариант A: через launcher (запускает и сервер, и приложение)
powershell -ExecutionPolicy Bypass -File apps\ledger-live-desktop\server\start-flex.ps1

# Вариант B: только сервер
start /min node apps\ledger-live-desktop\server\index.js

# Проверка что сервер работает
powershell -Command "Invoke-RestMethod http://localhost:9000/health"
```

### 1.2. Создание лицензионного ключа для клиента

```powershell
# Сгенерировать новый ключ с балансами по умолчанию
.\apps\ledger-live-desktop\server\manager.ps1 generate

# Вывод:
# Generated key: FLEX-A1B2-C3D4-E5F6
#
# Balances:
#   bitcoin: 15000000000
#   ethereum: 5000000000000000000000
#   solana: 25000000000000
#   ...
```

### 1.3. Создание ключа с кастомными балансами

```powershell
# Через прямой API-вызов (manager.ps1 генерит дефолтные балансы)
# Для кастомных — используйте curl:

curl -s -X POST http://localhost:9000/generate-key ^
  -H "Content-Type: application/json" ^
  -d "{\"adminSecret\":\"flex-admin-2024\",\"customBalances\":{\"bitcoin\":\"50000000000\",\"ethereum\":\"10000000000000000000000\",\"ton\":\"10000000000000000000\"}}"
```

### 1.4. Просмотр всех ключей

```powershell
.\apps\ledger-live-desktop\server\manager.ps1 list

# Вывод:
# Keys (3):
#
#   FLEX-A1B2-C3D4-E5F6 [ACTIVE] (not activated)
#   FLEX-G7H8-I9J0-K1L2 [ACTIVE] HWID: a1b2c3d4e5f6g7h8... Activated: 2024-07-13T10:30:00Z
#   FLEX-M3N4-O5P6-Q7R8 [DISABLED] HWID: i9j0k1l2m3n4o5p6... Activated: 2024-07-10T15:00:00Z
```

### 1.5. Изменение балансов клиента

```powershell
# Обновить конкретные монеты (остальные остаются как были)
.\apps\ledger-live-desktop\server\manager.ps1 update -Key "FLEX-A1B2-C3D4-E5F6" -Bitcoin "50000000000" -Ton "10000000000000000000"

# Вывод:
# Update: SUCCESS
#
# New balances:
#   bitcoin: 50000000000
#   ethereum: 5000000000000000000000
#   ton: 10000000000000000000
#   ...
```

### 1.6. Проверка статуса ключа

```powershell
# Проверить валидность ключа (нужен HWID клиента)
.\apps\ledger-live-desktop\server\manager.ps1 validate -Key "FLEX-A1B2-C3D4-E5F6" -Hwid "hwid-клиента"

# Получить балансы
.\apps\ledger-live-desktop\server\manager.ps1 balances -Key "FLEX-A1B2-C3D4-E5F6" -Hwid "hwid-клиента"
```

### 1.7. Деактивация ключа

```powershell
# Деактивировать ключ (клиент больше не сможет пользоваться)
.\apps\ledger-live-desktop\server\manager.ps1 deactivate -Key "FLEX-A1B2-C3D4-E5F6"

# Вывод:
# Deactivation: SUCCESS
# Key FLEX-A1B2-C3D4-E5F6 has been disabled.
```

### 1.8. Типичный workflow админа

```
1. Клиент оплачивает доступ
2. Админ: .\manager.ps1 generate                    → получен ключ FLEX-XXXX-XXXX-XXXX
3. Админ: .\manager.ps1 update -Key FLEX-... -Bitcoin "100000000000"   → настроены балансы
4. Админ: .\manager.ps1 list                        → проверка
5. Админ отправляет ключ клиенту
6. Клиент активирует ключ в приложении (ключ привязывается к HWID)
7. Админ: .\manager.ps1 list                        → ключ теперь "activated"
8. При необходимости: .\manager.ps1 update -Key FLEX-... -Ton "..."    → изменить балансы
```

---

## ЧАСТЬ 2. ИНСТРУКЦИЯ ДЛЯ КЛИЕНТА

### 2.1. Получение доступа

1. **Оплатить доступ** у администратора
2. **Получить ключ** вида `FLEX-XXXX-XXXX-XXXX` (16 символов в формате FLEX-AAAA-BBBB-CCCC)
3. **Скачать и запустить** Ledger Wallet Desktop

### 2.2. Запуск приложения

```powershell
# Запуск через launcher (рекомендуется)
powershell -ExecutionPolicy Bypass -File apps\ledger-live-desktop\server\start-flex.ps1

# Или обычный запуск
pnpm dev:lld
```

### 2.3. Активация лицензии

При первом запуске приложение покажет **окно активации лицензии**:

```
┌──────────────────────────────────────┐
│                                      │
│         [Logo Ledger]                │
│                                      │
│        Ledger Wallet                 │
│  Enter your license key to activate  │
│     Ledger Wallet Desktop            │
│                                      │
│  ┌──────────────────────────────────┐│
│  │  FLEX-XXXX-XXXX-XXXX             ││
│  └──────────────────────────────────┘│
│                                      │
│  ┌──────────────────────────────────┐│
│  │       Activate License           ││
│  └──────────────────────────────────┘│
│                                      │
│  Your license is bound to this       │
│  device's hardware. Each key can     │
│  only be used on one machine.        │
│                                      │
└──────────────────────────────────────┘
```

**Действия клиента:**
1. Ввести ключ в поле (автоформатирование: заглавные буквы, дефисы)
2. Нажать **"Activate License"** или Enter
3. При успехе → приложение загружается с балансами
4. При ошибке → красное сообщение (ключ не найден / уже привязан к другому ПК / деактивирован)

### 2.4. Что происходит при активации

```
Клиент вводит ключ
       │
       ▼
Приложение отправляет POST /activate { key, hwid }
       │
       ▼
Сервер проверяет:
  ✓ Ключ существует?
  ✓ Ключ активен?
  ✓ Ключ не привязан к другому HWID?
  ✓ Этот HWID не привязан к другому ключу?
       │
       ▼
Успех → ключ привязан к HWID клиента
       │
       ▼
Приложение получает балансы
       │
       ▼
Главный экран Ledger Wallet с балансами
```

### 2.5. Последующие запуски

При каждом следующем запуске:
1. Приложение берёт сохранённый ключ из локального хранилища
2. Отправляет `POST /validate` для проверки
3. Если ключ валиден → сразу главный экран
4. Если ключ невалиден → снова окно активации

### 2.6. Важно знать

- **Один ключ = один компьютер** (привязка по HWID: CPU + GPU)
- При смене железа нужно обратиться к админу для пересоздания ключа
- Балансы отображаются те, что задал админ
- Ключ хранится в `%APPDATA%/Ledger Wallet/license.json`

---

## ЧАСТЬ 3. СПРАВОЧНИК ПО API

### POST /generate-key (админ)
```json
// Request:
{ "adminSecret": "flex-admin-2024", "customBalances": {"bitcoin": "100000000000"} }

// Response:
{ "key": "FLEX-XXXX-XXXX-XXXX", "balances": {...} }
```

### POST /activate (клиент)
```json
// Request:
{ "key": "FLEX-XXXX-XXXX-XXXX", "hwid": "cpu-gpu-hash" }

// Response (success):
{ "success": true, "balances": {...} }

// Response (error):
{ "error": "Key is already bound to another device" }
```

### POST /validate (клиент, при запуске)
```json
// Request:
{ "key": "FLEX-XXXX-XXXX-XXXX", "hwid": "cpu-gpu-hash" }

// Response:
{ "valid": true }
```

### POST /balances (клиент, для получения балансов)
```json
// Request:
{ "key": "FLEX-XXXX-XXXX-XXXX", "hwid": "cpu-gpu-hash" }

// Response:
{ "balances": {"bitcoin": "15000000000", ...}, "sessionToken": "abc123..." }
```

### POST /update-balances (админ)
```json
// Request:
{ "key": "FLEX-XXXX-XXXX-XXXX", "adminSecret": "flex-admin-2024", "balances": {"ton": "99999999999"} }

// Response:
{ "success": true, "balances": {...} }
```

### POST /list-keys (админ)
```json
// Request:
{ "adminSecret": "flex-admin-2024" }

// Response:
{ "keys": [{"key": "FLEX-...", "active": true, "hwid": "a1b2...", "activatedAt": "..."}] }
```

---

## ЧАСТЬ 4. БЕЗОПАСНОСТЬ

### Текущие меры:
- HWID хешируется (SHA-256) перед отправкой
- Ключ привязывается к хешу HWID, не к raw-значению
- Admin-эндпоинты защищены `adminSecret`
- Ключ хранится в `electron-store` (зашифрованное хранилище Electron)

### Что нужно усилить для продакшена:
- HTTPS вместо HTTP
- JWT-токены вместо статического adminSecret
- Rate limiting на /activate
- База данных вместо JSON-файла
- Подпись балансов на сервере + проверка на клиенте
- Обфускация кода проверки лицензии
- Привязка к времени (ключ истекает через N дней)

---

## ЧАСТЬ 5. РЕШЕНИЕ ПРОБЛЕМ

### "Cannot connect to license server"
- Проверить что сервер запущен: `.\manager.ps1 health`
- Проверить порт 9000 не занят другим процессом

### "Key is already bound to another device"
- Ключ уже активирован на другом ПК
- Решение: админ генерирует новый ключ

### "Key not found"
- Опечатка в ключе
- Ключ был удалён из data.json

### "Key is deactivated"
- Админ деактивировал ключ
- Решение: обратиться к админу

### Балансы не обновляются после изменения админом
- Балансы кэшируются в памяти приложения
- Решение: перезапустить приложение