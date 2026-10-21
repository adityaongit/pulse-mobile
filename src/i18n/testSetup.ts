// Vitest setup: i18next in English, synchronously, so tests that read copy keep asserting English.
import { initI18n } from "./config";
import "./types";

initI18n("en");
