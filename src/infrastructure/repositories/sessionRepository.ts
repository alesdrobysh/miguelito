import type { Database } from "sql.js";
import type { ConversationStateData, ConversationStateResult, UpdateResult } from "../../domain/types.js";
import type { SessionRepository } from "../../repositories/interfaces.js";
import { SqlRepository, type SaveFn, nowIso, parseSqlUtc } from "./sqlRepository.js";

export class SqlSessionRepository extends SqlRepository implements SessionRepository {
  constructor(db: Database, languageId: string, save: SaveFn) {
    super(db, languageId, save);
  }

  async addChatMessage(chatId: number, role: string, content: string, sessionId?: string): Promise<void> {
    this.db.run(
      `INSERT INTO chat_history (chat_id, role, content, session_id, language) VALUES (?, ?, ?, ?, ?)`,
      [chatId, role, content, sessionId ?? null, this.languageId]
    );
    this.save();
  }

  async getSessionTranscript(sessionId: string, limit?: number): Promise<{ role: string; content: string; created_at: string }[]> {
    if (limit && limit > 0) {
      return this.queryAll(
        `SELECT role, content, created_at FROM (
           SELECT id, role, content, created_at FROM chat_history WHERE session_id = ? ORDER BY id DESC LIMIT ?
         ) ORDER BY id ASC`,
        [sessionId, limit]
      ) as { role: string; content: string; created_at: string }[];
    }
    return this.queryAll(
      `SELECT role, content, created_at FROM chat_history WHERE session_id = ? ORDER BY id ASC`,
      [sessionId]
    ) as { role: string; content: string; created_at: string }[];
  }

  async getChatHistory(chatId: number, limit?: number): Promise<{ role: string; content: string }[]> {
    if (limit && limit > 0) {
      return this.queryAll(
        `SELECT role, content FROM (
           SELECT id, role, content FROM chat_history WHERE chat_id = ? AND language = ? ORDER BY id DESC LIMIT ?
         ) ORDER BY id ASC`,
        [chatId, this.languageId, limit]
      ) as { role: string; content: string }[];
    }
    return this.queryAll(
      `SELECT role, content FROM chat_history WHERE chat_id = ? AND language = ? ORDER BY id ASC`,
      [chatId, this.languageId]
    ) as { role: string; content: string }[];
  }

  async getTodaysMessages(date: string): Promise<{ role: string; content: string; created_at: string }[]> {
    return this.queryAll(
      `SELECT role, content, created_at FROM chat_history WHERE date(created_at) = ? AND language = ? ORDER BY id ASC`,
      [date, this.languageId]
    ) as { role: string; content: string; created_at: string }[];
  }

  async getConversationState(): Promise<ConversationStateResult> {
    const row = this.queryRow(
      `SELECT * FROM conversation_state WHERE language = ? ORDER BY id DESC LIMIT 1`,
      [this.languageId]
    ) as ConversationStateData | undefined;

    if (row) {
      const updatedAt = parseSqlUtc(row.updated_at);
      const diffMin = (Date.now() - updatedAt.getTime()) / 60000;
      if (diffMin <= 30) {
        return { session: row, isNew: false };
      }
    }

    const sessionId = crypto.randomUUID();
    const now = nowIso();
    this.db.run(
      `INSERT INTO conversation_state (session_id, turn_count, last_two_modes, topics_touched, language, started_at, updated_at)
       VALUES (?, 0, '[]', '[]', ?, ?, ?)`,
      [sessionId, this.languageId, now, now]
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
