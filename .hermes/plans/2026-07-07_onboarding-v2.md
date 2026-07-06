# Onboarding v2 — Miguelito

**Date:** 2026-07-07
**Status:** plan

## Goal

Гладкий онбординг для нового пользователя, который:
- Не требует от LLM «догадаться» вызвать инструменты — профиль сохраняется гарантированно
- Распознаёт неродной язык и переключается на него для мета-инструкций
- Адаптирует первую сессию под уровень (от «полный ноль» до «свободно»)
- Не засоряет новичка пост-обработкой (error detection, learning items) пока нет профиля

---

## Текущая архитектура (контекст)

```
handleMessage()
  ├─ handleCommand()          — /start → formatStart() (статическая строка)
  ├─ processDrillAnswers()
  ├─ processActiveScenario()
  └─ agentRunner.run()        — полный граф: prepare → llm → tools ⇄ llm → post_turn
       ├─ PromptBuilder.build()         — собирает system prompt
       ├─ createTools()                 — регистрирует miguelito_profile_set, interest_add, …
       ├─ callAgentLlm()               — LLM с tools
       ├─ runAgentTools()              — выполняет tool_calls
       └─ scheduleAgentPostTurn()       — PostTurnProcessor (ошибки, learning items, competency)
```

**Ключевые точки:**
- `SqlProfileRepository` — user_id изолирован, `user_profile` отдельная на каждого
- `ensureExternalUser()` — мапит telegram ID → внутренний user_id
- `hasProfile` (PromptBuilder:91) — проверка `name || goal`, управляет впрыском `learnerProfileUnconfigured`
- PostTurnProcessor — всегда отрабатывает после ответа (если не cron/proactive)

---

## Что случилось с Яном (id=13)

| Шаг | Ожидание | Реальность |
|-----|----------|------------|
| `/start` | Онбординг через LLM | Статическая строка `formatStart` |
| `Soy Jan` | `miguelito_profile_set(name=Jan)` | LLM спросил goal+correction, **не вызвал инструмент** |
| `Viajes` | `miguelito_profile_set(goal=viajes)` | LLM: «Ya tengo configurado tu perfil» — **ложь**, профиль пуст |
| `Я ні бэ ні мэ` | Распознать русский, переключиться | Ответ на испанском, пользователь не понял |

**Итог:** 10 сообщений, профиль не сохранён, пользователь дезориентирован.

---

## Дизайн

### Состояния онбординга

Новый столбец в `user_profile`: `onboarding_phase TEXT` (NULL = completed).

| Фаза | Название | Что делает бот |
|------|----------|----------------|
| 1 | `greet` | Детектит язык приветствия. Если не испанский — отвечает на нём же. Объясняет, кто он. |
| 2 | `name` | Спрашивает имя → `miguelito_profile_set(name=...)` |
| 3 | `goal` | Спрашивает цель → `miguelito_profile_set(goal=...)` |
| 4 | `level` | Быстрая оценка уровня: просит сказать что-нибудь по-испански. Сохраняет наблюдение в dream memory. |
| done | `null` | Переход в обычный режим |

### Механика

**1. Системный промпт для онбординга** — отдельный `promptText.onboarding` в `LanguageConfig`:

```
## Onboarding mode
Eres Miguelito, tutor de español por software. Estás en modo onboarding — 
el usuario es nuevo y necesita configurar su perfil.

Reglas:
1. Si el usuario escribe en un idioma que no es español (inglés, ruso, etc.), 
   responde en ESE idioma para las instrucciones. El español lo usas solo 
   para ejemplos y práctica.
2. NO preguntes todo de golpe. Una pregunta por turno.
3. Después de cada respuesta del usuario, guarda el dato inmediatamente 
   con miguelito_profile_set. NO digas "ya guardé" sin haber llamado la herramienta.
4. Fase actual: {onboarding_phase}. 
   - Si es "greet": preséntate brevemente y pregunta el nombre.
   - Si es "name": guarda el nombre y pregunta el objetivo.
   - Si es "goal": guarda el objetivo y evalúa el nivel.
   - Si es "level": guarda observación, muestra resumen del perfil, 
     y di que la conversación normal empieza ahora.
5. Sé cálido pero breve (1-3 frases). No finjas ser humano.
```

**2. Роутинг в `handleCommand`:**

```typescript
// /start → не статика, а вход в LLM с onboarding-промптом
if (commandToken === "/start") {
  await db.setOnboardingPhase("greet");
  return undefined; // проваливается в agentRunner.run()
}
```

**3. Роутинг в `handleMessage`:**

```typescript
const profile = await db.getProfile();
const phase = profile?.onboarding_phase ?? null;
if (phase) {
  // В онбординге: не запускаем drill/scenario/post_turn
  const result = await agentRunner.run(text, history, { 
    sourceType: "onboarding",
    onboardingPhase: phase 
  });
  // После ответа: продвигаем фазу, если LLM вызвал profile_set
  await advanceOnboardingPhase(db, phase);
  return result.text;
}
```

**4. `advanceOnboardingPhase`:**

```typescript
const PHASE_ORDER = ["greet", "name", "goal", "level", null];

async function advanceOnboardingPhase(db: BuddyDb, current: string) {
  const idx = PHASE_ORDER.indexOf(current);
  const next = PHASE_ORDER[idx + 1];
  if (next) {
    await db.setOnboardingPhase(next);
  } else {
    await db.clearOnboardingPhase(); // → null, onboarding done
  }
}
```

**5. PromptBuilder — впрыск фазы онбординга:**

```typescript
// В _buildInjection:
const profile = await this.repos.profile.getProfile();
const onboardingPhase = profile?.onboarding_phase ?? null;

if (onboardingPhase && options.sourceType !== "cron" && options.sourceType !== "proactive") {
  // Подменяем languageBlock на onboarding-промпт
  fullSystem = this.lang.promptText.onboarding(onboardingPhase);
  // Пропускаем: learnerProfile, calibration, interests, dreamMemory, openerPolicy
  // HE запускаем post_turn
}
```

**6. AgentRunner — режим без post_turn:**

```typescript
function shouldRunPostTurn(state, options) {
  if (options.sourceType === "onboarding") return false;
  // ... остальная логика
}
```

**7. `formatStart` — удаляется.** `/start` больше не хардкод.

---

### Файлы, которые меняются

| Файл | Изменение |
|------|-----------|
| `src/languages/LanguageConfig.ts` | + `onboarding: (phase: string) => string` в `promptText` |
| `src/languages/spanish/config.ts` | + onboarding prompt |
| `src/infrastructure/schema.ts` | + `onboarding_phase TEXT` в `user_profile` |
| `src/infrastructure/migrations.ts` | + миграция ALTER TABLE |
| `src/infrastructure/repositories/profileRepository.ts` | + `setOnboardingPhase` / `clearOnboardingPhase` |
| `src/repositories/interfaces.ts` | + методы в `ProfileRepository` |
| `src/infrastructure/db.ts` | + делегаты |
| `src/agent/PromptBuilder.ts` | + впрыск onboarding-промпта вместо обычного, + `onboardingPhase` в `PromptBuildOptions` |
| `src/agent/AgentRunner.ts` | + `sourceType === "onboarding"` → skip post_turn |
| `src/runtime.ts` | + логика онбординга в `handleMessage`, удалить `formatStart`, `/start` → установка фазы + провал в agent |
| `src/runtime.test.ts` | + тесты на onboarding flow |
| `src/domain/types.ts` | + `onboarding_phase` в `UserProfile` |

---

### Что НЕ делаем

- **НЕ добавляем state machine framework.** Пять фаз, линейный порядок — `advanceOnboardingPhase` с массивом достаточно.
- **НЕ делаем «пропуск фазы» черезLLM.** Если пользователь в первом сообщении сказал «Меня зовут Ян, учу для путешествий» — LLM может вызвать `miguelito_profile_set` с обоими полями за один вызов. `advanceOnboardingPhase` смотрит на факт вызова, а не на количество полей.
- **НЕ добавляем новый провайдер/модель.** Онбординг идёт через основной chat model.
- **НЕ меняем `/import`, `/drill`, etc.** — они недоступны пока `onboarding_phase != null` (можно добавить `"Сначала давай настроим профиль"`).

---

### Сценарий: Ян (полный ноль, русский)

```
User: /start
Bot:  Привет! Я Мигелито, твой tutor по испанскому. 
      Буду помогать тебе учить язык через обычное общение.
      Для начала — как тебя зовут?

User: Ян
Bot:  [miguelito_profile_set(name="Ян")] → ok
      Приятно, Ян! Расскажи, зачем тебе испанский? 
      (путешествия, работа, учёба, просто интересно)

User: Путешествия
Bot:  [miguelito_profile_set(goal="viajes")] → ok
      Отлично! А теперь небольшой вопрос: можешь сказать 
      что-нибудь по-испански? Хотя бы «hola» или «gracias»?

User: Вообще ничего не знаю
Bot:  Понял, начнём с нуля — это нормально!
      [сохраняет наблюдение в dream memory]
      Готово! Твой профиль: Ян, цель — viajes.
      Теперь просто общаемся.
      
      Hola, Yan. ¿Listo para empezar?
```

### Сценарий: Мария (средний уровень, испанский)

```
User: /start
Bot:  ¡Hola! Soy Miguelito, tu tutor de español. 
      Para empezar, ¿cómo te llamas?

User: Me llamo María, quiero mejorar mi español para el trabajo
Bot:  [miguelito_profile_set(name="María", goal="trabajo")] → ok
      ¡Perfecto, María! Para calibrar un poco: ¿puedes describir 
      tu trabajo en un par de frases en español?

User: Trabajo en una empresa de tecnología, soy programadora
Bot:  [сохраняет наблюдение в dream memory]
      Listo. María, objetivo trabajo, nivel intermedio.
      
      ¿Qué tipo de proyectos haces? Así puedo ayudarte mejor.
      [ → переход в обычный режим]
```

---

### План изменений (по шагам)

1. **Миграция БД** — `ALTER TABLE user_profile ADD COLUMN onboarding_phase TEXT`
2. **Методы репозитория** — `setOnboardingPhase`, `clearOnboardingPhase`, `getOnboardingPhase`
3. **Onboarding prompt** — в `spanish/config.ts`, поле `promptText.onboarding`
4. **PromptBuilder** — впрыск onboarding-промпта когда фаза не null
5. **AgentRunner** — sourceType `"onboarding"` пропускает post_turn
6. **handleCommand** — `/start` ставит фазу `"greet"`, возвращает `undefined` (провал в agent)
7. **handleMessage** — детект onboarding-фазы, вызов `advanceOnboardingPhase`
8. **Удалить `formatStart`**
9. **Тесты** — новый файл `src/onboarding.test.ts`
10. **Сборка, прогон тестов, рестарт сервиса**

---

### Риски

- **LLM игнорирует фазу.** Даже с явным промптом «ты в фазе greet» модель может ответить не по плану. Митигация: фаза — мягкая подсказка, а не жёсткий стейт-машина. Если пользователь ответил на все вопросы в первом сообщении, LLM может сохранить всё сразу.
- **Язык детекта.** Нет отдельного language-detection вызова. Полагаемся на LLM: «si el usuario escribe en otro idioma, responde en ese idioma». Для Gemini Flash это надёжно.
- **Гонка фаз.** Если LLM вызывает profile_set с несколькими полями, `advanceOnboardingPhase` продвинет фазу только на 1 шаг. Это нормально — следующая итерация увидит, что поля уже заполнены, и тоже продвинется.
