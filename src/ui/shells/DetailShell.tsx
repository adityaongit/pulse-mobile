import { Children, cloneElement, isValidElement, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { Text } from "../Text";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { InfoContent } from "./InfoButton";
import { CollapsingHeader, type HeaderStats } from "./CollapsingHeader";
import type { DateSwitcherProps } from "./DateSwitcher";
import { DateSwitcher } from "./DateSwitcher";
import { DetailHeader, type DetailHeaderProps } from "./DetailHeader";
import { HEADER_ROW } from "./Header";
import { ScreenScroll, type ScreenScrollProps, useCollapse } from "./ScreenScroll";

export type DetailShellProps = {
  title: string;
  subtitle?: string;
  info?: InfoContent;
  /** Overrides the screen Back returns to when there is no history (a deep link). */
  backHref?: string;
  /** `placement: "header"` makes the date the header title (Recovery, Strain, Sleep); else the pill sits under the header. */
  dateSwitcher?: DateSwitcherProps;
  dismiss?: DetailHeaderProps["dismiss"];
  align?: DetailHeaderProps["align"];
  titleIcon?: ReactNode;
  action?: ReactNode;
  ground?: "default" | "healthspan";
  /** The hero component. With `collapse`, it must accept `compact` (or forward it to the component inside). */
  hero?: ReactNode;
  stats?: HeaderStats;
  collapse?: boolean;
  summary?: ReactNode;
  notch?: boolean;
  insight?: ReactNode;
  primary?: ReactNode;
  /** Cards in one column on a phone (the web balances them in two from 1280 px). */
  secondary?: ReactNode[];
  footer?: ReactNode;
  /** Pull to refresh (see ScreenScroll): wire it to "sync now". */
  onRefresh?: ScreenScrollProps["onRefresh"];
  /** A route's loading state: says "Loading…" to screen readers while skeletons show. */
  loading?: boolean;
};

export function DetailShell({ title, subtitle, info, backHref, dateSwitcher, dismiss, align, titleIcon, action, ground, hero, stats, collapse, summary, notch, insight, primary, secondary, footer, loading, onRefresh }: DetailShellProps) {
  const insets = useSafeAreaInsets();
  const side = summary ?? (hero ? insight : null);
  const inHeader = dateSwitcher?.placement === "header";
  const headerProps = { title, subtitle, info, backHref, dismiss, align, titleIcon, action, dateTitle: inHeader ? dateSwitcher : undefined };
  const [headerHeight, setHeaderHeight] = useState(insets.top + HEADER_ROW);
  const { scrollY, threshold, onScroll, progress } = useCollapse();
  const heroBox = useRef<View>(null);
  // The compact hero, drawn in the header's second row.
  const compact = collapse && isValidElement<{ compact?: boolean }>(hero) ? cloneElement(hero, { compact: true }) : null;
  const header = compact ? <CollapsingHeader {...headerProps} compact={compact} stats={stats} progress={progress} onHeight={setHeaderHeight} /> : <DetailHeader {...headerProps} onHeight={setHeaderHeight} />;

  return (
    <ScreenScroll header={header} top={headerHeight} onScroll={onScroll} healthspan={ground === "healthspan"} onRefresh={onRefresh}>
      <View className="w-full px-4 pt-2" accessibilityState={{ busy: !!loading }}>
        {loading && <Text accessibilityLiveRegion="polite" className="absolute h-px w-px opacity-0">{title.trim() ? `Loading ${title}…` : "Loading…"}</Text>}
        {dateSwitcher && !inHeader && (
          <View className="mb-6 items-center">
            <DateSwitcher {...dateSwitcher} placement="header" />
          </View>
        )}
        <View className="gap-8">
          {(hero || side) && (
            <View className="gap-6">
              {hero && (
                <View
                  ref={heroBox}
                  // The collapse point: the hero's bottom edge reaching the header's. Measured at rest, then fixed.
                  onLayout={() =>
                    compact &&
                    heroBox.current?.measureInWindow((_x, y, _w, h) => {
                      threshold.value = Math.max(0, y + h + scrollY.value - (insets.top + HEADER_ROW));
                    })
                  }
                  className="items-center"
                >
                  {hero}
                </View>
              )}
              {side && (
                <View className="min-w-0">
                  {notch && summary && <Notch />}
                  {side}
                </View>
              )}
            </View>
          )}
          {(summary || !hero) && insight}
          {primary}
          {secondary && secondary.length > 0 && <View className="gap-3">{Children.toArray(secondary)}</View>}
          {footer}
        </View>
      </View>
    </ScreenScroll>
  );
}

/** The small square above a summary card, pointing at the hero (the web's rotated notch). */
function Notch() {
  return <View accessibilityElementsHidden className="absolute -top-2 left-1/2 -ml-2 size-4 rotate-45 rounded-tl-[3px] bg-card" />;
}
