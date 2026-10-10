import { expect, it } from "vitest";
import { cn } from "./cn";

it("a later class overrides an earlier one of the same kind, as the web's cn", () => {
  expect(cn("px-4 py-4", "py-0")).toBe("px-4 py-0");
  expect(cn("rounded-2xl", "rounded-4xl")).toBe("rounded-4xl");
  expect(cn("text-xs text-muted-foreground", "text-foreground")).toBe("text-xs text-foreground");
  expect(cn("text-[15px]", "text-xs")).toBe("text-xs");
  expect(cn("bg-card", false, null, undefined, "bg-foreground/8")).toBe("bg-foreground/8");
  expect(cn("font-numeric font-bold", "font-semibold")).toBe("font-numeric font-semibold");
});
