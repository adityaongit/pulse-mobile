/**
 * UI that matches the reference app but has no data source in Pulse yet. Each component is built and kept off
 * until its backend exists; turning a flag on is the only change needed to show it.
 */
export const FEATURES = {
  /** Record a workout live (type picker, map, live heart rate). Pulse imports workouts from Fitbit instead. */
  startActivity: false,
  /** Add a past workout by hand (type picker, start and end). Pulse can't write a workout to Google Health. */
  logActivity: false,
  /** Log a strength session exercise by exercise. */
  strengthTrainer: false,
  /** Share a live workout card. */
  liveShare: false,
  /** A multi-day coaching plan with progress. */
  myPlan: false,
  /** A smart alarm set from Pulse. Fitbit's alarms are not readable through Google Health. */
  sleepAlarm: false,
  /** Share of the night in high, medium and low stress. Pulse's stress model leaves sleep minutes out. */
  sleepStress: false,
  /** Weekly zone, strength and step goals. Pulse has no goals or weekly plan. */
  goals: false,
  /** Health's Blood Pressure Insights (Beta). Pulse reads no blood pressure. */
  bloodPressure: false,
  /** An activity's strain split into cardio and muscular load. Pulse measures heart rate only. */
  muscularLoad: false,
} as const
