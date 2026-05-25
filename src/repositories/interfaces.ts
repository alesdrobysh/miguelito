import type {
  ChunkItem,
  VocabCandidateItem,
  DueChunkItem,
  ErrorItem,
  UserProfile,
  ConversationStateResult,
  UpdateResult,
  FsrsReviewResult,
  TurnAnnotationInput,
  TurnAnnotation,
  CompetencyVectorRow,
  ProgressData,
  VocabReviewMode,
  VocabReviewAttempt,
  StartVocabReviewAttemptInput,
  FinishVocabReviewAttemptInput,
  ProficiencyEvidenceInput,
  ProficiencyEvidenceRow,
} from "../domain/types.js";

export interface VocabRepository {
  addVocab(chunk_l2: string, capture_context_l2: string, anchor?: string): Promise<number | null>;
  addVocabCandidate(input: {
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
  }): Promise<number | null>;
  listVocabCandidates(status: string, limit: number): Promise<VocabCandidateItem[]>;
  promoteVocabCandidates(options?: { maxPromotions?: number; minPriority?: number; maxActiveLearningItems?: number }): Promise<ChunkItem[]>;
  promoteSpecificVocabCandidate(candidateId: number): Promise<ChunkItem | null>;
  updateVocabCandidateStatus(candidateId: number, status: string): Promise<boolean>;
  listVocab(bucket: string, limit: number): Promise<ChunkItem[]>;
  dueVocab(limit: number, mode?: VocabReviewMode): Promise<DueChunkItem[]>;
  scoreVocab(chunk_l2: string, grade: number, mode?: VocabReviewMode): Promise<FsrsReviewResult>;
  startVocabReviewAttempt(input: StartVocabReviewAttemptInput): Promise<VocabReviewAttempt>;
  finishVocabReviewAttempt(input: FinishVocabReviewAttemptInput): Promise<VocabReviewAttempt>;
  exportVocab(format: string): Promise<{ count: number; data: string }>;
  progressSummary(): Promise<ProgressData>;
}

export interface ErrorRepository {
  logError(userText: string, correct: string, category: string, note: string): Promise<number>;
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
  listInterests(limit: number): Promise<string[]>;
}

export interface CompetencyRepository {
  getCompetencyVector(): Promise<CompetencyVectorRow>;
  updateCompetencyVector(fields: Partial<Omit<CompetencyVectorRow, "id" | "created_at">>): Promise<void>;
  insertTurnAnnotation(ann: TurnAnnotationInput): Promise<void>;
  getRecentAnnotations(limit: number): Promise<TurnAnnotation[]>;
  insertProficiencyEvidence(evidence: ProficiencyEvidenceInput): Promise<number>;
  listProficiencyEvidence(limit: number): Promise<ProficiencyEvidenceRow[]>;
}
