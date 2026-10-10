import { describe, expect, it } from "vitest";
import { ordinal } from "./format";

describe("ordinal", () => {
  it("picks the English suffix", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 78, 101, 111].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "78th", "101st", "111th",
    ]);
  });
  it("agrees with Intl.PluralRules, the web's source, for 0 to 200", () => {
    const rules = new Intl.PluralRules("en-US", { type: "ordinal" });
    const suffix = { one: "st", two: "nd", few: "rd" } as Record<string, string>;
    for (let n = 0; n <= 200; n++) expect(ordinal(n)).toBe(`${n}${suffix[rules.select(n)] ?? "th"}`);
  });
});
