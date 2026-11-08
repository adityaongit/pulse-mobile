import { beforeEach, describe, expect, it, vi } from "vitest";

const pushed: string[] = [];
const linked: string[] = [];
vi.mock("expo-router", () => ({ router: {
  push: (h: string) => pushed.push(h),
  canDismiss: () => true,
  dismissAll: () => linked.push("dismiss"),
  navigate: (h: string) => linked.push(h),
} }));
const { push, openLink } = await import("./navigate");

describe("push", () => {
  beforeEach(() => vi.useFakeTimers());
  it("drops a second push while the first is in flight, then lets the next one through", () => {
    vi.setSystemTime(10_000);
    push("/sleep");
    push("/sleep"); // double tap
    vi.setSystemTime(10_300);
    push("/recovery"); // another card mid-animation
    vi.setSystemTime(10_600);
    push("/recovery");
    expect(pushed).toEqual(["/sleep", "/recovery"]);
  });
});

it("closes stacked details before opening an external Workout tab link", () => {
  openLink("/workout?source=shortcut");
  expect(linked).toEqual(["dismiss", "/workout?source=shortcut"]);
});
