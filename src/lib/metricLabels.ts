// Metric and group names for My Dashboard, Trends and the daily export (metrics namespace). Catalogues keep keys and a
// `label` getter, so the name resolves when it is read, in the language then in use.
import { i18n } from "@/i18n/config"

export type LabelKey = keyof typeof import("@/i18n/locales/en/metrics.json")["label"]
export type GroupKey = keyof typeof import("@/i18n/locales/en/metrics.json")["group"]

export const metricLabel = (key: LabelKey) => i18n.t(`metrics:label.${key}`)
export const groupLabel = (key: GroupKey) => i18n.t(`metrics:group.${key}`)

/** A copy of `entry` with a `label` getter for `entry.key`. Spreading it reads the label once, at that moment. */
export function withLabel<T extends { key: LabelKey }>(entry: T): T & { readonly label: string } {
  return Object.defineProperty({ ...entry }, "label", { get: () => metricLabel(entry.key), enumerable: true }) as T & { readonly label: string }
}

/** `{ key: label }` as an object of getters: `LABELS[key]` resolves per read. */
export function labelRecord<K extends LabelKey>(keys: readonly K[]): Record<K, string> {
  const o = {} as Record<K, string>
  for (const k of keys) Object.defineProperty(o, k, { get: () => metricLabel(k), enumerable: true })
  return o
}
