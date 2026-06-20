import initSqlJs, { type SqlJsConfig, Database } from "sql.js";

let _sqlJsConfig: SqlJsConfig = {};
export function configureSqlJs(config: SqlJsConfig): void {
  _sqlJsConfig = config;
}
import fs from "fs";
import path from "path";
import type {
  ErrorItem, UserProfile, ConversationStateResult, UpdateResult,
  TurnAnnotationInput, TurnAnnotation, CompetencyVectorRow,
  ProficiencyEvidenceInput, ProficiencyEvidenceRow, ProficiencyChallengeBand,
  LearningItemInput, LearningItem, LearningItemEvidenceInput, LearningItemEvidenceRow, LearningPracticeAttempt, StartLearningPracticeAttemptInput, FinishLearningPracticeAttemptInput,
} from "../domain/types.js";
import type {
  ErrorRepository, SessionRepository, ProfileRepository,
  InterestRepository, CompetencyRepository, LearningRepository, MetaRepository,
} from "../repositories/interfaces.js";

import { SCHEMA } from "./schema.js";
import { dropLegacyLearningTables, runMigrations } from "./migrations.js";
import { SqlErrorRepository } from "./repositories/errorRepository.js";
import { SqlSessionRepository } from "./repositories/sessionRepository.js";
import { SqlProfileRepository } from "./repositories/profileRepository.js";
import { SqlInterestRepository } from "./repositories/interestRepository.js";
import { SqlCompetencyRepository } from "./repositories/competencyRepository.js";
import { SqlLearningRepository } from "./repositories/learningRepository.js";

export type { ErrorItem, UserProfile, ConversationStateResult, UpdateResult, TurnAnnotationInput, TurnAnnotation, CompetencyVectorRow } from "../domain/types.js";

export class BuddyDb implements ErrorRepository, SessionRepository, ProfileRepository, InterestRepository, CompetencyRepository, LearningRepository, MetaRepository {
  readonly db: Database;
  private dbPath: string;
  private readonly errors: ErrorRepository;
  private readonly sessions: SessionRepository;
  private readonly profiles: ProfileRepository;
  private readonly interests: InterestRepository;
  private readonly competency: CompetencyRepository;
  private readonly learning: LearningRepository;

  private constructor(
    db: Database,
    dbPath: string,
    languageId: string,
    validCategories: readonly string[],
    morphologyCategories: readonly string[],
  ) {
    this.db = db;
    this.dbPath = dbPath;
    const save = () => this.save();
    this.errors = new SqlErrorRepository(db, languageId, save, validCategories);
    this.sessions = new SqlSessionRepository(db, languageId, save);
    this.profiles = new SqlProfileRepository(db, languageId, save);
    this.interests = new SqlInterestRepository(db, languageId, save);
    this.competency = new SqlCompetencyRepository(db, languageId, save, morphologyCategories);
    this.learning = new SqlLearningRepository(db, languageId, save);
  }

  withLanguage(languageId: string, errorCategories: readonly string[], morphologyCategories: readonly string[]): BuddyDb {
    return new BuddyDb(this.db, this.dbPath, languageId, errorCategories, morphologyCategories);
  }

  static async open(
    dbPath: string,
    languageId: string,
    errorCategories: readonly string[],
    morphologyCategories: readonly string[],
  ): Promise<BuddyDb> {
    const SQL = await initSqlJs(_sqlJsConfig);
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let buf: Uint8Array | undefined;
    if (fs.existsSync(dbPath)) {
      buf = new Uint8Array(fs.readFileSync(dbPath));
    }
    const db = new SQL.Database(buf);
    dropLegacyLearningTables(db);
    db.run(SCHEMA);
    runMigrations(db);
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    return new BuddyDb(db, dbPath, languageId, errorCategories, morphologyCategories);
  }

  private save(): void {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  async addLearningItem(input: LearningItemInput): Promise<number | null> {
    return this.learning.addLearningItem(input);
  }

  async listLearningItems(status: string, limit: number): Promise<LearningItem[]> {
    return this.learning.listLearningItems(status, limit);
  }

  async listDueLearningItems(limit: number): Promise<LearningItem[]> {
    return this.learning.listDueLearningItems(limit);
  }

  async deduplicateLearningItems(limit?: number): Promise<number> {
    return this.learning.deduplicateLearningItems(limit);
  }

  async selectLearningItemsForEvaluation(userMessage: string, assistantText: string, limit: number): Promise<LearningItem[]> {
    return this.learning.selectLearningItemsForEvaluation(userMessage, assistantText, limit);
  }

  async markLearningItemsReintroduced(ids: number[]): Promise<number> {
    return this.learning.markLearningItemsReintroduced(ids);
  }

  async recordLearningItemEvidence(input: LearningItemEvidenceInput): Promise<number> {
    return this.learning.recordLearningItemEvidence(input);
  }

  async listLearningItemEvidence(learningItemId: number, limit?: number): Promise<LearningItemEvidenceRow[]> {
    return this.learning.listLearningItemEvidence(learningItemId, limit);
  }

  async startLearningPracticeAttempt(input: StartLearningPracticeAttemptInput): Promise<LearningPracticeAttempt> {
    return this.learning.startLearningPracticeAttempt(input);
  }

  async listActiveLearningPracticeAttempts(limit?: number): Promise<LearningPracticeAttempt[]> {
    return this.learning.listActiveLearningPracticeAttempts(limit);
  }

  async finishLearningPracticeAttempt(input: FinishLearningPracticeAttemptInput): Promise<LearningPracticeAttempt> {
    return this.learning.finishLearningPracticeAttempt(input);
  }

  async abandonActiveLearningPracticeAttempts(note?: string): Promise<number> {
    return this.learning.abandonActiveLearningPracticeAttempts(note);
  }

  async logError(userText: string, correct: string, category: string, note: string): Promise<number> {
    return this.errors.logError(userText, correct, category, note);
  }

  async deduplicateErrors(limit?: number): Promise<number> {
    return this.errors.deduplicateErrors(limit);
  }

  async listErrors(category: string, limit: number): Promise<ErrorItem[]> {
    return this.errors.listErrors(category, limit);
  }

  async getProfile(): Promise<UserProfile | null> {
    return this.profiles.getProfile();
  }

  async setProfile(fields: Record<string, string>): Promise<string[]> {
    return this.profiles.setProfile(fields);
  }

  async getConversationState(): Promise<ConversationStateResult> {
    return this.sessions.getConversationState();
  }

  async updateConversationState(mode: string, topic?: string, mood?: string): Promise<UpdateResult> {
    return this.sessions.updateConversationState(mode, topic, mood);
  }

  async addInterest(interest: string, source: string, confidence: number): Promise<boolean> {
    return this.interests.addInterest(interest, source, confidence);
  }

  async removeInterest(interest: string): Promise<void> {
    return this.interests.removeInterest(interest);
  }

  async listInterests(limit: number): Promise<string[]> {
    return this.interests.listInterests(limit);
  }

  async addChatMessage(chatId: number, role: string, content: string, sessionId?: string): Promise<void> {
    return this.sessions.addChatMessage(chatId, role, content, sessionId);
  }

  async getSessionTranscript(sessionId: string, limit?: number): Promise<{ role: string; content: string; created_at: string }[]> {
    return this.sessions.getSessionTranscript(sessionId, limit);
  }

  async getChatHistory(chatId: number, limit?: number): Promise<{ role: string; content: string }[]> {
    return this.sessions.getChatHistory(chatId, limit);
  }

  async getTodaysMessages(date: string): Promise<{ role: string; content: string; created_at: string }[]> {
    return this.sessions.getTodaysMessages(date);
  }

  async insertTurnAnnotation(ann: TurnAnnotationInput): Promise<void> {
    return this.competency.insertTurnAnnotation(ann);
  }

  async getRecentAnnotations(limit: number): Promise<TurnAnnotation[]> {
    return this.competency.getRecentAnnotations(limit);
  }

  async getCompetencyVector(): Promise<CompetencyVectorRow> {
    return this.competency.getCompetencyVector();
  }

  async updateCompetencyVector(fields: Partial<Omit<CompetencyVectorRow, "id" | "created_at">>): Promise<void> {
    return this.competency.updateCompetencyVector(fields);
  }

  async listRecentErrors(since: string, categories?: string[]): Promise<ErrorItem[]> {
    return this.errors.listRecentErrors(since, categories);
  }

  async insertProficiencyEvidence(evidence: ProficiencyEvidenceInput): Promise<number> {
    return this.competency.insertProficiencyEvidence(evidence);
  }

  async listProficiencyEvidence(limit: number): Promise<ProficiencyEvidenceRow[]> {
    return this.competency.listProficiencyEvidence(limit);
  }

  async getTypicalVocabBand(limit: number): Promise<ProficiencyChallengeBand | null> {
    return this.competency.getTypicalVocabBand(limit);
  }

  async getMetaValue(key: string): Promise<string | null> {
    const rows = this.db.exec("SELECT value FROM _buddy_meta WHERE key = ?", [key]);
    return (rows[0]?.values[0]?.[0] as string | null) ?? null;
  }

  async setMetaValue(key: string, value: string): Promise<void> {
    this.db.run("INSERT OR REPLACE INTO _buddy_meta (key, value) VALUES (?, ?)", [key, value]);
    this.save();
  }

  close(): void {
    this.save();
  }
}
