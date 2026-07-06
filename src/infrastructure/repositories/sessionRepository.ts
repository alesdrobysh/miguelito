import type { Database } from "sql.js";
import type { ConversationStateData, ConversationStateResult, UpdateResult } from "../../domain/types.js";
import type { SessionRepository } from "../../repositories/interfaces.js";
import { SqlRepository, type SaveFn, nowIso, parseSqlUtc } from "./sqlRepository.js";

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, '0'))
  return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10).join('')}`
}

export class SqlSessionRepository extends SqlRepository implements SessionRepository {
  constructor(db: Database, languageId: string, save: SaveFn, userId = 1) {
    super(db, languageId, save, userId);
  }

  async addChatMessage(chatId: number, role: string, content: string, sessionId?: string): Promise<void> {
    this.db.run(
      `INSERT INTO chat_history (user_id, chat_id, role, content, session_id, language) VALUES (?, ?, ?, ?, ?, ?)`,
      [this.userId, chatId, role, content, sessionId ?? null, this.languageId]
    );
    this.save();
  }

  async getSessionTranscript(sessionId: string, limit?: number): Promise<{ role: string; content: string; created_at: string }[]> {
    if (limit && limit > 0) {
      return this.queryAll(
        `SELECT role, content, created_at FROM (
           SELECT id, role, content, created_at FROM chat_history WHERE user_id = ? AND session_id = ? ORDER BY id DESC LIMIT ?
         ) ORDER BY id ASC`,
        [this.userId, sessionId, limit]
      ) as { role: string; content: string; created_at: string }[];
    }
    return this.queryAll(
      `SELECT role, content, created_at FROM chat_history WHERE user_id = ? AND session_id = ? ORDER BY id ASC`,
      [this.userId, sessionId]
    ) as { role: string; content: string; created_at: string }[];
  }

  async getChatHistory(chatId: number, limit?: number): Promise<{ role: string; content: string }[]> {
    if (limit && limit > 0) {
      return this.queryAll(
        `SELECT role, content FROM (
           SELECT id, role, content FROM chat_history WHERE user_id = ? AND chat_id = ? AND language = ? ORDER BY id DESC LIMIT ?
         ) ORDER BY id ASC`,
        [this.userId, chatId, this.languageId, limit]
      ) as { role: string; content: string }[];
    }
    return this.queryAll(
      `SELECT role, content FROM chat_history WHERE user_id = ? AND chat_id = ? AND language = ? ORDER BY id ASC`,
      [this.userId, chatId, this.languageId]
    ) as { role: string; content: string }[];
  }

  async getTodaysMessages(date: string): Promise<{ role: string; content: string; created_at: string }[]> {
    return this.queryAll(
      `SELECT role, content, created_at FROM chat_history WHERE user_id = ? AND date(created_at) = ? AND language = ? ORDER BY id ASC`,
      [this.userId, date, this.languageId]
    ) as { role: string; content: string; created_at: string }[];
  }

  async getConversationState(): Promise<ConversationStateResult> {
    const row = this.queryRow(
      `SELECT * FROM conversation_state WHERE user_id = ? AND language = ? ORDER BY id DESC LIMIT 1`,
      [this.userId, this.languageId]
    ) as ConversationStateData | undefined;

    if (row) {
      const updatedAt = parseSqlUtc(row.updated_at);
      const diffMin = (Date.now() - updatedAt.getTime()) / 60000;
      if (diffMin <= 30) {
        return { session: row, isNew: false };
      }
    }

    const sessionId = uuid();
    const now = nowIso();
    this.db.run(
      `INSERT INTO conversation_state (user_id, session_id, turn_count, last_two_modes, topics_touched, language, started_at, updated_at)
       VALUES (?, ?, 0, '[]', '[]', ?, ?, ?)`,
      [this.userId, sessionId, this.languageId, now, now]
    );
    const rowidResult = this.db.exec("SELECT last_insert_rowid()");
    const newId = rowidResult[0].values[0][0];
    this.save();

    const newSession = this.queryRow(
      `SELECT * FROM conversation_state WHERE id = ?`,
      [newId]
    ) as ConversationStateData;
    return { session: newSession, isNew: true };
  }

  async updateConversationState(
    mode: string,
    topic?: string,
    mood?: string
  ): Promise<UpdateResult> {
    const { session } = await this.getConversationState();

    let lastTwo: string[] = JSON.parse(session.last_two_modes);
    lastTwo.push(mode);
    if (lastTwo.length > 2) lastTwo = lastTwo.slice(-2);

    let topics: string[] = JSON.parse(session.topics_touched);
    if (topic && !topics.includes(topic)) {
      topics.push(topic);
    }

    const now = nowIso();
    this.db.run(
      `UPDATE conversation_state
       SET turn_count = turn_count + 1,
           last_mode = ?,
           last_two_modes = ?,
           topics_touched = ?,
           mood_hint = COALESCE(?, mood_hint),
           updated_at = ?
       WHERE id = ?`,
      [mode, JSON.stringify(lastTwo), JSON.stringify(topics), mood ?? null, now, session.id]
    );
    this.save();

    const updated = this.queryRow(
      `SELECT * FROM conversation_state WHERE id = ?`,
      [session.id]
    ) as ConversationStateData;

    return {
      turn_count: updated.turn_count,
      last_two_modes: JSON.parse(updated.last_two_modes),
      topics_touched: JSON.parse(updated.topics_touched),
    };
  }
}
