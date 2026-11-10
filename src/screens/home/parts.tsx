// Small pieces of Home's page that the web writes as class strings or inline: the 48 px card button, the 32 px icon
// link in a card header, the 56 px gradient banner rows.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react-native";
import { CARD_BUTTON, CardEdge, useCardStyle } from "@/ui/Card";
import { Gradient } from "@/ui/Gradient";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { push } from "@/ui/navigate";
import { Press } from "@/ui/Press";

/** A card button's icon and caps label. `compact`: two buttons side by side, so the label keeps room at the edges. */
export function CardButtonContent({ icon, label, compact = false }: { icon: LucideIcon; label: string; compact?: boolean }) {
  return (
    <>
      <Icon icon={icon} size={compact ? 17 : 20} tone="foreground" strokeWidth={2} />
      <Text numberOfLines={1} className={compact ? "shrink text-[12px] font-bold uppercase leading-4 tracking-[0.06em]" : "text-[13px] font-bold uppercase leading-4 tracking-[0.1em]"}>{label}</Text>
    </>
  );
}

/** A card button that opens a route. */
export function CardButtonLink({ href, icon, label, className, compact }: { href: string; icon: LucideIcon; label: string; className?: string; compact?: boolean }) {
  return (
    <Press accessibilityRole="link" onPress={() => push(href)} activeScale={0.96} className={`${CARD_BUTTON} ${className ?? ""}`}>
      <CardButtonContent icon={icon} label={label} compact={compact} />
    </Press>
  );
}

/** The 32 px icon link in a card's header (open all activities, Journal, the Sleep Planner): 44 px to touch. */
export function IconLink({ href, label, icon }: { href: string; label: string; icon: LucideIcon }) {
  return (
    <Press activeOpacity={0.7} accessibilityRole="link" accessibilityLabel={label} onPress={() => push(href)} hitSlop={6} className="size-8 items-center justify-center rounded-md">
      <Icon icon={icon} size={18} tone="foreground-secondary" strokeWidth={1.75} />
    </Press>
  );
}

/** The 56 px gradient banner rows: the day's outlook or review, and the week in review (spec §7.1 7a, 10). */
export function GradientBanner({ from, to, onPress, role, accessibilityLabel, children }: { from: string; to: string; onPress: () => void; role: "link" | "button"; accessibilityLabel?: string; children: ReactNode }) {
  const shadow = useCardStyle();
  const { scheme } = useTheme();
  return (
    <Press activeScale={0.96} accessibilityRole={role} accessibilityLabel={accessibilityLabel} onPress={onPress} className="h-14 w-full flex-row items-center gap-3 overflow-hidden rounded-2xl px-4" style={shadow}>
      <Gradient from={from} to={to} />
      {/* The gradient covers the card's own lit top edge, so it is drawn again over it. */}
      {scheme === "dark" && <CardEdge />}
      {children}
    </Press>
  );
}
