# Notes for i18n workers (wave A hand-off)

- Metric labels: `metricLabel(key)` / `groupLabel(key)` from `src/lib/metricLabels.ts`; `.label` on the dashboard and extra-metric catalogues are getters. A spread copy or `.map` reading `.label` at module level freezes the text.
- `BAND_WORD`, `STRESS_WORD`, `REASONS[c].short`, `TAG_COPY.*`, `SOURCE_POLICY_LABELS` are getters. `reasonCopy()` unchanged.
- Spoken helpers in `src/lib/format.ts` (`dayLabel`, `dayPhrase`, `pillLabel`, `durationWords`, `ago`, `agoShort`, `unitWord`, `spoken`, `dialAriaLabel`, `statSentence`) already go through `common`.
- `cardInfo(title)` takes the ENGLISH title as its lookup id and returns translated text. Keep passing the English id to `SectionShell` (or pass `info`); a translated title makes the info button disappear.
- `useTranslation("x")` types only keys of its own namespace. For another namespace use `i18n.t("common:…")` or `t("actions.back", { ns: "common" })`.
- Shared keys to reuse: `common:actions.{save,cancel,back,tryAgain,checkIn,close,later,update}`, `reasons:noData.long`, `ui:sync.*`.
- Metric ids under `metrics:label.*` stay snake_case (stored ids).
