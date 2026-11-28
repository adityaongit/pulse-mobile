import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { openStore } from "./db";

const handles = vi.hoisted(() => new Set<DatabaseSync>());
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async (name: string) => {
    const db = new DatabaseSync(name);
    handles.add(db);
    return {
      isInTransactionSync: () => db.isTransaction,
      execAsync: async (sql: string) => db.exec(sql),
      getAllAsync: async (sql: string, args: SQLInputValue[] = []) => db.prepare(sql).all(...args),
      runAsync: async (sql: string, args: SQLInputValue[]) => db.prepare(sql).run(...args),
    };
  },
}));

it("upgrades a 0.5.0 journal, saves removals atomically and keeps them across a reopen", async ({ onTestFinished }) => {
  const dir = mkdtempSync(join(tmpdir(), "pulse-journal-"));
  const file = join(dir, "journal.db");
  const close = () => {
    for (const db of handles) db.close();
    handles.clear();
  };
  onTestFinished(() => { close(); rmSync(dir, { recursive: true, force: true }); });
  const old = new DatabaseSync(file);
  old.exec(`create table journal_tags (tag text primary key, label text not null, is_default integer not null,
    hidden integer not null, position integer not null, seq integer not null);
    insert into journal_tags values ('sauna','Sauna',1,0,3,1), ('custom','My habit',0,1,4,2);`);
  old.close();

  const store = await openStore(file);
  expect((await store.journalTags()).map((t) => [t.tag, t.hidden, t.removed])).toEqual([["sauna", false, false], ["custom", true, false]]);
  const changes = [{ tag: "sauna", hidden: true, removed: true }];
  const newTags = [{ tag: "camping", label: "Camping", isDefault: false, hidden: true, removed: true, position: 0 }];
  const [db] = handles;
  db.exec("create trigger fail_update before update on journal_tags begin select raise(abort, 'test failure'); end");
  const edit = () => ({ result: undefined, update: changes, insert: newTags });
  await expect(store.editJournalTags(edit)).rejects.toThrow("test failure");
  expect((await store.journalTags()).map((t) => t.tag)).toEqual(["sauna", "custom"]);
  db.exec("drop trigger fail_update");
  await store.editJournalTags(edit);
  close();

  const reopened = await openStore(file);
  await reopened.updateJournalTags([{ tag: "sauna", hidden: false }]);
  expect(await reopened.journalTags()).toEqual([
    newTags[0],
    { tag: "sauna", label: "Sauna", isDefault: true, hidden: true, removed: true, position: 3 },
    { tag: "custom", label: "My habit", isDefault: false, hidden: true, removed: false, position: 4 },
  ]);
});
