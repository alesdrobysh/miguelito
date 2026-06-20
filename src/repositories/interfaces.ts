import type {
  ErrorItem,
  UserProfile,
  ConversationStateResult,
  UpdateResult,
  TurnAnnotationInput,
  TurnAnnotation,
  CompetencyVectorRow,
  ProficiencyEvidenceInput,
  ProficiencyEvidenceRow,
  ProficiencyChallengeBand,
  LearningItemInput,
  LearningItem,
  LearningItemEvidenceInput,
  LearningItemEvidenceRow,
  LearningPracticeAttempt,
  StartLearningPracticeAttemptInput,
  FinishLearningPracticeAttemptInput,
} from "../domain/types.js";

export interface LearningRepository {
  addLearningItem(input: LearningItemInput): Promise<number | null>;
  listLearningItems(status: string, limit: number): Promise<LearningItem[]>;
  listDueLearningItems(limit: number): Promise<LearningItem[]>;
  deduplicateLearningItems(limit?: number): Promise<number>;
  selectLearningItemsForEvaluation(userMessage: string, assistantText: string, limit: number): Promise<LearningItem[]>;
  markLearningItemsReintroduced(ids: number[]): Promise<number>;
  recordLearningItemEvidence(input: LearningItemEvidenceInput): Promise<number>;
  listLearningItemEvidence(learningItemId: number, limit?: number): Promise<LearningItemEvidenceRow[]>;
  startLearningPracticeAttempt(input: StartLearningPracticeAttemptInput): Promise<LearningPracticeAttempt>;
  listActiveLearningPracticeAttempts(limit?: number): Promise<LearningPracticeAttempt[]>;
  finishLearningPracticeAttempt(input: FinishLearningPracticeAttemptInput): Promise<LearningPracticeAttempt>;
  abandonActiveLearningPracticeAttempts(note?: string): Promise<number>;
}


export interface ErrorRepository {
  logError(userText: string, correct: string, category: string, note: string): Promise<number>;
  deduplicateErrors(limit?: number): Promise<number>;
  listErrors(category: string, limit: number): Promise<ErrorItem[]>;
  listRecentErrors(since: string, categories?: string[]): Promise<ErrorItem[]>;
}

export interface SessionRepository {
  addChatMessage(chatId: number, role: string, content: string, sessionId?: string): Promise<void>;
  getChatHistory(chatId: number, limit?: number): Promise<{ role: string; content: string }[]>;
  getSessionTranscript(sessionId: string, limit?: number): Promise<{ role: string; content: string; created_at: string }[]>;
  getTodaysMessages(date: string): Promise<{ role: string; content: string; created_at: string }[]>;
  getConversationState(): Promise<ConversationStateResult>;
  updateConversationState(mode: string, topic?: string, mood?: string): Promise<UpdateResult>;
}

export interface ProfileRepository {
  getProfile(): Promise<UserProfile | null>;
  setProfile(fields: Record<string, string>): Promise<string[]>;
}

export interface InterestRepository {
  addInterest(interest: string, source: string, confidence: number): Promise<boolean>;
  removeInterest(interest: string): Promise<void>;
  listInterests(limit: number): Promise<string[]>;
}

export interface CompetencyRepository {
  getCompetencyVector(): Promise<CompetencyVectorRow>;
  updateCompetencyVector(fields: Partial<Omit<CompetencyVectorRow, "id" | "created_at">>): Promise<void>;
  insertTurnAnnotation(ann: TurnAnnotationInput): Promise<void>;
  getRecentAnnotations(limit: number): Promise<TurnAnnotation[]>;
  insertProficiencyEvidence(evidence: ProficiencyEvidenceInput): Promise<number>;
  listProficiencyEvidence(limit: number): Promise<ProficiencyEvidenceRow[]>;
  getTypicalVocabBand(limit: number): Promise<ProficiencyChallengeBand | null>;
}

export interface MetaRepository {
  getMetaValue(key: string): Promise<string | null>;
  setMetaValue(key: string, value: string): Promise<void>;
}
