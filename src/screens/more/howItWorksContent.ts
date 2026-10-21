// "How Pulse works" (More): one explainer per score, written from src/core and docs/algorithms. Every number here
// is the code's; when the code changes, change this file.
import { i18n } from "@/i18n/config"
export type HowRow = { term: string; detail: string }
export type HowSection = { title: string; paragraphs?: string[]; rows?: HowRow[] }
export type ScoreDoc = {
  /** URL segment: /more/how-it-works/<slug>. */
  slug: string
  /** Display name, e.g. "Recovery", "Pulse Age". */
  name: string
  /** One short sentence (max ~70 characters) shown as the page intro and as a caption. */
  summary: string
  /** The in-app screen where the score lives, e.g. "/recovery", "/health/healthspan"; null if none. */
  href: string | null
  /** In this order: "What goes in", "How it is weighted", "What the bands mean", optionally "A worked example" (real numbers run through the code), "Limits". Omit a section only if it truly does not apply (say so in Limits instead). */
  sections: HowSection[]
}

// Shape table: slug, key group in the howItWorks namespace, screen, and per section [paragraph count, row count].
// The text is read at access time (getters), never at module level, so a language change shows at once.
type Shape = [slug: string, group: string, href: string | null, sections: [number, number][]]
const SHAPES: Shape[] = [
  ["recovery", "recovery", "/recovery", [[1,5],[1,5],[1,3],[1,0]]],
  ["strain", "strain", "/strain", [[0,4],[1,6],[1,4],[2,0]]],
  ["strain-target", "strainTarget", "/strain", [[0,2],[1,0],[0,3],[2,0],[1,0]]],
  ["sleep", "sleep", "/sleep", [[1,6],[1,6],[1,3],[1,0]]],
  ["sleep-planner", "sleepPlanner", "/sleep", [[0,4],[3,0],[0,3],[1,0]]],
  ["pulse-age", "pulseAge", "/health/healthspan", [[1,9],[2,0],[0,4],[1,0]]],
  ["stress", "stress", "/health/stress", [[0,4],[1,0],[0,3],[1,0]]],
  ["energy-bank", "energyBank", "/", [[0,4],[1,4],[1,3],[1,0]]],
  ["health-monitor", "healthMonitor", "/health/monitor", [[0,4],[2,0],[0,3],[1,0]]],
  ["fitness", "fitness", "/health/fitness", [[0,2],[1,0],[0,5],[4,0],[1,0]]],
  ["training-balance", "trainingBalance", "/health/fitness", [[0,2],[1,0],[0,4],[1,0]]],
  ["journal-impact", "journalImpact", "/journal/insights", [[0,2],[1,0],[0,3],[4,0],[1,0]]],
  ["sleep-consistency", "sleepConsistency", "/sleep", [[0,1],[2,0],[0,3],[1,0]]],
  ["training-load", "trainingLoad", "/health/fitness", [[1,0],[1,3],[0,2],[3,0],[1,0]]],
  ["hr-recovery", "hrRecovery", null, [[0,2],[1,0],[0,3],[3,0],[1,0]]],
  ["hrv-status", "hrvStatus", "/health", [[1,0],[1,0],[0,3],[1,0]]],
  ["training-readiness", "trainingReadiness", "/strain", [[0,6],[3,0],[0,5],[1,0]]],
  ["training-effect", "trainingEffect", null, [[0,3],[2,0],[0,6],[1,0]]],
  ["training-status", "trainingStatus", "/strain", [[0,3],[1,0],[0,4],[1,0]]],
]

function build([slug, group, href, shape]: Shape): ScoreDoc {
  const t = (k: string) => i18n.t(`howItWorks:${group}.${k}` as never) as string
  return {
    slug,
    href,
    get name() {
      return t("name")
    },
    get summary() {
      return t("summary")
    },
    get sections() {
      return shape.map(([np, nr], s) => ({
        title: t(`s${s}Title`),
        paragraphs: np ? Array.from({ length: np }, (_, p) => t(`s${s}P${p}`)) : undefined,
        rows: nr ? Array.from({ length: nr }, (_, r) => ({ term: t(`s${s}R${r}Term`), detail: t(`s${s}R${r}Detail`) })) : undefined,
      }))
    },
  }
}

export const SCORE_DOCS: ScoreDoc[] = SHAPES.map(build)
