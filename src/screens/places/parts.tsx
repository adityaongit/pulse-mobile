// Shared pieces of the timeline's screens: a place's glyph and name, and the short duration and distance texts.
import type { LucideIcon } from "lucide-react-native";
import { Briefcase, Dumbbell, GraduationCap, House, MapPin, ShoppingBag, Trees, Utensils } from "lucide-react-native";
import { View } from "react-native";
import { i18n } from "@/i18n/config";
import type { PlaceIcon } from "@/core/places/types";
import { formatValue } from "@/lib/format";
import { quantity } from "@/lib/units";
import type { PlaceRef } from "@/queries/timeline";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";

export const PLACE_GLYPH: Record<PlaceIcon, LucideIcon> = {
  home: House,
  work: Briefcase,
  gym: Dumbbell,
  school: GraduationCap,
  shop: ShoppingBag,
  food: Utensils,
  park: Trees,
  other: MapPin,
};

/** The place's name, the owner's label for an unknown stop, or "Unknown place". */
export const stayName = (place: PlaceRef | null, label?: string | null) => place?.name ?? (label || i18n.t("places:stay.unknown"));

/** "45 min", "2 h", "7 h 12 min". */
export function shortDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return i18n.t("places:dur.m", { m: r });
  return r ? i18n.t("places:dur.hm", { h, m: r }) : i18n.t("places:dur.h", { h });
}

/** "0.8 km", "1.2 mi"; "≈ 0.6 km" when only the straight line is known. */
export function distanceShort(metres: number, approx: boolean): string {
  const d = quantity("km");
  const text = `${formatValue("decimal1", d.value(metres / 1000))} ${d.unit}`;
  return approx ? i18n.t("places:trip.approx", { distance: text }) : text;
}

/** A place's round glyph: filled for a saved place, outlined for an unknown stop. */
export function PlaceBadge({ icon, size = 36, className }: { icon: PlaceIcon | null; size?: number; className?: string }) {
  return (
    <View
      accessibilityElementsHidden
      className={cn("items-center justify-center rounded-full", icon ? "bg-secondary" : "border border-dashed border-border", className)}
      style={{ width: size, height: size }}
    >
      <Icon icon={icon ? PLACE_GLYPH[icon] : MapPin} size={Math.round(size * 0.45)} tone={icon ? "foreground" : "muted-foreground"} />
    </View>
  );
}
