// Types the keys from the English files: a misspelt or missing key fails `pnpm typecheck`.
import type common from "./locales/en/common.json";
import type reasons from "./locales/en/reasons.json";
import type metrics from "./locales/en/metrics.json";
import type home from "./locales/en/home.json";
import type sleep from "./locales/en/sleep.json";
import type recovery from "./locales/en/recovery.json";
import type strain from "./locales/en/strain.json";
import type health from "./locales/en/health.json";
import type journal from "./locales/en/journal.json";
import type trends from "./locales/en/trends.json";
import type nutrition from "./locales/en/nutrition.json";
import type goals from "./locales/en/goals.json";
import type reports from "./locales/en/reports.json";
import type coach from "./locales/en/coach.json";
import type settings from "./locales/en/settings.json";
import type onboarding from "./locales/en/onboarding.json";
import type more from "./locales/en/more.json";
import type howItWorks from "./locales/en/howItWorks.json";
import type notifications from "./locales/en/notifications.json";
import type errors from "./locales/en/errors.json";
import type ui from "./locales/en/ui.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: { common: typeof common, reasons: typeof reasons, metrics: typeof metrics, home: typeof home, sleep: typeof sleep, recovery: typeof recovery, strain: typeof strain, health: typeof health, journal: typeof journal, trends: typeof trends, nutrition: typeof nutrition, goals: typeof goals, reports: typeof reports, coach: typeof coach, settings: typeof settings, onboarding: typeof onboarding, more: typeof more, howItWorks: typeof howItWorks, notifications: typeof notifications, errors: typeof errors, ui: typeof ui };
    returnNull: false;
  }
}
