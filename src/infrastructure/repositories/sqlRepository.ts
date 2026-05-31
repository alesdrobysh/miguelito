import type { Database } from "sql.js";

export type SaveFn = () => void;

export function nowIso(): string {
  return toSqlUtc(new Date());
}

export function computeNextReview(intervalDays: number): string {
  const d = new Date(Date.now() + Math.max(0, intervalDays) * 86400000);
  return toSqlUtc(d);
}

function toSqlUtc(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function parseSqlUtc(value: string): Date {
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

export function computeElapsedDays(lastReviewIso: string): number {
  const last = parseSqlUtc(lastReviewIso);
  return Math.max(0.1, (Date.now() - last.getTime()) / 86400000);
}

export abstract class SqlRepository {
  protected constructor(
    protected readonly db: Database,
    protected readonly languageId: string,
    private readonly saveFn: SaveFn,
  ) {}

  protected save(): void {
    this.saveFn();
  }

  protected queryRow<T = any>(sql: string, params?: any[]): T | undefined {
    const stmt = this.db.prepare(sql);
    if (params) stmt.bind(params);
    try {
      if (stmt.step()) {
        return stmt.getAsObject() as T;
      }
      return undefined;
    } finally {
      stmt.free();
    }
  }

  protected queryAll<T = any>(sql: string, params?: any[]): T[] {
    const stmt = this.db.prepare(sql);
    if (params) stmt.bind(params);
    const results: T[] = [];
    try {
      while (stmt.step()) {
        results.push(stmt.getAsObject() as T);
      }
    } finally {
      stmt.free();
    }
    return results;
  }
}
