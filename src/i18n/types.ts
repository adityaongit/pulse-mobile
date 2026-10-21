// Types the keys from the English files: a misspelt or missing key fails `pnpm typecheck`.
import type common from "./locales/en/common.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: { common: typeof common };
    returnNull: false;
  }
}
