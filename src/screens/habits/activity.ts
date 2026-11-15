// The Activity row on Habits: the glyph, colour and name of each kind of workout. One row holds every kind; a day shows
// a bubble per kind done that day.
import { Activity, Bike, Dumbbell, Feather, Footprints, PersonStanding, Timer, Waves, type LucideIcon } from "lucide-react-native";
import type { ActivityKind } from "@/queries/habits";
import type { TokenName } from "@/ui/palette";

type KindLook = { icon: LucideIcon; color: TokenName };

export const ACTIVITY_LOOK: Record<ActivityKind, KindLook> = {
  walk: { icon: Footprints, color: "optimal" },
  run: { icon: PersonStanding, color: "recovery-red" },
  ride: { icon: Bike, color: "strain" },
  strength: { icon: Dumbbell, color: "stage-rem" },
  elliptical: { icon: Activity, color: "warning" },
  racket: { icon: Feather, color: "coach" },
  swim: { icon: Waves, color: "sleep" },
  yoga: { icon: PersonStanding, color: "recovery-yellow" },
  other: { icon: Timer, color: "muted-foreground" },
};
