import { i18n } from "@/i18n/config";
import { View } from "react-native";
import { reasonCopy } from "@/lib/reasons";
import { cn } from "../cn";
import { Icon } from "../Icon";
import { REASON_ICON } from "../icons";
import { Text } from "../Text";

export type ReasonPlaceholderProps = {
  /** Any string; unknown codes fall back to `no_data`. */
  reason: string | null | undefined;
  nightsLeft?: number;
  size: "sm" | "md" | "lg";
  /** Replaces the long copy where a screen words it its own way ("Forecast starts after 14 nights."). */
  copy?: string;
  className?: string;
};

/** Copy and icon for a reason code (spec §5.14). Text is real text; the icon is decorative. */
export function ReasonPlaceholder({ reason, nightsLeft, size, copy, className }: ReasonPlaceholderProps) {
  const r = reasonCopy(reason, nightsLeft);
  const glyph = REASON_ICON[r.code];
  const long = copy ?? r.long;

  if (size === "sm")
    return (
      <View className={cn("flex-row items-center gap-1.5", className)}>
        {glyph && <Icon icon={glyph} size={14} tone="muted-foreground" />}
        <Text className="shrink text-xs font-medium leading-4 text-muted-foreground">{long}</Text>
      </View>
    );

  if (size === "md")
    return (
      <View className={cn("items-center gap-2 py-6", className)}>
        {glyph && <Icon icon={glyph} size={20} tone="muted-foreground" />}
        {/* max-w-[36ch] on the web */}
        <Text className="max-w-72 text-center text-[15px] leading-[22px] text-foreground-secondary">{long}</Text>
      </View>
    );

  return (
    <View className={cn("items-center gap-2", className)}>
      {glyph && <Icon icon={glyph} size={24} tone="foreground-secondary" />}
      <Text className="max-w-40 text-center text-base font-semibold leading-[22px] text-foreground-secondary" numberOfLines={2}>
        {r.code === "no_data" ? i18n.t("reasons:noData.long") : r.short}
      </Text>
    </View>
  );
}
