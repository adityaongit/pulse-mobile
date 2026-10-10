import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { router, type Href } from "expo-router";
import { ArrowUpRight, ChevronRight, type LucideIcon } from "lucide-react-native";
import * as Linking from "expo-linking";
import { CARD_CLASS, CardFill, useCardStyle } from "../Card";
import { cn } from "../cn";
import { Icon } from "../Icon";
import { SkeletonText } from "../Skeleton";
import { Text } from "../Text";

export type LinkListRow = {
  label: string;
  href: string;
  icon?: LucideIcon;
  /** Right-aligned, before the chevron: a short caption ("Sep 22 - Sep 28") or a node (a ring and value). */
  aside?: ReactNode;
  /** A line under the label, sentence case (a score's one-line summary). */
  description?: string;
  /** Opens outside the app (the system browser) with an arrow instead of the chevron. */
  external?: boolean;
};

/** List-like pages (More, Settings): one centred column. */
export const MORE_COLUMN = "w-full gap-6";

/** The reference app's section label over a group of rows (spec §11 F22): 13 px caps, tracking 0.1em. */
export const GROUP_LABEL = "px-1 text-[13px] font-bold uppercase leading-4 tracking-[0.1em] text-foreground/85";
const ROW = "min-h-14 flex-row items-center gap-3 px-4 py-2";
const ROW_LABEL = "text-xs font-bold uppercase leading-4 tracking-[0.1em]";

/**
 * The reference app's settings rows (spec §7.14 v2): a caps group label, then one 56 px card per row with an icon, a
 * caps label and a chevron. (The web's two-column layout from 1280 px is a laptop concern and is not ported.)
 */
export function LinkList({ title, rows, className }: { title: string; rows: LinkListRow[]; className?: string }) {
  const shadow = useCardStyle();
  return (
    <View accessibilityLabel={title} className={cn("min-w-0 gap-2", className)}>
      <Text accessibilityRole="header" className={GROUP_LABEL}>
        {title}
      </Text>
      <View className="gap-2">
        {rows.map((r) => (
          <Pressable
            key={r.href}
            accessibilityRole="link"
            accessibilityHint={r.external ? "Opens outside the app" : undefined}
            onPress={() => (r.external ? Linking.openURL(r.href) : router.push(r.href as Href))}
            className={cn(CARD_CLASS, ROW, "active:scale-[0.96]")}
            style={shadow}
          >
            <CardFill />
            {r.icon && <Icon icon={r.icon} size={22} tone="foreground-secondary" strokeWidth={1.5} />}
            <View className="min-w-0 flex-1">
              <Text className={ROW_LABEL}>{r.label}</Text>
              {r.description && <Text className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">{r.description}</Text>}
            </View>
            {typeof r.aside === "string" ? <Text className="shrink-0 font-numeric text-xs font-medium leading-4 tabular-nums text-muted-foreground">{r.aside}</Text> : r.aside}
            <Icon icon={r.external ? ArrowUpRight : ChevronRight} size={20} tone="muted-foreground" />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Loading shape (spec §5.19): the real group label and row labels; only asides are bars. */
export function LinkListSkeleton({ title, rows }: { title: string; rows: Omit<LinkListRow, "href" | "aside">[] }) {
  const shadow = useCardStyle();
  return (
    <View accessibilityElementsHidden className="min-w-0 gap-2">
      <Text className={GROUP_LABEL}>{title}</Text>
      <View className="gap-2">
        {rows.map((r, i) => (
          <View key={i} className={cn(CARD_CLASS, ROW)} style={shadow}>
            <CardFill />
            {r.icon && <Icon icon={r.icon} size={22} tone="foreground-secondary" strokeWidth={1.5} />}
            <View className="min-w-0 flex-1">
              {r.label ? <Text className={ROW_LABEL}>{r.label}</Text> : <SkeletonText className="w-28" />}
              {r.description && <Text className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">{r.description}</Text>}
            </View>
            <Icon icon={ChevronRight} size={20} tone="muted-foreground" />
          </View>
        ))}
      </View>
    </View>
  );
}
