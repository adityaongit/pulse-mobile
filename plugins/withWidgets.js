// Only declarations belong in the generated app manifest. All widget code/resources live in the local Expo module.
const { withAndroidManifest } = require("expo/config-plugins");
const BASE = "app.pulse.widgets";
const PROVIDERS = ["Small", "Medium", "Large"];

function addWidgetDeclarations(manifest) {
  const app = manifest.manifest?.application?.[0];
  if (!app) throw new Error("[withWidgets] Android application is missing");
  app.receiver ??= [];
  for (const size of PROVIDERS) {
    const name = `${BASE}.Pulse${size}WidgetProvider`;
    const entry = {
      $: { "android:name": name, "android:exported": "false", "android:label": `@string/pulse_widget_${size.toLowerCase()}` },
      "intent-filter": [{ action: [{ $: { "android:name": "android.appwidget.action.APPWIDGET_UPDATE" } }] }],
      "meta-data": [{ $: { "android:name": "android.appwidget.provider", "android:resource": `@xml/pulse_widget_${size.toLowerCase()}_info` } }],
    };
    const index = app.receiver.findIndex((r) => r.$["android:name"] === name);
    if (index < 0) app.receiver.push(entry); else app.receiver[index] = entry;
  }
  app.activity ??= [];
  const name = `${BASE}.WidgetConfigureActivity`;
  const entry = {
    $: { "android:name": name, "android:exported": "true", "android:label": "@string/pulse_widget_configure", "android:theme": "@android:style/Theme.Material.Light.NoActionBar" },
    "intent-filter": [{ action: [{ $: { "android:name": "android.appwidget.action.APPWIDGET_CONFIGURE" } }] }],
  };
  const index = app.activity.findIndex((a) => a.$["android:name"] === name);
  if (index < 0) app.activity.push(entry); else app.activity[index] = entry;
  return manifest;
}
module.exports = (config) => withAndroidManifest(config, (c) => { addWidgetDeclarations(c.modResults); return c; });
module.exports.addWidgetDeclarations = addWidgetDeclarations;
