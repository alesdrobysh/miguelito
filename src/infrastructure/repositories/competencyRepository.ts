import type { Database } from "sql.js";
import type {
  CompetencyVectorRow,
  ProficiencyEvidenceInput,
  ProficiencyEvidenceRow,
  TurnAnnotation,
  TurnAnnotationInput,
} from "../../domain/types.js";
import type { CompetencyRepository } from "../../repositories/interfaces.js";
import { SqlRepository, type SaveFn } from "./sqlRepository.js";

export class SqlCompetencyRepository extends SqlRepository implements CompetencyRepository {
  private readonly morphologyTypes: ReadonlySet<string>;

  constructor(db: Database, languageId: string, save: SaveFn, morphologyCategories: readonly string[]) {
    super(db, languageId, save);
    this.morphologyTypes = new Set(morphologyCategories);
  }

  private updateVectorFromAnnotation(ann: TurnAnnotationInput): void {
    const DECAY = 0.85;
    const RECEPTION_ALPHA = 0.2;
    const RARITY_ALPHA = 0.15;

    const vec = this.queryRow("SELECT * FROM competency_vector WHERE language = ? ORDER BY id DESC LIMIT 1", [this.languageId]) as CompetencyVectorRow | undefined;
    if (!vec) return;

    let morphS = vec.morph_successes * DECAY;
    let morphT = vec.morph_trials * DECAY;
    let idiomS = vec.idiom_successes * DECAY;
    let idiomT = vec.idiom_trials * DECAY;
    let morphObs = vec.morph_obs;
    let idiomObs = vec.idiom_obs;

    const morphObligatory = ann.obligatory.filter((o) => this.morphologyTypes.has(o.type)).length;
    if (morphObligatory > 0) {
      const morphErrors = ann.morphology_errors ?? 0;
      morphT += morphObligatory;
      morphS += Math.max(0, morphObligatory - morphErrors);
      morphObs++;
    }

    if (ann.naturalness != null) {
      idiomT += 1;
      idiomS += ann.naturalness;
      idiomObs++;
    }

    const window: { tunit_length: number; had_sub: boolean }[] = JSON.parse(vec.syntax_window);
    window.push({ tunit_length: ann.tunit_length ?? 1, had_sub: ann.had_subordination ?? false });
    const trimmedWindow = window.slice(-20);

    const signals: Record<string, number> = { smooth: 1.0, asked_clarify: 0.4, requested_simpler: 0.0 };
    const signal = signals[ann.comprehension] ?? 0.5;
    const recEwma = RECEPTION_ALPHA * signal + (1 - RECEPTION_ALPHA) * vec.reception_ewma;
    const recObs = vec.reception_obs + 1;

    const raritySignal = ann.lexical_rarity ?? 0.0;
    const rarityEwma = RARITY_ALPHA * raritySignal + (1 - RARITY_ALPHA) * vec.lexical_rarity_ewma;

    const selfCorrectionObs = vec.self_correction_obs + (ann.self_correction ? 1 : 0);

    this.db.run(
      `INSERT INTO competency_vector
        (morph_successes, morph_trials, morph_obs, idiom_successes, idiom_trials, idiom_obs, syntax_window, reception_ewma, reception_obs, lexical_rarity_ewma, self_correction_obs, language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [morphS, morphT, morphObs, idiomS, idiomT, idiomObs, JSON.stringify(trimmedWindow), recEwma, recObs, rarityEwma, selfCorrectionObs, this.languageId]
    );
  }

  async insertTurnAnnotation(ann: TurnAnnotationInput): Promise<void> {
    this.db.run(
      `INSERT INTO turn_annotations
        (session_id, turn_number, obligatory_json, used_json, naturalness, comprehension, tunit_length, had_subordination, lexical_rarity, self_correction, language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ann.session_id ?? null,
        ann.turn_number ?? null,
        JSON.stringify(ann.obligatory),
        JSON.stringify(ann.used),
        ann.naturalness ?? null,
        ann.comprehension,
        ann.tunit_length ?? 1,
        ann.had_subordination ? 1 : 0,
        ann.lexical_rarity ?? 0.0,
        ann.self_correction ? 1 : 0,
        this.languageId,
      ]
    );
    this.updateVectorFromAnnotation(ann);
    this.save();
  }

  async getRecentAnnotations(limit: number): Promise<TurnAnnotation[]> {
    return this.queryAll(
      `SELECT * FROM turn_annotations WHERE language = ? ORDER BY id DESC LIMIT ?`,
      [this.languageId, limit]
    ) as TurnAnnotation[];
  }

  async getCompetencyVector(): Promise<CompetencyVectorRow> {
    let row = this.queryRow(`SELECT * FROM competency_vector WHERE language = ? ORDER BY id DESC LIMIT 1`, [this.languageId]);
    if (!row) {
      this.db.run("INSERT INTO competency_vector (language) VALUES (?)", [this.languageId]);
      this.save();
      row = this.queryRow(`SELECT * FROM competency_vector WHERE language = ? ORDER BY id DESC LIMIT 1`, [this.languageId]);
    }
    return row as CompetencyVectorRow;
  }

  async updateCompetencyVector(fields: Partial<Omit<CompetencyVectorRow, "id" | "created_at">>): Promise<void> {
    if (Object.keys(fields).length === 0) return;
    const current = await this.getCompetencyVector();
    const merged = { ...current, ...fields };
    this.db.run(
      `INSERT INTO competency_vector
        (morph_successes, morph_trials, morph_obs, idiom_successes, idiom_trials, idiom_obs, syntax_window, reception_ewma, reception_obs, language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [merged.morph_successes, merged.morph_trials, merged.morph_obs, merged.idiom_successes, merged.idiom_trials, merged.idiom_obs, merged.syntax_window, merged.reception_ewma, merged.reception_obs, this.languageId]
    );
    this.save();
  }

  async insertProficiencyEvidence(evidence: ProficiencyEvidenceInput): Promise<number> {
    this.db.run(
      `INSERT INTO proficiency_evidence
        (language, skill, dimension, challenge_band, outcome, confidence, weight, evidence_text, challenge_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.languageId,
        evidence.skill,
        evidence.dimension,
        evidence.challenge_band,
        evidence.outcome,
        Math.max(0, Math.min(1, evidence.confidence)),
        Math.max(0, evidence.weight),
        evidence.evidence_text,
        evidence.challenge_json ?? "{}",
      ]
    );
    const id = this.queryRow("SELECT last_insert_rowid() AS id") as { id: number };
    this.save();
    return id.id;
  }

  async listProficiencyEvidence(limit: number): Promise<ProficiencyEvidenceRow[]> {
    return this.queryAll(
      `SELECT * FROM proficiency_evidence WHERE language = ? ORDER BY id DESC LIMIT ?`,
      [this.languageId, limit]
    ) as ProficiencyEvidenceRow[];
  }
}
