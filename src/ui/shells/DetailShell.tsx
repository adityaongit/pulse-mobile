import { i18n } from "@/i18n/config";
import { Children, cloneElement, isValidElement, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { useIsFocused } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";
import { DURATION } from "../motion";
import { Card } from "../Card";
import { Skeleton, SkeletonText } from "../Skeleton";
import { Text } from "../Text";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { InfoContent } from "./InfoButton";
import { CollapsingHeader, type HeaderStats } from "./CollapsingHeader";
import type { DateSwitcherProps } from "./DateSwitcher";
import { DateSwitcher } from "./DateSwitcher";
import { DetailHeader, type DetailHeaderProps } from "./DetailHeader";
import { HEADER_ROW } from "./Header";
import { ScreenScroll, type ScreenScrollProps, useCollapse } from "./ScreenScroll";
import { SectionShell, type SectionShellProps } from "./SectionShell";
import { useShellSync } from "./ShellStatus";
import { useBodyShown, useScreenReady } from "./useScreenReady";

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
  /** See ScreenScroll: false when the screen floats its own action at the foot. */
  floatingAction?: boolean;
  /** What shows below the fold while a cold push slides in: the screen's own skeleton of its first sections (the same
   *  one its loading state draws). Without it, a skeleton per section in that section's chrome. */
  bodySkeleton?: ReactNode;
  /** A route's loading state: says "Loading…" to screen readers while skeletons show. */
  loading?: boolean;
};

export function DetailShell({ title, subtitle, info, backHref, dateSwitcher, dismiss, align, titleIcon, action, ground, hero, stats, collapse, summary, notch, insight, primary, secondary, footer, bodySkeleton, loading, onRefresh, floatingAction }: DetailShellProps) {
  const insets = useSafeAreaInsets();
  const side = summary ?? (hero ? insight : null);
  const inHeader = dateSwitcher?.placement === "header";
  const headerProps = { title, subtitle, info, backHref, dismiss, align, titleIcon, action, dateTitle: inHeader ? dateSwitcher : undefined };
  const [headerHeight, setHeaderHeight] = useState(insets.top + HEADER_ROW);
  const { scrollY, threshold, onScroll, progress } = useCollapse();
  const heroBox = useRef<View>(null);
  // The compact hero, drawn in the header's second row.
  const compact = collapse && isValidElement<{ compact?: boolean }>(hero) ? cloneElement(hero, { compact: true }) : null;
  // The whole page renders at once when the screen is preloaded (Home preloads its dials' screens) or already settled.
  // A cold push renders the top first, because the native slide starts only after that render: the page below the fold
  // holds skeletons of its sections during the slide and fades in when the slide ends. Once rendered it stays.
  const ready = useScreenReady();
  const focused = useIsFocused();
  const [below, setBelow] = useState(ready || !focused);
  const [fade] = useState(!below);
  if ((ready || !focused) && !below) setBelow(true);
  const body = useBodyShown();
  const shellSync = useShellSync();
  const header = compact ? <CollapsingHeader {...headerProps} compact={compact} stats={stats} progress={progress} onHeight={setHeaderHeight} /> : <DetailHeader {...headerProps} onHeight={setHeaderHeight} />;

  return (
    <ScreenScroll header={header} top={headerHeight} onScroll={onScroll} healthspan={ground === "healthspan"} floatingAction={floatingAction} onRefresh={onRefresh ?? shellSync?.syncNow}>
      {body && <View removeClippedSubviews className="w-full px-4 pt-2" accessibilityState={{ busy: !!loading }}>
        {loading && <Text accessibilityLiveRegion="polite" className="absolute h-px w-px opacity-0">{title.trim() ? i18n.t("ui:loadingTitle", { title }) : i18n.t("common:loading")}</Text>}
        {dateSwitcher && !inHeader && (
          <View className="mb-6 items-center">
            <DateSwitcher {...dateSwitcher} placement="header" />
          </View>
        )}
        <View removeClippedSubviews className="gap-8">
          {!!(hero || side) && (
            <View className="gap-6">
              {!!hero && (
                <View
                  ref={heroBox}
                  // The collapse point: the hero's bottom edge reaching the header's. Measured at rest, then fixed.
                  onLayout={() =>
                    compact &&
                    heroBox.current?.measure((_x, _y, _w, h, _pageX, y) => {
                      threshold.value = Math.max(0, y + h + scrollY.value - headerHeight);
                    })
                  }
                  className="items-center"
                >
                  {hero}
                </View>
              )}
              {!!side && (
                <View className="min-w-0">
                  {notch && !!summary && <Notch />}
                  {side}
                </View>
              )}
            </View>
          )}
          {!!(summary || !hero) && insight}
          {below ? (
            <Animated.View removeClippedSubviews entering={fade ? FadeIn.duration(DURATION.base) : undefined} className="gap-8">
              {primary}
              {secondary && secondary.length > 0 && <View removeClippedSubviews className="gap-3">{Children.toArray(secondary)}</View>}
              {footer}
            </Animated.View>
          ) : (
            (primary || secondary?.length || footer) && (bodySkeleton ?? <BodySkeleton sections={[primary, ...(secondary ?? [])]} />)
          )}
        </View>
      </View>}
    </ScreenScroll>
  );
}

/** The small square above a summary card, pointing at the hero (the web's rotated notch). */
function Notch() {
  return <View accessibilityElementsHidden className="absolute -top-2 left-1/2 -ml-2 size-4 rotate-45 rounded-tl-[3px] bg-card" />;
}


/**
 * The page below the fold while it waits for the slide to end: one skeleton per section, each in the section's own
 * chrome (a SectionShell with its real title), so the page's shape shows instead of one empty box. The first three are
 * enough to fill the screen.
 */
function BodySkeleton({ sections }: { sections: ReactNode[] }) {
  return (
    <View className="gap-3">
      {Children.toArray(sections)
        .slice(0, 3)
        .map((s, i) => {
          const p = isValidElement<Partial<SectionShellProps>>(s) ? s.props : {};
          const body = (
            <View className="gap-3">
              <Skeleton className="h-28 rounded-lg bg-skeleton" />
              <SkeletonText className="w-3/4" />
            </View>
          );
          return p.title ? (
            <SectionShell key={i} variant={p.variant ?? "card"} title={p.title} info={false}>
              {body}
            </SectionShell>
          ) : (
            <Card key={i} className="gap-3 p-4">
              <SkeletonText className="w-28" />
              {body}
            </Card>
          );
        })}
    </View>
  );
}
