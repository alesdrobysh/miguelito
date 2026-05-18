export interface ChunkItem {
  id: number;
  chunk_l2: string;
  anchor: string | null;
  capture_context_l2: string | null;
  first_seen_at: string | null;
  pro_stability: number;
  pro_difficulty: number;
  pro_due: string | null;
  pro_last_review: string | null;
  pro_reps: number;
  rec_stability: number;
  rec_difficulty: number;
  rec_due: string | null;
  rec_last_review: string | null;
  rec_reps: number;
}

export interface DueChunkItem {
  id: number;
  chunk_l2: string;
  anchor: string | null;
  pro_stability: number;
  pro_reps: number;
  pro_due: string | null;
}

export type VocabItem = ChunkItem;
export type DueVocabItem = DueChunkItem;

export interface ErrorItem {
  id: number;
  user_text: string;
  correct_form: string;
  category: string;
  note: string | null;
  created_at: string;
}

export interface UserProfile {
  id: number;
  name: string | null;
  goal: string | null;
  correction_style: string | null;
  started_at: string | null;
  updated_at: string;
}

export interface ConversationStateData {
  id: number;
  session_id: string;
  turn_count: number;
  last_mode: string | null;
  last_two_modes: string;
  topics_touched: string;
  mood_hint: string | null;
  started_at: string;
  updated_at: string;
}

export interface ConversationStateResult {
  session: ConversationStateData;
  isNew: boolean;
}

export interface FsrsReviewResult {
  stability: number;
  difficulty: number;
  reps: number;
  status: string;
  due: string;
}

export interface ProgressData {
  newCount: number;
  learningCount: number;
  reviewCount: number;
  masteredCount: number;
  totalCount: number;
  dueCount: number;
  recentWords: string[];
  errorCategories: Record<string, number>;
}

export interface UpdateResult {
  turn_count: number;
  last_two_modes: string[];
  topics_touched: string[];
}

export interface ObligatoryContext {
  type: string;
}

export interface TurnAnnotationInput {
  session_id?: string;
  turn_number?: number;
  obligatory: ObligatoryContext[];
  used: string[];
  naturalness?: number | null;
  comprehension: "smooth" | "asked_clarify" | "requested_simpler";
  tunit_length?: number;
  had_subordination?: boolean;
}

export interface TurnAnnotation {
  id: number;
  session_id: string | null;
  turn_number: number | null;
  obligatory_json: string;
  used_json: string;
  naturalness: number | null;
  comprehension: string;
  tunit_length: number;
  had_subordination: number;
  created_at: string;
}

export interface CompetencyVectorRow {
  id: number;
  morph_successes: number;
  morph_trials: number;
  morph_obs: number;
  idiom_successes: number;
  idiom_trials: number;
  idiom_obs: number;
  syntax_window: string;
  reception_ewma: number;
  reception_obs: number;
  created_at: string;
}
