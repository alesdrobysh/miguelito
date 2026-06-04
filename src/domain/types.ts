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
  status?: string;
  source_type?: string | null;
  source_candidate_id?: number | null;
  meaning_l1?: string | null;
  topic_tags_json?: string;
  acceptable_variants_json?: string;
  elicitation_cues_json?: string;
  promotion_reason?: string | null;
  last_seen_in_chat_at?: string | null;
}

export type VocabCandidateStatus = "candidate" | "accepted" | "rejected" | "merged";

export interface VocabCandidateItem {
  id: number;
  chunk_l2: string;
  anchor: string | null;
  meaning_l1: string | null;
  capture_context_l2: string | null;
  language: string;
  source_type: string;
  source_message_id: number | null;
  evidence_snippet: string | null;
  proposed_by: string;
  priority: number;
  status: VocabCandidateStatus;
  duplicate_of: number | null;
  topic_tags_json: string;
  acceptable_variants_json: string;
  elicitation_cues_json: string;
  promotion_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export type LearningItemType =
  | "word"
  | "phrase"
  | "correction"
  | "grammar_point"
  | "collocation"
  | "idiom"
  | "register_note"
  | "pronunciation";

export type LearningItemStatus = "candidate" | "active" | "cooling_down" | "stable" | "ignored" | "mastered" | "archived";

export type LearningItemEvidenceSkill = "passive" | "active" | "reactivation";
export type LearningItemEvidenceIndependence = "spontaneous" | "elicited" | "hinted" | "observed" | "unknown";

export interface LearningItemEvidenceInput {
  learning_item_id: number;
  skill: LearningItemEvidenceSkill | string;
  event: string;
  independence?: LearningItemEvidenceIndependence | string;
  score_delta?: number;
  confidence?: number;
  evidence_snippet?: string;
  source_type?: string;
  source_message_id?: number;
}

export interface LearningItemEvidenceRow extends Required<Pick<LearningItemEvidenceInput, "skill" | "event">> {
  id: number;
  learning_item_id: number;
  language: string;
  independence: string;
  score_delta: number;
  confidence: number;
  evidence_snippet: string | null;
  source_type: string;
  source_message_id: number | null;
  created_at: string;
}

export interface LearningItemInput {
  type: LearningItemType | string;
  title: string;
  prompt_l2?: string;
  explanation_l1?: string;
  source_type?: string;
  source_message_id?: number;
  evidence_snippet?: string;
  priority?: number;
  status?: LearningItemStatus | string;
  practice_modes?: string[];
  tags?: string[];
  due_at?: string;
}

export interface LearningItem extends Required<Pick<LearningItemInput, "type" | "title">> {
  id: number;
  language: string;
  prompt_l2: string | null;
  explanation_l1: string | null;
  source_type: string;
  source_message_id: number | null;
  evidence_snippet: string | null;
  priority: number;
  status: LearningItemStatus;
  practice_modes_json: string;
  tags_json: string;
  due_at: string | null;
  last_practiced_at: string | null;
  reps: number;
  created_at: string;
  updated_at: string;
  passive_score: number;
  active_score: number;
  stability: string;
  last_seen_at: string | null;
  last_reactivated_at: string | null;
  last_understood_at: string | null;
  last_produced_at: string | null;
  next_reactivation_at: string | null;
  reactivation_pressure: string;
  evidence_count: number;
  failure_count: number;
  avoidance_count: number;
}

export interface LearningPracticeAttempt {
  id: number;
  learning_item_id: number;
  language: string;
  status: "active" | "completed" | "abandoned";
  prompt_text: string | null;
  user_response: string | null;
  grade: number | null;
  note: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface StartLearningPracticeAttemptInput {
  learning_item_id: number;
  prompt_text?: string;
}

export interface FinishLearningPracticeAttemptInput {
  attempt_id: number;
  user_response: string;
  grade: number;
  note?: string;
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

export type VocabReviewMode = "productive" | "receptive";

export interface VocabReviewAttempt {
  id: number;
  vocab_id: number;
  word: string;
  language: string;
  mode: VocabReviewMode;
  status: "active" | "completed" | "abandoned";
  strategy: string | null;
  prompt_text: string | null;
  user_response: string | null;
  target_used: number;
  accepted_variant: string | null;
  hint_level: number;
  grade: number | null;
  note: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface StartVocabReviewAttemptInput {
  word: string;
  mode: VocabReviewMode;
  strategy?: string;
  prompt_text?: string;
  hint_level?: number;
}

export interface FinishVocabReviewAttemptInput {
  attempt_id: number;
  user_response?: string;
  target_used: boolean;
  accepted_variant?: string;
  hint_level?: number;
  grade: number;
  note?: string;
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
  lexical_rarity?: number;
  self_correction?: boolean;
  morphology_errors?: number;
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
  lexical_rarity: number;
  self_correction: number;
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
  lexical_rarity_ewma: number;
  self_correction_obs: number;
  created_at: string;
}

export type ProficiencySkill = "reception" | "production" | "interaction";
export type ProficiencyDimension = "lexical" | "syntax" | "idiom" | "abstraction" | "fluency";
export type ProficiencyOutcome = "success" | "partial" | "fail";
export type ProficiencyChallengeBand = "top_1k" | "top_3k" | "top_6k" | "top_10k" | "top_50k" | "rare_or_unknown";

export interface ProficiencyEvidenceInput {
  skill: ProficiencySkill;
  dimension: ProficiencyDimension;
  challenge_band: ProficiencyChallengeBand;
  outcome: ProficiencyOutcome;
  confidence: number;
  weight: number;
  evidence_text: string;
  challenge_json?: string;
}

export interface ProficiencyEvidenceRow extends ProficiencyEvidenceInput {
  id: number;
  language: string;
  created_at: string;
}
