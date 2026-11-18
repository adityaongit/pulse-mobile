import { MemoryWorkoutStore } from "./workouts";
// An in-memory Store on Maps: the pipeline tests run on it, and "demo" mode can when nothing need survive a
// restart. Rows are copied on the way in and out (JSON round-trip), so callers never share objects with the
// store, as they would not with SQLite.
import type { DayRange, JournalTagChange, JournalTagRow, LoggedEntryRow, ReportRow, ScoreRow, SeriesKind, Store } from "./store";
import type { BloodPressureReading, DailyValue, Exercise, HealthRecord, HrSample, HrvSample, JournalEntry, Metrics, Profile, Segment, Session, StepsMinute, SyncState } from "./types";
import type { GymExercise, GymImportState, GymMeasurement, GymRoutine, GymRoutineItem, GymSession, GymSet } from "./gym";
import type { Habit, HabitEntry } from "./habits";
import type { FoodOrder } from "./foodOrders";
import { DEFAULT_MODE, type Fix, type FrozenStay, type MoveBucket, type Place, type PlaceEvent, type TimelineOverride, type TimelineState } from "@/core/places/types";
import type { LeetCodeSnapshot } from "@/leetcode/types";
import type { ActivityCostResult } from "@/core/algorithms/activityCost";
import { minuteHr } from "@/core/engine/context";

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const key2 = (a: string, b: string) => `${a}\u0000${b}`;
const inRange = (day: string, r?: DayRange) => !r || (day >= r.from && day <= r.to);

const DAY = 86_400;
const bucketOf = (ts: number) => Math.floor(ts / DAY);

/** Keyed samples with a sorted view, rebuilt lazily after writes, and the UTC days compacted to minutes (as SQLite's flag). */
class Samples {
  private byTs = new Map<number, number>();
  private sorted: { ts: number; v: number }[] | null = null;
  private compacted = new Set<number>();

  /** True when a sample was new or had another value. */
  put(xs: { ts: number; v: number }[]) {
    let changed = false;
    for (const x of xs) {
      if (this.byTs.get(x.ts) === x.v) continue;
      changed = true;
      this.byTs.set(x.ts, x.v);
      this.compacted.delete(bucketOf(x.ts));
    }
    if (changed) this.sorted = null;
    return changed;
  }

  private all() {
    if (!this.sorted) this.sorted = [...this.byTs].map(([ts, v]) => ({ ts, v })).sort((a, b) => a.ts - b.ts);
    return this.sorted;
  }

  /** lo <= ts < hi, ascending. */
  read(lo: number, hi: number) {
    const xs = this.all();
    const first = (t: number) => {
      let a = 0;
      let z = xs.length;
      while (a < z) {
        const m = (a + z) >> 1;
        if (xs[m].ts < t) a = m + 1;
        else z = m;
      }
      return a;
    };
    return xs.slice(first(lo), first(hi));
  }

  bounds() {
    const xs = this.all();
    return xs.length ? { first: xs[0].ts, last: xs[xs.length - 1].ts } : null;
  }

  clear() {
    this.byTs.clear();
    this.compacted.clear();
    this.sorted = null;
  }

  /** Drops lo <= ts < hi; a day that loses samples is rewritten, so it is raw again. */
  drop(lo: number, hi: number) {
    for (const ts of [...this.byTs.keys()])
      if (ts >= lo && ts < hi) {
        this.byTs.delete(ts);
        this.compacted.delete(bucketOf(ts));
      }
    this.sorted = null;
  }

  /** Store.compactHr on this table. */
  compact(beforeTs: number) {
    const days = [...new Set(this.all().map((x) => bucketOf(x.ts)))].filter((b) => b < bucketOf(beforeTs) && !this.compacted.has(b));
    for (const b of days) {
      const raw = this.read(b * DAY, (b + 1) * DAY);
      for (const x of raw) this.byTs.delete(x.ts);
      for (const m of minuteHr(raw.map((x) => ({ ts: x.ts, bpm: x.v })))) this.byTs.set(m.ts, Math.round(m.bpm));
      this.compacted.add(b);
      this.sorted = null;
    }
    return days.length;
  }
}

export class MemoryStore implements Store {
  readonly workouts = new MemoryWorkoutStore();
  private profile: Profile | null = null;
  private sync: SyncState = { lastSyncTs: null, firstDay: null, lastError: null };
  private metrics = new Map<string, Metrics>();
  private sessions = new Map<string, Session>();
  private segments = new Map<string, Segment[]>();
  private exercises = new Map<string, Exercise>();
  private hr = new Samples();
  private steps = new Samples();
  private hrv = new Samples();
  private values = new Map<string, DailyValue>();
  private journal = new Map<string, JournalEntry>();
  private dirty = new Set<string>();
  private scores = new Map<string, ScoreRow>();
  private series = new Map<string, (number | null)[]>();
  private reports = new Map<string, ReportRow>();
  private activityCost: ActivityCostResult | null = null;
  /** Journal tags by key, each with its insertion number (the web's `seq`). */
  private tags = new Map<string, JournalTagRow & { seq: number }>();
  private tagSeq = 0;
  private logged = new Map<string, LoggedEntryRow>();
  private records = new Map<string, HealthRecord>();
  private gymEx = new Map<string, GymExercise>();
  private gymRoutineMap = new Map<string, GymRoutine>();
  private gymItems = new Map<string, GymRoutineItem[]>();
  private gymSessionMap = new Map<string, GymSession>();
  private gymSetMap = new Map<string, GymSet>();
  private gymMeasures = new Map<string, GymMeasurement>();
  private gymImport: GymImportState | null = null;
  private habitMap = new Map<string, Habit>();
  private habitEntryMap = new Map<string, HabitEntry>();
  private foodOrderMap = new Map<string, FoodOrder>();
  private placeMap = new Map<string, Place>();
  private placeEventMap = new Map<string, PlaceEvent>();
  private fixMap = new Map<number, Fix>();
  private frozen = new Map<string, FrozenStay[]>();
  private moves = new Map<number, number>();
  private overrides = new Map<string, TimelineOverride>();
  private timelineState: TimelineState = { mode: DEFAULT_MODE, frozenThrough: null };
  private bloodPressure = new Map<string, BloodPressureReading>();

  async getProfile() {
    return this.profile && copy(this.profile);
  }
  async setProfile(p: Profile) {
    this.profile = copy(p);
  }
  async getSyncState() {
    return copy(this.sync);
  }
  async setSyncState(s: Partial<SyncState>) {
    this.sync = { ...this.sync, ...copy(s) };
  }

  async upsertMetrics(rows: Metrics[]) {
    for (const r of rows) this.metrics.set(r.day, copy(r));
  }
  /** Segments replace those of every session they name; sessions passed without segments keep theirs. */
  async upsertSessions(rows: Session[], segments: Segment[]) {
    for (const r of rows) this.sessions.set(r.id, copy(r));
    const bySession = new Map<string, Segment[]>();
    for (const g of segments) {
      const list = bySession.get(g.sessionId);
      if (list) list.push(copy(g));
      else bySession.set(g.sessionId, [copy(g)]);
    }
    for (const [id, list] of bySession) this.segments.set(id, list.sort((a, b) => a.startTs - b.startTs));
  }
  async upsertExercises(rows: Exercise[]) {
    for (const r of rows) this.exercises.set(r.id, copy(r));
  }
  async putHr(samples: HrSample[]) {
    return this.hr.put(samples.map((s) => ({ ts: s.ts, v: s.bpm })));
  }
  async putHrv(samples: HrvSample[]) {
    return this.hrv.put(samples.map((s) => ({ ts: s.ts, v: s.ms })));
  }
  async putSteps(minutes: StepsMinute[]) {
    return this.steps.put(minutes);
  }
  async upsertDailyValues(rows: DailyValue[]) {
    for (const r of rows) this.values.set(key2(r.day, r.key), copy(r));
  }
  async replaceDailyValues(range: DayRange, keys: readonly string[], rows: DailyValue[]) {
    for (const [k, v] of this.values) if (inRange(v.day, range) && keys.includes(v.key)) this.values.delete(k);
    await this.upsertDailyValues(rows);
  }
  async setJournal(entry: JournalEntry) {
    this.journal.set(key2(entry.day, entry.tag), copy(entry));
  }
  async deleteJournal(day: string, tag: string) {
    this.journal.delete(key2(day, tag));
  }
  async clearImported(range: DayRange, fromTs: number, toTs: number, opts?: { keepScores?: boolean }) {
    for (const [d] of this.metrics) if (inRange(d, range)) this.metrics.delete(d);
    for (const [id, s] of this.sessions) {
      if (!inRange(s.day, range)) continue;
      this.sessions.delete(id);
      this.segments.delete(id);
    }
    for (const [id, e] of this.exercises) if (inRange(e.day, range)) this.exercises.delete(id);
    for (const [k, v] of this.values) if (inRange(v.day, range)) this.values.delete(k);
    for (const [id, r] of this.records) if (inRange(r.day, range)) this.records.delete(id);
    for (const [id, bp] of this.bloodPressure) if (inRange(bp.day, range)) this.bloodPressure.delete(id);
    for (const [id, r] of this.logged) if (r.source === "health_connect" && inRange(r.day, range)) this.logged.delete(id);
    if (!opts?.keepScores) {
      for (const [d] of this.scores) if (inRange(d, range)) this.scores.delete(d);
      this.checkpoint = null;
    }
    for (const k of [...this.series.keys()]) if (inRange(k.split("\u0000")[0], range)) this.series.delete(k);
    this.hr.drop(fromTs, toTs);
    this.steps.drop(fromTs, toTs);
    this.hrv.drop(fromTs, toTs);
  }
  async deleteSessions(ids: string[]) {
    for (const id of ids) {
      this.sessions.delete(id);
      this.segments.delete(id);
    }
  }
  async deleteExercises(ids: string[]) {
    for (const id of ids) this.exercises.delete(id);
  }
  async upsertHealthRecords(rows: HealthRecord[]) {
    for (const r of rows) this.records.set(r.id, copy(r));
  }
  async upsertBloodPressure(rows: BloodPressureReading[]) {
    for (const r of rows) this.bloodPressure.set(r.id, copy(r));
  }
  async markIntradayDirty(days: string[]) {
    for (const d of days) this.dirty.add(d);
  }
  async takeIntradayDirty() {
    const days = [...this.dirty].sort();
    this.dirty.clear();
    return days;
  }

  async needsScoring(today: string, scoringVersion: number) {
    if (this.dirty.size > 0) return true;
    const row = this.scores.get(today);
    if (!row || row.scoringVersion !== scoringVersion) return true;
    for (const r of this.scores.values()) if (r.scoringVersion !== scoringVersion) return true;
    return false;
  }

  async allMetrics() {
    return copy([...this.metrics.values()]);
  }
  async allSessions() {
    return copy([...this.sessions.values()]);
  }
  async segmentsFor(sessionIds: string[]) {
    return copy(sessionIds.flatMap((id) => this.segments.get(id) ?? []));
  }
  async allExercises() {
    return copy([...this.exercises.values()]);
  }
  async allJournal() {
    return copy([...this.journal.values()]);
  }
  async dailyValues(range?: DayRange) {
    return copy([...this.values.values()].filter((v) => inRange(v.day, range)));
  }
  async healthRecords(toDay?: string) {
    const rows = [...this.records.values()].filter((r) => toDay === undefined || r.day <= toDay);
    return copy(rows.sort((a, b) => b.ts - a.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  }
  async allBloodPressure(): Promise<BloodPressureReading[]> {
    return copy([...this.bloodPressure.values()].sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)));
  }
  async readHr(lo: number, hi: number) {
    return this.hr.read(lo, hi).map((s) => ({ ts: s.ts, bpm: s.v }));
  }
  async readHrv(lo: number, hi: number) {
    return this.hrv.read(lo, hi).map((s) => ({ ts: s.ts, ms: s.v }));
  }
  async readSteps(lo: number, hi: number) {
    return this.steps.read(lo, hi).map((s) => ({ ts: s.ts, v: s.v }));
  }
  async hrBounds() {
    return this.hr.bounds();
  }

  async getScores(day: string) {
    const r = this.scores.get(day);
    return r ? copy(r) : null;
  }
  async scoresIn(range: DayRange) {
    return copy([...this.scores.values()].filter((r) => inRange(r.day, range)).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)));
  }
  async wornDays(range: DayRange) {
    return [...this.scores.values()]
      .filter((r) => inRange(r.day, range))
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
      .map((r) => ({ day: r.day, hrCount: r.strain?.hrCount ?? 0, hrMinutesAm: r.strain?.hrMinutesAm ?? 0, hrMinutesPm: r.strain?.hrMinutesPm ?? 0 }));
  }
  async putScores(row: ScoreRow) {
    this.scores.set(row.day, copy(row));
  }
  async getSeries(day: string, kind: SeriesKind) {
    const s = this.series.get(key2(day, kind));
    return s ? copy(s) : null;
  }
  async putSeries(day: string, kind: SeriesKind, data: (number | null)[]) {
    if (data.length) this.series.set(key2(day, kind), copy(data));
    else this.series.delete(key2(day, kind));
  }

  async journalTags() {
    const rows = [...this.tags.values()].sort((a, b) => a.position - b.position || a.seq - b.seq);
    return copy(rows.map(({ seq: _, ...r }) => r));
  }
  async insertJournalTags(rows: JournalTagRow[]) {
    const added: string[] = [];
    for (const r of rows) {
      if (this.tags.has(r.tag)) continue;
      this.tags.set(r.tag, { ...copy(r), seq: ++this.tagSeq });
      added.push(r.tag);
    }
    return added;
  }
  async updateJournalTags(changes: JournalTagChange[]) {
    for (const ch of changes) {
      const t = this.tags.get(ch.tag);
      if (!t) continue;
      if (ch.hidden !== undefined) t.hidden = ch.hidden;
      if (ch.position !== undefined) t.position = ch.position;
    }
  }

  async addLoggedEntries(rows: LoggedEntryRow[]) {
    for (const r of rows) this.logged.set(r.id, copy({ ...r, source: r.source ?? "pulse" }));
  }
  async replaceExternalEntries(range: DayRange, rows: LoggedEntryRow[]) {
    for (const [id, r] of this.logged) if (r.source === "health_connect" && inRange(r.day, range)) this.logged.delete(id);
    for (const r of rows) this.logged.set(r.id, copy({ ...r, source: "health_connect" }));
  }
  async loggedEntries(fromTs: number, limit = 50) {
    const rows = [...this.logged.values()].filter((r) => r.ts >= fromTs).sort((a, b) => b.ts - a.ts || b.createdAt - a.createdAt);
    return copy(rows.slice(0, limit));
  }
  async deleteLoggedEntry(id: string) {
    const r = this.logged.get(id);
    this.logged.delete(id);
    return r ? copy(r) : null;
  }

  async getReports() {
    return copy([...this.reports.values()].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0)));
  }
  async putReports(rows: ReportRow[]) {
    this.reports.clear();
    for (const r of rows) this.reports.set(r.period, copy(r));
  }

  async getActivityCost() {
    return this.activityCost && copy(this.activityCost);
  }
  async putActivityCost(data: ActivityCostResult) {
    this.activityCost = copy(data);
  }

  private checkpoint: string | null = null;
  async getCheckpoint() {
    return this.checkpoint;
  }
  async putCheckpoint(json: string | null) {
    this.checkpoint = json;
  }

  private chats = new Map<string, { title: string; messages: unknown[]; updatedAt: number }>();
  private leetcode = new Map<string, LeetCodeSnapshot>();
  async coachChats(limit: number, before?: { updatedAt: number; id: string }) {
    const after = (c: { id: string; updatedAt: number }) => !before || c.updatedAt < before.updatedAt || (c.updatedAt === before.updatedAt && c.id < before.id);
    return [...this.chats]
      .map(([id, c]) => ({ id, title: c.title, updatedAt: c.updatedAt }))
      .filter(after)
      .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, limit);
  }
  async coachChatCount() {
    return this.chats.size;
  }
  async coachChatMessages(id: string) {
    const c = this.chats.get(id);
    return c ? copy(c.messages) : null;
  }
  async putCoachChat(id: string, title: string, messages: unknown[], updatedAt: number) {
    this.chats.set(id, { title, messages: copy(messages), updatedAt });
  }
  async deleteCoachChats(id?: string) {
    if (id === undefined) this.chats.clear();
    else this.chats.delete(id);
  }

  async getLeetCode(username: string) {
    const s = this.leetcode.get(username);
    return s ? copy(s) : null;
  }
  async putLeetCode(snapshot: LeetCodeSnapshot) {
    this.leetcode.set(snapshot.username, copy(snapshot));
  }
  async deleteLeetCode(username: string) {
    this.leetcode.delete(username);
  }
  async clearLeetCode() {
    this.leetcode.clear();
  }


  // ── the gym log ───────────────────────────────────────────────────────────────────────────────────────────────────
  async gymExercises() {
    return [...this.gymEx.values()].sort((a, b) => a.name.localeCompare(b.name)).map(copy);
  }
  async putGymExercises(rows: GymExercise[]) {
    for (const r of rows) this.gymEx.set(r.id, copy(r));
  }
  async deleteGymExercise(id: string) {
    this.gymEx.delete(id);
  }
  async gymRoutines() {
    const routines = [...this.gymRoutineMap.values()].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)).map(copy);
    const items = [...this.gymItems.entries()]
      .flatMap(([routineId, list]) => list.map((i) => ({ ...copy(i), routineId })))
      .sort((a, b) => a.routineId.localeCompare(b.routineId) || a.position - b.position);
    return { routines, items };
  }
  async putGymRoutine(routine: GymRoutine, items: GymRoutineItem[]) {
    this.gymRoutineMap.set(routine.id, copy(routine));
    this.gymItems.set(routine.id, copy(items));
  }
  async deleteGymRoutine(id: string) {
    this.gymRoutineMap.delete(id);
    this.gymItems.delete(id);
  }
  async gymSessions() {
    return [...this.gymSessionMap.values()].sort((a, b) => b.startTs - a.startTs).map(copy);
  }
  async putGymSession(s: GymSession) {
    this.gymSessionMap.set(s.id, copy(s));
  }
  async deleteGymSession(id: string) {
    this.gymSessionMap.delete(id);
    for (const [setId, s] of this.gymSetMap) if (s.sessionId === id) this.gymSetMap.delete(setId);
  }
  async gymSets(sessionIds: string[]) {
    const want = new Set(sessionIds);
    return [...this.gymSetMap.values()]
      .filter((s) => want.has(s.sessionId))
      .sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.position - b.position || a.setNo - b.setNo)
      .map(copy);
  }
  async gymAllSets() {
    return [...this.gymSetMap.values()].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0) || a.position - b.position || a.setNo - b.setNo).map(copy);
  }
  async gymExerciseSets(exerciseIds: string[], beforeTs?: number) {
    const want = new Set(exerciseIds);
    return [...this.gymSetMap.values()]
      .filter((s) => want.has(s.exerciseId) && (beforeTs === undefined || (s.ts ?? 0) <= beforeTs))
      .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0) || a.position - b.position || a.setNo - b.setNo)
      .map(copy);
  }
  async putGymSet(s: GymSet) {
    this.gymSetMap.set(s.id, copy(s));
  }
  async putGymSets(sets: GymSet[]) {
    for (const s of sets) this.gymSetMap.set(s.id, copy(s));
  }
  async deleteGymSet(id: string) {
    this.gymSetMap.delete(id);
  }
  async gymMeasurements() {
    return [...this.gymMeasures.values()].sort((a, b) => b.day.localeCompare(a.day)).map(copy);
  }
  async putGymMeasurement(m: GymMeasurement) {
    for (const [id, row] of this.gymMeasures) if (row.day === m.day && row.kind === m.kind) this.gymMeasures.delete(id);
    this.gymMeasures.set(m.id, copy(m));
  }
  async deleteGymMeasurement(id: string) {
    this.gymMeasures.delete(id);
  }
  async getGymImport() {
    return this.gymImport && copy(this.gymImport);
  }
  async putGymImport(state: GymImportState) {
    this.gymImport = copy(state);
  }

  // ── the habits ───────────────────────────────────────────────────────────────────────────────────────────────────
  async habits() {
    return [...this.habitMap.values()].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)).map(copy);
  }
  async putHabit(habit: Habit) {
    this.habitMap.set(habit.id, copy(habit));
  }
  async deleteHabit(id: string) {
    this.habitMap.delete(id);
    for (const [k, e] of this.habitEntryMap) if (e.habitId === id) this.habitEntryMap.delete(k);
  }
  async habitEntries(from?: string, to?: string) {
    return [...this.habitEntryMap.values()]
      .filter((e) => (from === undefined || e.day >= from) && (to === undefined || e.day <= to))
      .sort((a, b) => a.day.localeCompare(b.day) || a.habitId.localeCompare(b.habitId))
      .map(copy);
  }
  async putHabitEntry(entry: HabitEntry) {
    this.habitEntryMap.set(key2(entry.habitId, entry.day), copy(entry));
  }
  async deleteHabitEntry(habitId: string, day: string) {
    this.habitEntryMap.delete(key2(habitId, day));
  }

  // ── the food orders ─────────────────────────────────────────────────────────────────────────────────────────────
  async foodOrders(from?: string, to?: string) {
    return [...this.foodOrderMap.values()]
      .filter((o) => (from === undefined || o.day >= from) && (to === undefined || o.day <= to))
      .sort((a, b) => b.ts - a.ts)
      .map(copy);
  }
  async putFoodOrder(order: FoodOrder) {
    for (const [id, existing] of this.foodOrderMap) if (existing.key === order.key) this.foodOrderMap.delete(id);
    this.foodOrderMap.set(order.id, copy(order));
  }
  async deleteFoodOrder(id: string) {
    this.foodOrderMap.delete(id);
  }

  // ── the location timeline ───────────────────────────────────────────────────────────────────────────────────────
  async places() {
    return [...this.placeMap.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map(copy);
  }
  async putPlace(place: Place) {
    this.placeMap.set(place.id, copy(place));
  }
  async deletePlace(id: string) {
    this.placeMap.delete(id);
  }
  async placeEvents(fromTs: number, toTs: number) {
    return [...this.placeEventMap.values()].filter((e) => e.ts >= fromTs && e.ts < toTs).sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id)).map(copy);
  }
  async addPlaceEvent(event: PlaceEvent) {
    if (!this.placeEventMap.has(event.id)) this.placeEventMap.set(event.id, copy(event));
  }
  async locationFixes(fromTs: number, toTs: number) {
    return [...this.fixMap.values()].filter((f) => f.ts >= fromTs && f.ts < toTs).sort((a, b) => a.ts - b.ts).map(copy);
  }
  async addLocationFixes(fixes: Fix[]) {
    for (const f of fixes) if (!this.fixMap.has(f.ts)) this.fixMap.set(f.ts, copy(f));
  }
  async pruneLocationFixes(beforeTs: number) {
    let n = 0;
    for (const ts of [...this.fixMap.keys()]) {
      if (ts >= beforeTs) continue;
      this.fixMap.delete(ts);
      n++;
    }
    return n;
  }
  async frozenStays(from: string, to: string) {
    return [...this.frozen].filter(([day]) => day >= from && day <= to).flatMap(([, xs]) => xs).sort((a, b) => a.start - b.start).map(copy);
  }
  async moveBuckets(fromTs: number, toTs: number) {
    return [...this.moves].filter(([b]) => b * 300 >= fromTs && b * 300 < toTs).sort((a, b) => a[0] - b[0]).map(([bucket, metres]) => ({ bucket, metres }));
  }
  async freezeDay(day: string, stays: FrozenStay[], fromTs: number, toTs: number, buckets: MoveBucket[]) {
    this.frozen.set(day, stays.map(copy));
    for (const b of [...this.moves.keys()]) if (b * 300 >= fromTs && b * 300 < toTs) this.moves.delete(b);
    for (const b of buckets) this.moves.set(b.bucket, b.metres);
  }
  async timelineOverrides(fromTs: number, toTs: number) {
    return [...this.overrides.values()].filter((o) => o.start < toTs && o.end > fromTs).sort((a, b) => a.createdAt - b.createdAt).map(copy);
  }
  async putTimelineOverride(o: TimelineOverride) {
    this.overrides.set(o.id, copy(o));
  }
  async deleteTimelineOverride(id: string) {
    this.overrides.delete(id);
  }
  async getTimelineState() {
    return copy(this.timelineState);
  }
  async setTimelineState(patch: Partial<TimelineState>) {
    this.timelineState = { ...this.timelineState, ...patch };
  }
  async clearPlaces() {
    for (const m of [this.placeMap, this.placeEventMap, this.fixMap, this.frozen, this.moves, this.overrides]) m.clear();
    this.timelineState = { mode: DEFAULT_MODE, frozenThrough: null };
  }

  async compactHr(beforeTs: number) {
    return this.hr.compact(beforeTs);
  }
  async reclaimSpace() {}
  async storageBytes() {
    return null;
  }

  async clearGym() {
    this.gymEx.clear();
    this.gymRoutineMap.clear();
    this.gymItems.clear();
    this.gymSessionMap.clear();
    this.gymSetMap.clear();
    this.gymMeasures.clear();
    this.gymImport = null;
  }

  async clearHabits() {
    this.habitMap.clear();
    this.habitEntryMap.clear();
  }

  async clearFoodOrders() {
    this.foodOrderMap.clear();
  }

  async clearAll() {
    this.profile = null;
    this.sync = { lastSyncTs: null, firstDay: null, lastError: null };
    for (const m of [this.metrics, this.sessions, this.segments, this.exercises, this.values, this.journal, this.scores, this.series, this.reports]) m.clear();
    this.activityCost = null;
    this.checkpoint = null;
    this.tags.clear();
    this.logged.clear();
    this.records.clear();
    this.bloodPressure.clear();
    this.hr.clear();
    this.steps.clear();
    this.hrv.clear();
    this.dirty.clear();
  }
}

export const openMemoryStore = (): Store => new MemoryStore();
