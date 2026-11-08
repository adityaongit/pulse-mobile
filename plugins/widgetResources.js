// Native launcher/configuration copy is generated from the same i18n source as React. Tests prevent drift.
const copy = require("../src/i18n/locales/en/widgets.json");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "\\'").replace(/"/g, '\\"');
function widgetStrings() {
  const values = {
    pulse_widget_brand: "Pulse", pulse_widget_configure: copy.configure, pulse_widget_choose: copy.choose,
    pulse_widget_choose_large: copy.chooseLarge, pulse_widget_save: copy.save, pulse_widget_cancel: copy.cancel, pulse_widget_empty: copy.emptySelection,
    pulse_widget_too_many: copy.tooMany, pulse_widget_description: copy.description,
    pulse_widget_small: copy.sizes.small, pulse_widget_medium: copy.sizes.medium, pulse_widget_large: copy.sizes.large,
    ...Object.fromEntries(Object.entries(copy.state).map(([k, v]) => [`pulse_widget_${k}`, v])),
    ...Object.fromEntries(Object.entries(copy.labels).map(([key, value]) => [`pulse_widget_metric_${key}`, value])),
  };
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${Object.entries(values).map(([k, v]) => `  <string name="${k}">${esc(v)}</string>`).join("\n")}\n</resources>\n`;
}
module.exports = { widgetStrings };
