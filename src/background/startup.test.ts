import { beforeEach, describe, expect, it, vi } from "vitest";

// AsyncStorage as a map, and the notification calls recorded: what applyCheckIn schedules or cancels.
const saved = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => saved.get(k) ?? null,
    setItem: async (k: string, v: string) => void saved.set(k, v),
    removeItem: async (k: string) => void saved.delete(k),
  },
}));
const calls: string[] = [];
vi.mock("./notify", () => ({
  installNotificationHandler: () => {},
  notificationPermission: async () => "granted",
  scheduleCheckIn: async (h: number, m: number) => void calls.push(`schedule ${h}:${m}`),
  cancelCheckIn: async () => void calls.push("cancel"),
}));
vi.mock("./task", () => ({ syncRegistration: async () => {} }));
const { applyCheckIn } = await import("./startup");
const { journalHidden, saveJournalHidden } = await import("@/actions/preferences");

describe("the check-in reminder and the hidden Journal", () => {
  beforeEach(() => {
    saved.clear();
    calls.length = 0;
  });

  it("shows the Journal until the person hides it, and shows it again after", async () => {
    expect(await journalHidden()).toBe(false);
    await saveJournalHidden(true);
    expect(await journalHidden()).toBe(true);
    await saveJournalHidden(false);
    expect(await journalHidden()).toBe(false);
  });

  it("schedules the reminder while the Journal shows, cancels it while hidden, keeps the setting either way", async () => {
    const s = { checkIn: true, checkInTime: "21:30" };
    await applyCheckIn(s);
    await saveJournalHidden(true);
    await applyCheckIn(s);
    await saveJournalHidden(false);
    await applyCheckIn(s);
    expect(calls).toEqual(["schedule 21:30", "cancel", "schedule 21:30"]);
  });
});
