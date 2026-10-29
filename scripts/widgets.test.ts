import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { addWidgetDeclarations } = require("../plugins/withWidgets.js");
const { widgetStrings } = require("../plugins/widgetResources.js");

describe("widget native configuration", () => {
  it("is idempotent and preserves other manifest components", () => {
    const activity = { $: { "android:name": ".MainActivity" } };
    const receiver = { $: { "android:name": "existing.Receiver" } };
    const manifest = { manifest: { application: [{ activity: [activity], receiver: [receiver] }] } };
    addWidgetDeclarations(manifest);
    const once = JSON.stringify(manifest);
    addWidgetDeclarations(manifest);
    expect(JSON.stringify(manifest)).toBe(once);
    expect(manifest.manifest.application[0].receiver[0]).toEqual(receiver);
    expect(manifest.manifest.application[0].activity[0]).toEqual(activity);
    expect(manifest.manifest.application[0].receiver).toHaveLength(4);
    expect(manifest.manifest.application[0].activity).toHaveLength(2);
  });
  it("keeps packaged native text in sync with English translation keys", () => {
    expect(readFileSync("modules/pulse-widgets/android/src/main/res/values/strings.xml", "utf8")).toBe(widgetStrings());
  });
});
