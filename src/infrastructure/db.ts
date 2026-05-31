import initSqlJs, { Database } from "sql.js";
import fs from "fs";
import path from "path";
import type {
  ChunkItem, DueChunkItem, ErrorItem, UserProfile,
  ConversationStateResult, FsrsReviewResult, ProgressData, UpdateResult,
  TurnAnnotationInput, TurnAnnotation, CompetencyVectorRow,
  VocabReviewMode, VocabReviewAttempt, StartVocabReviewAttemptInput, FinishVocabReviewAttemptInput,
  VocabCandidateItem,
  ProficiencyEvidenceInput, ProficiencyEvidenceRow,
  LearningItemInput, LearningItem, LearningPracticeAttempt, StartLearningPracticeAttemptInput, FinishLearningPracticeAttemptInput,
} from "../domain/types.js";
import type {
  VocabRepository, ErrorRepository, SessionRepository, ProfileRepository,
  InterestRepository, CompetencyRepository, LearningRepository,
} from "../repositories/interfaces.js";

import { SCHEMA } from "./schema.js";
import { runMigrations } from "./migrations.js";
import { SqlVocabRepository } from "./repositories/vocabRepository.js";
import { SqlErrorRepository } from "./repositories/errorRepository.js";
import { SqlSessionRepository } from "./repositories/sessionRepository.js";
import { SqlProfileRepository } from "./repositories/profileRepository.js";
import { SqlInterestRepository } from "./repositories/interestRepository.js";
import { SqlCompetencyRepository } from "./repositories/competencyRepository.js";
import { SqlLearningRepository } from "./repositories/learningRepository.js";

export type { ChunkItem, DueChunkItem, ErrorItem, UserProfile, ConversationStateResult, FsrsReviewResult, ProgressData, UpdateResult, TurnAnnotationInput, TurnAnnotation, CompetencyVectorRow } from "../domain/types.js";

export class BuddyDb implements VocabRepository, ErrorRepository, SessionRepository, ProfileRepository, InterestRepository, CompetencyRepository, LearningRepository {
  readonly db: Database;
  private dbPath: string;
  private languageId: string;

  private readonly vocab: VocabRepository;
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
    this.languageId = languageId;
    const save = () => this.save();
    this.vocab = new SqlVocabRepository(db, languageId, save);
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
    const SQL = await initSqlJs();
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let buf: Uint8Array | undefined;
    if (fs.existsSync(dbPath)) {
      buf = new Uint8Array(fs.readFileSync(dbPath));
    }
    const db = new SQL.Database(buf);
    db.run(SCHEMA);
    runMigrations(db);
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    return new BuddyDb(db, dbPath, languageId, errorCategories, morphologyCategories);
  }

  private save(): void {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  async addVocab(chunk_l2: string, capture_context_l2: string, anchor?: string): Promise<number | null> {
    return this.vocab.addVocab(chunk_l2, capture_context_l2, anchor);
  }

  async addVocabCandidate(input: {
    chunk_l2: string;
    anchor?: string;
    meaning_l1?: string;
    capture_context_l2?: string;
    source_type?: string;
    source_message_id?: number;
    evidence_snippet?: string;
    proposed_by?: string;
    priority?: number;
    topic_tags?: string[];
    acceptable_variants?: string[];
    elicitation_cues?: string[];
    promotion_reason?: string;
  }): Promise<number | null> {
    return this.vocab.addVocabCandidate(input);
  }

  async listVocabCandidates(status: string, limit: number): Promise<VocabCandidateItem[]> {
    return this.vocab.listVocabCandidates(status, limit);
  }

  async promoteVocabCandidates(options: { maxPromotions?: number; minPriority?: number; maxActiveLearningItems?: number } = {}): Promise<ChunkItem[]> {
    return this.vocab.promoteVocabCandidates(options);
  }

  async promoteSpecificVocabCandidate(candidateId: number): Promise<ChunkItem | null> {
    return this.vocab.promoteSpecificVocabCandidate(candidateId);
  }

  async updateVocabCandidateStatus(candidateId: number, status: string): Promise<boolean> {
    return this.vocab.updateVocabCandidateStatus(candidateId, status);
  }

  async listVocab(bucket: string, limit: number): Promise<ChunkItem[]> {
    return this.vocab.listVocab(bucket, limit);
  }

  async addLearningItem(input: LearningItemInput): Promise<number | null> {
    return this.learning.addLearningItem(input);
  }

  async listLearningItems(status: string, limit: number): Promise<LearningItem[]> {
    return this.learning.listLearningItems(status, limit);
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

  async dueVocab(limit: number, mode: VocabReviewMode = "productive"): Promise<DueChunkItem[]> {
    return this.vocab.dueVocab(limit, mode);
  }

  async scoreVocab(chunk_l2: string, grade: number, mode: VocabReviewMode = "productive"): Promise<FsrsReviewResult> {
    return this.vocab.scoreVocab(chunk_l2, grade, mode);
  }

  async startVocabReviewAttempt(input: StartVocabReviewAttemptInput): Promise<VocabReviewAttempt> {
    return this.vocab.startVocabReviewAttempt(input);
  }

  async finishVocabReviewAttempt(input: FinishVocabReviewAttemptInput): Promise<VocabReviewAttempt> {
    return this.vocab.finishVocabReviewAttempt(input);
  }

  async listActiveVocabReviewAttempts(limit?: number): Promise<VocabReviewAttempt[]> {
    return this.vocab.listActiveVocabReviewAttempts(limit);
  }

  async logError(userText: string, correct: string, category: string, note: string): Promise<number> {
    return this.errors.logError(userText, correct, category, note);
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

  async listInterests(limit: number): Promise<string[]> {
    return this.interests.listInterests(limit);
  }

  async exportVocab(format: string): Promise<{ count: number; data: string }> {
    return this.vocab.exportVocab(format);
  }

  async progressSummary(): Promise<ProgressData> {
    return this.vocab.progressSummary();
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

  close(): void {
    this.save();
  }
}
