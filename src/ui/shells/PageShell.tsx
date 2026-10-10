import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";
import { View } from "react-native";
import { Text } from "../Text";
import type { DateSwitcherProps } from "./DateSwitcher";
import { HomeHeader, type HeaderRings } from "./HomeHeader";
import { HEADER_ROW, TitleHeader, useHeaderHeight } from "./Header";
import { ScreenScroll, type ScreenScrollProps, useCollapse } from "./ScreenScroll";

const SentinelContext = createContext<((node: View) => void) | null>(null);

/**
 * Marks the end of Home's collapse distance (the web's HEADER_SENTINEL): put it right after the dials row, inside `slots.top`,
 * with `-mt-3` if the column has a 12 px gap, so it sits at the dials' bottom edge. Past it the dials are under the header and
 * the header's ring row takes over. A zero-height marker, not a wrapper: the note under the dials is not part of the distance.
 */
export function HeaderSentinel({ className }: { className?: string }) {
  const mark = useContext(SentinelContext);
  const node = useRef<View>(null);
  return <View ref={node} collapsable={false} accessibilityElementsHidden className={className ?? "h-0"} onLayout={() => node.current && mark?.(node.current)} />;
}

/** Home: `top` (the dials) then `main` (My Day), `aside` (My Dashboard) and `bottom`, in phone reading order (web: laptop columns, D-L4). */
export type HomeSlots = { top: ReactNode; main: ReactNode; aside: ReactNode; bottom?: ReactNode };

export type PageShellProps = {
  /** The page's title, shown centred in the header (Home's is only spoken). */
  title: string;
  /** Under the title (Journal). Home's header always carries the date pill. */
  dateSwitcher?: DateSwitcherProps;
  /** Right-aligned on the first row of content (never in the header). */
  actions?: ReactNode;
  layout?: "stack" | "home" | "grid-2";
  /** For `layout="home"`. */
  slots?: HomeSlots;
  /** For `layout="home"`: the day's scores for the collapsing header's ring row (spec §4.3). */
  rings?: HeaderRings;
  /** Right slot of the header (sync status; the sync stream provides it). */
  headerRight?: ReactNode;
  /** Pull to refresh (see ScreenScroll): wire it to "sync now". */
  onRefresh?: ScreenScrollProps["onRefresh"];
  /** A route's loading state: says "Loading…" to screen readers while skeletons show. */
  loading?: boolean;
  children?: ReactNode;
};

/** Tab roots: Home, Health, Journal, More (spec §4.5). */
export function PageShell({ title, dateSwitcher, actions, layout = "stack", slots, rings, headerRight, loading, onRefresh, children }: PageShellProps) {
  const { scrollY, threshold, onScroll, progress } = useCollapse();
  const home = layout === "home";
  const top = useHeaderHeight(HEADER_ROW + (dateSwitcher && !home ? 40 : 0));
  const base = useHeaderHeight(HEADER_ROW);
  const mark = useCallback(
    (node: View) =>
      node.measureInWindow((_x, y) => {
        threshold.value = Math.max(0, y + scrollY.value - base);
      }),
    [threshold, scrollY, base],
  );

  const header = home ? <HomeHeader rings={rings} progress={progress} right={headerRight} /> : <TitleHeader title={title} dateSwitcher={dateSwitcher} right={headerRight} />;
  return (
    <ScreenScroll header={header} top={top} onScroll={onScroll} onRefresh={onRefresh}>
      <View className="w-full px-4 pt-2" accessibilityState={{ busy: !!loading }}>
        {loading && <Text accessibilityLiveRegion="polite" className="absolute h-px w-px opacity-0">{title.trim() ? `Loading ${title}…` : "Loading…"}</Text>}
        {actions && <View className="mb-4 flex-row justify-end gap-2">{actions}</View>}
        {home && slots ? (
          <View className="gap-8">
            <SentinelContext.Provider value={mark}>
              <View>{slots.top}</View>
            </SentinelContext.Provider>
            <View className="min-w-0">{slots.main}</View>
            <View className="min-w-0">{slots.aside}</View>
            {slots.bottom && <View className="min-w-0">{slots.bottom}</View>}
          </View>
        ) : (
          <View className={layout === "grid-2" ? "gap-3" : "gap-8"}>{children}</View>
        )}
      </View>
    </ScreenScroll>
  );
}
