import type { Database } from "sql.js";

export type SaveFn = () => void;

export function nowIso(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function computeNextReview(intervalDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + intervalDays);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function computeElapsedDays(lastReviewIso: string): number {
  const last = new Date(lastReviewIso.replace(" ", "T"));
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
