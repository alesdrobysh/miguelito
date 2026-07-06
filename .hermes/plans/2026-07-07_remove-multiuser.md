# Remove multi-user — Miguelito

**Date:** 2026-07-07
**Status:** plan

## Goal

Убрать мультиюзерную логику. Miguelito всегда один пользователь (userId=1). 
`user_id` колонки в БД остаются (дефолт 1), менять 200+ SQL-запросов не будем.

## Что убираем

### Логика (6 файлов)

| Файл | Что |
|------|-----|
| `infrastructure/db.ts` | `ensureExternalUser()`, `withUserId()`, параметр `userId` в конструкторе |
| `runtime.ts` | `runtimeForExternalUser()`, `userRuntimes`, `PHASE_ORDER_NEXT`, onboarding |
| `transport/TelegramTransport.ts` | `allowedUsers`, `isUserAllowed()` |
| `infrastructure/config.ts` | поле `allowedUsers`, парсинг `ALLOWED_USERS` |
| `app/startup.ts` | параметр `allowedUsers` при создании транспорта |
| `app/startup.test.ts` | мок `allowedUsers` |

### БД (2 файла)

| Файл | Что |
|------|-----|
| `infrastructure/schema.ts` | `users` table (CREATE + INSERT OR IGNORE) |
| `infrastructure/migrations.ts` | `migrateUsers()`, `USER_SCOPED_TABLES` |

### Рантайм-конфиг (1 файл)

| Файл | Что |
|------|-----|
| `$PREFIX/var/service/miguelito/run` | `export ALLOWED_USERS='...'` |

### Тесты (1 файл)

| Файл | Что |
|------|-----|
| `userIsolation.test.ts` | удалить целиком |

## Что НЕ трогаем

- `user_id` колонки во всех таблицах (остаются `DEFAULT 1`)
- Все SQL-запросы с `WHERE user_id = ?` (используют userId=1, работают)
- `SqlRepository.userId` (остаётся 1)
- Репозитории (profile, error, session, learning, competency, interest) — без изменений
- `CostTrackingProvider` — `userId: db.userId` (всегда 1)

## Пошагово

1. `db.ts`: удалить `ensureExternalUser`, `withUserId`, сделать `userId = 1` константой
2. `runtime.ts`: удалить `runtimeForExternalUser`, `userRuntimes`, `advanceOnboardingPhase`, `PHASE_ORDER_NEXT`, onboarding-логику
3. `TelegramTransport.ts`: удалить `allowedUsers`, `isUserAllowed`
4. `config.ts`: удалить `allowedUsers`, парсинг `ALLOWED_USERS`
5. `app/startup.ts`: удалить `allowedUsers` из конфига транспорта
6. `schema.ts`: удалить `users` table
7. `migrations.ts`: удалить `migrateUsers()`, `USER_SCOPED_TABLES`
8. Рантайм: убрать `ALLOWED_USERS` из `run` скрипта
9. Удалить `userIsolation.test.ts`
10. Пофиксить сломавшиеся тесты
11. Сборка, тесты, рестарт

## Риски

- `runtimeForExternalUser` использовался для изоляции Telegram-пользователей. После удаления все идут через базовый runtime (userId=1). История сообщений, профиль, ошибки — всё пишется в одного пользователя. **Это то, что нам нужно.**
- Тесты используют `"telegram-user"` как userId — этот путь (`!externalUserId || externalUserId === "telegram-user"`) возвращал base runtime, так что поведение не меняется.
- `onboarding_phase` — колонка остаётся в схеме, но логика онбординга выпиливается из runtime.ts. Онбординг и так свёрнут до 1 фазы, разницы нет.
