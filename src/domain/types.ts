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

export interface FuzzyLearningItemDuplicateCandidate {
  itemA: LearningItem;
  itemB: LearningItem;
  score: number;
  titleSimilarity: number;
  promptSimilarity: number;
  explanationSimilarity: number;
  tokenSimilarity: number;
  reason: string;
}

export interface FuzzyLearningItemDuplicateOptions {
  limit?: number;
  scanLimit?: number;
}

export type FuzzyLearningItemDuplicateDecisionKind = "merge" | "related" | "keep_separate";

export interface FuzzyLearningItemDuplicateDecision {
  itemAId: number;
  itemBId: number;
  decision: FuzzyLearningItemDuplicateDecisionKind;
  keeperId?: number;
  confidence: number;
  reason: string;
  mergedTitle?: string;
  mergedPromptL2?: string;
  mergedExplanationL1?: string;
}

export interface AppliedFuzzyLearningItemMerge {
  keeperId: number;
  archivedId: number;
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


export interface ErrorItem {
  id: number;
  user_text: string;
  correct_form: string;
  category: string;
  note: string | null;
  status: string;
  updated_at: string;
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
