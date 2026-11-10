// Personal workout storage is separate from the imported-health DB and its clearAll/reimport lifecycle.
import type { RecordedWorkout, WorkoutSample } from "@/live/workout";

export interface WorkoutStore {
  get(id: string): Promise<RecordedWorkout | null>;
  list(limit?: number, before?: number): Promise<RecordedWorkout[]>;
  samples(id: string): Promise<WorkoutSample[]>;
  cursor(id: string): Promise<number>;
  ingest(session: RecordedWorkout, samples: readonly WorkoutSample[], cursor: number): Promise<void>;
  /** Deletes one workout and its samples (Discard, Delete). */
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}
/** `next` with the Health Connect id `prev` already has, when `next` lacks one. */
export const keepHcId = (prev: RecordedWorkout | null | undefined, next: RecordedWorkout): RecordedWorkout => (prev?.hcId && !next.hcId ? { ...next, hcId: prev.hcId } : next);

export class MemoryWorkoutStore implements WorkoutStore {
  private rows = new Map<string, RecordedWorkout>();
  private readings = new Map<string, Map<number, WorkoutSample>>();
  private cursors = new Map<string, number>();
  async get(id: string) { return this.rows.get(id) ?? null; }
  async list(limit = 25, before = Infinity) {
    return [...this.rows.values()].filter((r) => r.startedAt < before).sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
  }
  async samples(id: string) { return [...(this.readings.get(id)?.values() ?? [])].sort((a, b) => a.seq - b.seq); }
  async cursor(id: string) { return this.cursors.get(id) ?? 0; }
  async ingest(session: RecordedWorkout, samples: readonly WorkoutSample[], cursor: number) {
    const old = this.rows.get(session.id);
    // A replay from the native journal carries no hcId: keep the one Pulse stored (keepHcId).
    if (!old || !(old.revision > session.revision || old.seq > session.seq || (old.status === "completed" && session.status !== "completed"))) this.rows.set(session.id, structuredClone(keepHcId(old, session)));
    const rows = this.readings.get(session.id) ?? new Map<number, WorkoutSample>();
    for (const sample of samples) rows.set(sample.seq, structuredClone(sample));
    this.readings.set(session.id, rows);
    this.cursors.set(session.id, Math.max(this.cursors.get(session.id) ?? 0, cursor));
  }
  async remove(id: string) { this.rows.delete(id); this.readings.delete(id); this.cursors.delete(id); }
  async clear() { this.rows.clear(); this.readings.clear(); this.cursors.clear(); }
}
