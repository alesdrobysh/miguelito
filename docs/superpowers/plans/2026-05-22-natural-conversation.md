# Natural Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Miguelito feel less like a bot running a formula and more like a person — varied rhythm, variable energy, interests used as background context rather than hooks.

**Architecture:** Four focused changes: (1) wire `session` into `ToolContext` so the annotate tool can update conversation state; (2) add `mode` to `miguelito_turn_annotate` and remove the fragile CONV_STATE text tag; (3) shuffle and cap interest injection in `PromptBuilder`; (4) rewrite the relevant SOUL.md sections.

**Tech Stack:** TypeScript, vitest, sql.js, SOUL.md prompt engineering

---

### Task 1: Add `session` to `ToolContext` and wire it up

**Files:**
- Modify: `src/tools/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add `session` to `ToolContext` interface**

In `src/tools/index.ts`, add the import and field:

```typescript
import type { VocabRepository, ErrorRepository, ProfileRepository, InterestRepository, CompetencyRepository, SessionRepository } from "../repositories/interfaces.js";
import type { LLMProvider } from "../providers/interfaces.js";
// ... rest of imports unchanged

export interface ToolContext {
  vocab: VocabRepository;
  errors: ErrorRepository;
  profile: ProfileRepository;
  interests: InterestRepository;
  competency: CompetencyRepository;
  session: SessionRepository;
  provider: LLMProvider | null;
}
```

- [ ] **Step 2: Pass `session: db` when creating `toolCtx` in `src/index.ts`**

```typescript
const toolCtx = { vocab: db, errors: db, profile: db, interests: db, competency: db, session: db, provider };
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/tools/index.ts src/index.ts
git commit -m "feat: add session to ToolContext"
```

---

### Task 2: Add `mode` field to `miguelito_turn_annotate`

**Files:**
- Modify: `src/tools/annotate.ts`
- Create: `src/tools/annotate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tools/annotate.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "../infrastructure/db.js";
import { createAnnotateTools } from "./annotate.js";
import type { ToolContext } from "./index.js";

let db: BuddyDb;
let tmpDir: string;
let ctx: ToolContext;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-ann-test-"));
  db = await BuddyDb.open(path.join(tmpDir, "test.db"));
  ctx = { vocab: db, errors: db, profile: db, interests: db, competency: db, session: db, provider: null };
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("miguelito_turn_annotate mode tracking", () => {
  it("records mode in conversation state when provided", async () => {
    const [annotate] = createAnnotateTools(ctx);

    await annotate.execute({
      obligatory: "[]",
      used: "[]",
      naturalness: "1.0",
      comprehension: "smooth",
      mode: "REACT",
    });

    const { session } = await db.getConversationState();
    const lastTwo: string[] = JSON.parse(session.last_two_modes);
    expect(lastTwo).toContain("REACT");
  });

  it("does not error when mode is omitted", async () => {
    const [annotate] = createAnnotateTools(ctx);

    await expect(
      annotate.execute({
        obligatory: "[]",
        used: "[]",
        naturalness: "1.0",
        comprehension: "smooth",
      })
    ).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/tools/annotate.test.ts
```

Expected: FAIL — `mode` is not a recognised arg, so conversation state is unchanged.

- [ ] **Step 3: Add `mode` to `miguelito_turn_annotate` in `src/tools/annotate.ts`**

Add `mode` to the tool's `parameters` schema (after `had_subordination`):

```typescript
mode: {
  type: "string",
  description: "Which response mode you used this turn: REACT | DIG | OFFER | TEACH | PLAY",
},
```

In the `execute` handler, after the existing logic and before `return {}`, add:

```typescript
const mode = (args.mode ?? "").trim();
const validModes = new Set(["REACT", "DIG", "OFFER", "TEACH", "PLAY"]);
if (validModes.has(mode)) {
  await ctx.session.updateConversationState(mode);
}
```

This requires `ctx` to include `session`. Since `ToolContext` now has `session` (Task 1), update the function signature in `annotate.ts`:

```typescript
import type { ToolContext } from "./index.js";

function turnAnnotate(ctx: ToolContext) {
  // ... rest unchanged
```

The existing signature already uses `ToolContext` from `./index.js` — just verify the import is there. The full updated `execute` body:

```typescript
execute: async (args: Record<string, string>) => {
  let rawObligatory: Array<{ type?: string }> = [];
  try {
    const parsed = JSON.parse(args.obligatory ?? "[]");
    if (Array.isArray(parsed)) rawObligatory = parsed;
  } catch {}
  const obligatory: ObligatoryContext[] = rawObligatory
    .filter((o) => o?.type && VALID_CATEGORIES.has(o.type))
    .map((o) => ({ type: (VALID_CATEGORIES.has(o.type!) ? o.type! : "other") as ErrorCategory }));

  let used: string[] = [];
  try {
    const parsed = JSON.parse(args.used ?? "[]");
    if (Array.isArray(parsed)) used = parsed.map(String);
  } catch {}

  const rawNaturalness = parseFloat(args.naturalness ?? "");
  const naturalness = isNaN(rawNaturalness) ? 1.0 : Math.max(0, Math.min(1, rawNaturalness));

  const rawComprehension = (args.comprehension ?? "smooth").trim();
  const validComprehension = new Set(["smooth", "asked_clarify", "requested_simpler"]);
  const comprehension = validComprehension.has(rawComprehension)
    ? (rawComprehension as "smooth" | "asked_clarify" | "requested_simpler")
    : "smooth";

  const tunit_length = Math.max(1, Math.round(parseFloat(args.tunit_length ?? "1") || 1));
  const had_subordination = args.had_subordination === "true" || args.had_subordination === "1";

  await ctx.competency.insertTurnAnnotation({
    obligatory,
    used: used.map(String),
    naturalness,
    comprehension,
    tunit_length,
    had_subordination,
  });

  const mode = (args.mode ?? "").trim();
  const validModes = new Set(["REACT", "DIG", "OFFER", "TEACH", "PLAY"]);
  if (validModes.has(mode)) {
    await ctx.session.updateConversationState(mode);
  }

  return {};
},
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/tools/annotate.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/tools/annotate.ts src/tools/annotate.test.ts
git commit -m "feat: add mode field to miguelito_turn_annotate"
```

---

### Task 3: Remove CONV_STATE from `AgentRunner`

**Files:**
- Modify: `src/agent/AgentRunner.ts`

- [ ] **Step 1: Remove the two regex constants and the parse-and-strip block**

Remove these lines entirely from the top of the file (around lines 27-28):

```typescript
const CONV_STATE_PARSE_RE = /\[CONV_STATE:\s*(?:mode=)?(REACT|DIG|OFFER|TEACH|PLAY)(?:[,\s]+(?:topic=)?([^,\]\n]+?))?(?:[,\s]+(?:mood=)?([^\]\n]+?))?\s*\]/;
const CONV_STATE_STRIP_RE = /\s*\[CONV_STATE:[^\]]*\]/g;
```

In the agent loop's final-message branch (where `result.toolCalls.length === 0`), replace:

```typescript
if (result.toolCalls.length === 0) {
  const match = totalText.match(CONV_STATE_PARSE_RE);
  if (match) {
    const mode = match[1];
    const topic = match[2]?.trim() || undefined;
    const mood = match[3]?.trim() || undefined;
    await session.updateConversationState(mode, topic, mood);
    log.debug({ mode, topic, mood }, 'conv state parsed');
  }
  totalText = totalText.replace(CONV_STATE_STRIP_RE, "").trim();
  break;
}
```

With:

```typescript
if (result.toolCalls.length === 0) {
  break;
}
```

Remove the intermediate-message strip as well. The push to `messages` becomes:

```typescript
messages.push({
  role: "assistant",
  content: result.content ?? "",
  tool_calls: result.toolCalls,
});
```

The full updated `run` method body (note `session` removed from destructuring — it is no longer used inside `run`, though `AgentDeps.session` stays in the interface):

```typescript
async run(userMessage: string, chatHistory: ChatMessage[]): Promise<AgentResult> {
  const { provider, promptBuilder, toolCtx, soulPath, dreamMemoryPath } = this.deps;

  const fullSystem = await promptBuilder.build(soulPath, dreamMemoryPath);

  const messages: ChatMessage[] = [
    { role: "system", content: fullSystem },
    ...chatHistory,
    { role: "user", content: userMessage },
  ];

  const tools = createTools(toolCtx);
  const openaiTools = toolsToOpenAI(tools);

  let totalText = "";
  let toolCallsMade = 0;
  let i = 0;

  for (; i < MAX_TOOL_ITERATIONS; i++) {
    log.debug({ iter: i, maxIters: MAX_TOOL_ITERATIONS, toolCount: openaiTools.length }, 'llm call start');

    const result = await provider.chat(messages, openaiTools, { temperature: 0.7, maxTokens: 4096 });

    if (result.content) {
      totalText += result.content;
    }

    if (result.toolCalls.length === 0) {
      break;
    }

    messages.push({
      role: "assistant",
      content: result.content ?? "",
      tool_calls: result.toolCalls,
    });

    const toolCalls = result.toolCalls.map((tc) => callTool(tc, tools));
    const toolResults = await Promise.all(toolCalls);
    messages.push(...toolResults);
    toolCallsMade += toolResults.filter((tr) => tr.toolCalled).length;
  }

  log.info({ totalIters: i + 1, toolCallsMade, responseLength: totalText.length }, 'run complete');

  return { text: totalText, toolCallsMade };
}
```

Note: the `session` import in `AgentRunner` is still used by `AgentDeps` — leave `AgentDeps.session` in place for future use. Just remove the `session.updateConversationState` call inside `run`.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/agent/AgentRunner.ts
git commit -m "refactor: replace CONV_STATE text tag with annotate tool mode field"
```

---

### Task 4: Shuffle and cap interest injection in `PromptBuilder`

**Files:**
- Modify: `src/agent/PromptBuilder.ts`
- Create: `src/agent/PromptBuilder.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/agent/PromptBuilder.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { BuddyDb } from "../infrastructure/db.js";
import { PromptBuilder } from "./PromptBuilder.js";

let db: BuddyDb;
let tmpDir: string;
let soulPath: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "miguelito-pb-test-"));
  db = await BuddyDb.open(path.join(tmpDir, "test.db"));
  soulPath = path.join(tmpDir, "SOUL.md");
  fs.writeFileSync(soulPath, "# Soul");
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("PromptBuilder interest injection", () => {
  it("injects at most 2 interests when more are stored", async () => {
    for (const i of ["programming", "hiking", "karkonosze", "cooking", "music"]) {
      await db.addInterest(i, "conversation", 0.7);
    }

    const builder = new PromptBuilder({ vocab: db, errors: db, profile: db, interests: db, competency: db, session: db });
    const prompt = await builder.build(soulPath);

    const stored = ["programming", "hiking", "karkonosze", "cooking", "music"];
    const found = stored.filter((i) => prompt.toLowerCase().includes(i));
    expect(found.length).toBeLessThanOrEqual(2);
  });

  it("uses the renamed section header", async () => {
    await db.addInterest("programming", "conversation", 0.7);

    const builder = new PromptBuilder({ vocab: db, errors: db, profile: db, interests: db, competency: db, session: db });
    const prompt = await builder.build(soulPath);

    expect(prompt).toContain("Lo que sé de esta persona");
    expect(prompt).not.toContain("## User Interests");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/agent/PromptBuilder.test.ts
```

Expected: FAIL — currently injects all interests with old header.

- [ ] **Step 3: Add `shuffleArray` helper and update `_buildInjection` in `src/agent/PromptBuilder.ts`**

Add the helper function at the bottom of the file (before or after `formatProfile`):

```typescript
function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
```

In `_buildInjection`, replace:

```typescript
const interests = await this.repos.interests.listInterests(10);
const userInterests = interests.length > 0
  ? `\n\n## User Interests\n${interests.join(", ")}`
  : null;
```

With:

```typescript
const interests = await this.repos.interests.listInterests(10);
const subset = shuffleArray(interests).slice(0, 2);
const userInterests = subset.length > 0
  ? `\n\n## Lo que sé de esta persona\n${subset.join(", ")}`
  : null;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/agent/PromptBuilder.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/agent/PromptBuilder.ts src/agent/PromptBuilder.test.ts
git commit -m "feat: shuffle and cap interest injection at 2 per turn"
```

---

### Task 5: Update SOUL.md

**Files:**
- Modify: `SOUL.md`

- [ ] **Step 1: Remove interest reference instruction from Behavior & tone**

Find and remove this line from the `## Behavior & tone` section:

```
- When `## User Interests` is in system prompt: reference naturally when it fits, never list them back.
```

Replace it with:

```
- When `## Lo que sé de esta persona` is in system prompt: these are things you know about this person — they inform your mental model, not your script. Don't reference them unless the person themselves brings up something that genuinely connects. "Tell me something interesting" means something that interests *you*, not a topic from this list.
```

- [ ] **Step 2: Update the `miguelito_turn_annotate` row in the tool directive table**

Find:

```
| After replying | Call `miguelito_turn_annotate(obligatory, used, comprehension, naturalness?, tunit_length?, had_subordination?)`. `obligatory` = grammatical/morphological constructions the user was required to handle this turn; `comprehension` = how the user responded to **your previous** turn (smooth/asked_clarify/requested_simpler); `naturalness` = 0–1 idiomaticity of the user's production (omit if they wrote very little). Then append `[CONV_STATE: mode, topic?, mood?]` at end of your response |
```

Replace with:

```
| After replying | Call `miguelito_turn_annotate(obligatory, used, comprehension, naturalness?, tunit_length?, had_subordination?, mode)`. `obligatory` = grammatical/morphological constructions the user was required to handle this turn; `comprehension` = how the user responded to **your previous** turn (smooth/asked_clarify/requested_simpler); `naturalness` = 0–1 idiomaticity of the user's production (omit if they wrote very little); `mode` = which mode you used this turn (REACT/DIG/OFFER/TEACH/PLAY). |
```

- [ ] **Step 3: Update the Response palette table — remove percentages, loosen rules**

Find the entire palette table and the line after it:

```
Every turn, pick ONE mode — never the same mode 3 turns in a row (check `last_two_modes`).

| Mode | When | Action | ~% |
|---|---|---|---|
| **REACT** | User shared/expressed | Acknowledge, mirror. No correction, no question. | 25% |
| **DIG** | Something interesting left unexamined | Ask a follow-up. No correction. Ends with question. | 20% |
| **OFFER** | Natural moment for colour | Cultural note, etymology, language contrast. No question. | 15% |
| **TEACH** | Error worth fixing | Inline "→ **X**", brief explain, end with hook. | 30% |
| **PLAY** | Light/joking moment | Playful, gentle tease. | 5% |

Corrections only in TEACH. When in doubt, REACT. Don't correct the same error category twice per session. Mood-sensitive: tired/frustrated → skip TEACH; playful → more PLAY; energetic → DIG.
```

Replace with:

```
Every turn, pick ONE mode.

| Mode | When | Action |
|---|---|---|
| **REACT** | User shared/expressed | Acknowledge, mirror. No correction, no question. |
| **DIG** | Something interesting left unexamined | Ask a follow-up if genuinely curious. No correction. |
| **OFFER** | Natural moment for colour | Cultural note, etymology, language contrast. No question. |
| **TEACH** | Error worth fixing | Inline "→ **X**", brief explain, hook only if it's natural. |
| **PLAY** | Light/joking moment | Playful, gentle tease. |

Corrections only in TEACH. When in doubt, REACT. Don't correct the same error category twice per session. Don't ask 3 questions in a row — otherwise let the flow dictate. Mood-sensitive: tired/frustrated → skip TEACH; playful → more PLAY; energetic → DIG.

Sometimes your response just lands — you say something and stop. Not every turn needs a hook or a question. Your energy can vary; not everything is equally interesting — let that show.
```

- [ ] **Step 4: Update the response length instruction in Behavior & tone**

Find:

```
- Casual, warm, a little playful. España neutral. 1-4 sentences per turn.
```

Replace with:

```
- Casual, warm, a little playful. España neutral. Match the user's register: short message → 1-2 sentences; tired or brief → shorter; genuinely engaged → occasionally more. A single sentence is fine.
```

- [ ] **Step 5: Commit**

```bash
git add SOUL.md
git commit -m "feat: rewrite SOUL.md for natural conversation rhythm"
```

---

### Task 6: Deploy to the phone

Use the current Termux boot-script deployment workflow.
