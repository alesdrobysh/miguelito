# Natural Conversation Design

**Date**: 2026-05-22  
**Status**: Approved

## Problem

Miguelito feels rigid and formulaic. Two distinct symptoms:

1. **Rigid facts**: Stored interests (programming, outdoors, karkonosze) are referenced on almost every turn. The user said "cuéntame algo interesante" and got a Karkonosze fact. The user said "no quiero hablar sobre programación" and got redirected to... Karkonosze.

2. **Constant rhythm**: Every response has the same shape — `[acknowledge] + [bolded vocab hook] + [question]`. Same length, same energy, same ending. Conversations with a real person breathe; Miguelito doesn't.

Root causes found in code:
- `## User Interests` is injected verbatim every turn as a labelled list → LLM treats it as a to-do list
- Response palette specifies percentages and a hard rotation rule → algorithmic cycling
- Nearly every mode ends with a hook or question → same shape every turn
- `[CONV_STATE: ...]` text tag is regex-stripped from responses but occasionally leaks into `chat_history`; redundant with `miguelito_turn_annotate` which already runs every turn

## Solution

Approach C: SOUL.md rewrite + targeted code changes.

---

## SOUL.md Changes

### 1. Interests → background context

**Current behaviour**: `## User Interests` section is injected as a list; SOUL.md says "reference naturally when it fits." LLM reads "when it fits" as "whenever I need a hook."

**Change**:
- Rename the injected section header from `## User Interests` to `## Lo que sé de esta persona`
- Replace the SOUL.md instruction with: *"These are things you've picked up about this person. They shape your mental model — they are not conversation topics. Don't reference them unless the person themselves brings up something that genuinely connects. 'Tell me something interesting' means something interesting to you, not something tied to their stored hobbies."*
- Remove the line `"when ## User Interests is in system prompt: reference naturally when it fits"` from the tool directive table

### 2. Response palette — loosen the rules

**Current behaviour**: Modes have percentage targets (`TEACH 30%`, `DIG 20%`, etc.), a hard rotation rule ("never same mode 3 turns in a row"), and nearly every mode mandates a hook or question.

**Changes**:
- Remove the `~%` column from the palette table
- Remove the "never same mode 3 turns in a row" rule; replace with: *"Don't ask 3 questions in a row. Otherwise let the flow dictate."*
- DIG: change "Ends with question" to "Ends with question **if you're genuinely curious**"
- TEACH: change "end with hook" to "end with hook only if there's a natural one"
- Add a note: *"Sometimes your response just lands — you say something and stop. Not every turn needs a hook or a question. This is fine."*
- Add a note: *"Your energy can vary. Not everything is equally interesting. Let that show."*

### 3. Response length

**Current**: `1-4 sentences per turn` (hard cap, uniform).

**Change**: Replace with *"Match the user's register. They send 5 words, you send 1-2 sentences. Tired or brief → shorter. Genuinely engaged → occasionally more. A single-sentence reply is fine."*

### 4. Remove CONV_STATE text tag

**Current**: LLM appends `[CONV_STATE: mode=X, topic=Y, mood=Z]` to every response; `AgentRunner` regex-parses and strips it. The regex is fragile and occasionally leaks into stored chat history.

**Change**: Remove the `[CONV_STATE: ...]` instruction from SOUL.md entirely. Mode tracking moves to the `miguelito_turn_annotate` tool (see code change below).

---

## Code Changes

### 1. `miguelito_turn_annotate` — add `mode` field

**File**: `src/tools/annotate.ts`

Add an optional `mode` field to the tool schema: `"REACT" | "DIG" | "OFFER" | "TEACH" | "PLAY"`. When present, the execute handler calls a new `session.updateConversationMode(mode)` method that updates `last_mode` and `last_two_modes` in `conversation_state`.

Update SOUL.md's tool directive table: replace the separate `[CONV_STATE: ...]` append instruction with adding `mode` to the `miguelito_turn_annotate` call signature.

**Files**: `src/tools/annotate.ts`, `src/infrastructure/db.ts` (new `updateConversationMode` method), `src/repositories/interfaces.ts` (add to `SessionRepository` interface), `SOUL.md`

### 2. `AgentRunner` — remove CONV_STATE regex

**File**: `src/agent/AgentRunner.ts`

Remove `CONV_STATE_PARSE_RE`, `CONV_STATE_STRIP_RE`, the parse-and-strip block, and the intermediate-message strip. The agent loop becomes simpler: accumulate text across tool iterations, return it as-is when tool calls stop.

### 3. `PromptBuilder` — inject interest subset

**File**: `src/agent/PromptBuilder.ts`

In `_buildInjection()`, instead of injecting all interests, shuffle the list and take at most 2. This means the LLM sees at most 2 interests per turn, and the pair rotates across turns — breaking the monotony even if the LLM does reach for what's presented.

Change: `interests.slice(0, 10)` → `shuffle(interests).slice(0, 2)` before building the injected string.

---

## What this does NOT change

- The FSRS vocabulary tracking and scoring system
- The Dream service
- The competency vector / difficulty calibration
- The error logging tools
- The scheduler / cron messages
- Transport layer

## Success criteria

- A "tell me something interesting" prompt produces a language/culture observation rather than a Karkonosze fact
- Three consecutive turns should not all end with a question
- Short user messages ("ping", "qué tal") get short replies
- No `[CONV_STATE: ...]` leaking into stored messages
