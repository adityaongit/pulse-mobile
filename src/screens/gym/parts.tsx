// The gym screens' shared pieces: a template card, a history row, a menu item and the small formatting the log needs.
// Pulse's own tokens and type, in Strong's layout: one wide column of templates, a list of sessions under it.
import { useEffect, useState, type ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { ChevronRight, Clock, MoreHorizontal, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/config";
import { Pencil, Play, Trash2 } from "lucide-react-native";
import { Card, CARD_CLASS, useCardStyle } from "@/ui/Card";
import { MenuPanel, useMenu } from "@/ui/Menu";
import { cn } from "@/ui/cn";
import { Icon } from "@/ui/Icon";
import { Button } from "@/ui/Button";
import { Gradient } from "@/ui/Gradient";
import { usePanelStyle } from "@/ui/Panel";
import { useTheme } from "@/ui/theme";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { haptic } from "@/ui/haptics";
import { ago, DAY, formatDay } from "@/lib/format";
import type { RoutineCard, SessionCard } from "@/queries/gym";
import { SwipeActions } from "./SwipeActions";

/** "0:06", "12:40", "1:02:03": the workout timer. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** "48 min", "1 h 12", or "<1 min" for a workout that ended inside the first minute. */
export function lengthText(seconds: number): string {
  if (seconds > 0 && seconds < 60) return "<1 min";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")}`;
}

/** A weight of kilograms in the unit it was entered in, with that unit's word: "12,450 kg" or "27,447 lb". */
export function volumeText(kg: number, unit: "kg" | "lb" = "kg"): string {
  const value = unit === "lb" ? kg / 0.45359237 : kg;
  return `${Math.round(value).toLocaleString()} ${unit}`;
}

/** The footer: "4 days ago" for the last month, then the date, with the year once it is not this one ("16 Nov 2025"). */
export function whenText(ts: number | null, now: number): string {
  if (!ts) return "";
  const days = (now - ts) / 86_400;
  if (days < 30) return ago(ts * 1000, now * 1000);
  const day = new Date(ts * 1000).toISOString().slice(0, 10);
  const thisYear = new Date(now * 1000).getUTCFullYear() === Number(day.slice(0, 4));
  return formatDay(day, thisYear ? DAY.monthDay : DAY.full);
}

/** A live "now" for the timers, ticking once a second while `active`. It reads the clock again the moment it becomes
 *  active, so a timer that was hidden under another page does not show its last value for a second. */
export function useNow(active = true): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** A row in a dropdown: an icon, a label, and the destructive tone. */
export function MenuItem({ icon, label, onPress, danger }: { icon: LucideIcon; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Press activeBg="bg-fill-hover" accessibilityRole="button" onPress={onPress} className="h-11 flex-row items-center gap-3 rounded-xl px-3">
      <Icon icon={icon} size={18} tone={danger ? "recovery-red-text" : "foreground-secondary"} />
      <Text className={cn("text-[15px] font-medium", danger && "text-recovery-red-text")}>{label}</Text>
    </Press>
  );
}

/** A small label over a value, the "Last 7 days" tiles. */
export function StatTile({ label, value, aside }: { label: string; value: string; aside?: string }) {
  return (
    <View className="min-w-0 flex-1 gap-1 rounded-xl bg-secondary px-3 py-2.5">
      <Text className="text-[11px] font-semibold uppercase leading-4 tracking-[0.1em] text-muted-foreground">{label}</Text>
      <Text className="font-numeric text-[17px] font-semibold leading-6">{value}</Text>
      {!!aside && <Text className="text-[12px] leading-4 text-muted-foreground">{aside}</Text>}
    </View>
  );
}

/** A template in the grid: its name, what it holds ("5 × Lat Pulldown (Cable), 5 × …") and when it was last done. */
export function TemplateCard({ card, next, onStart, onEdit, onDelete, onReorder }: { card: RoutineCard; next?: boolean; onStart: () => void; onEdit: () => void; onDelete: () => void; onReorder: () => void }) {
  const { t } = useTranslation("gym");
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const cardStyle = useCardStyle();
  const { ref: menuRef, anchor, open: openMenu, close: closeMenu } = useMenu();
  const summary = (() => {
    // Built at item granularity: the clamp then cuts between exercises, not through "5 × Standing Calf Raise (Machine)".
    const items = card.items.map((i) => (i.sets > 0 ? `${i.sets} × ${i.exercise.name}` : i.exercise.name));
    const shown: string[] = [];
    let length = 0;
    for (const item of items) {
      if (shown.length && length + item.length > 96) return `${shown.join(", ")} …`;
      shown.push(item);
      length += item.length + 2;
    }
    return shown.join(", ");
  })();
  return (
    <>
      <SwipeActions
        left={[{ label: t("home.startTemplate"), icon: Play, tone: "accent", onPress: onStart }]}
        right={[
          { label: t("routine.edit"), icon: Pencil, onPress: onEdit },
          { label: t("routine.delete"), icon: Trash2, tone: "danger", onPress: onDelete },
        ]}
      >
        <Press
          activeScale={0.97}
          accessibilityRole="button"
          accessibilityLabel={card.routine.name}
          accessibilityHint={t("routine.reorder")}
          onPress={onStart}
          onLongPress={() => {
            haptic.select();
            onReorder();
          }}
          delayLongPress={350}
          className={cn(CARD_CLASS, "w-full p-4", next && "border border-strain/40")}
          style={cardStyle}
        >
          <View className="gap-2">
            {next && <Text className="-mb-1.5 text-[11px] font-bold uppercase leading-4 tracking-[0.1em] text-strain-text">{t("card.upNext")}</Text>}
            <View className="flex-row items-start justify-between gap-2">
              <Text className="shrink text-[17px] font-semibold leading-[22px]" numberOfLines={1}>
                {card.routine.name}
              </Text>
              <View ref={menuRef} collapsable={false}>
                <Press accessibilityRole="button" accessibilityLabel={t("menu.template")} hitSlop={12} onPress={openMenu} className="-my-1 size-8 items-center justify-center">
                  <Icon icon={MoreHorizontal} size={18} tone="muted-foreground" />
                </Press>
              </View>
            </View>
            <Text className="text-[13px] leading-[18px] text-foreground-secondary" numberOfLines={3}>
              {summary}
            </Text>
          </View>
          <View className="mt-2 flex-row items-center justify-between gap-2">
            <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
              <Icon icon={Clock} size={12} tone="muted-foreground" />
              <Text className="text-[12px] leading-4 text-muted-foreground">{whenText(card.lastTs, now) || t("home.neverDone")}</Text>
            </View>
            <View className={cn("size-9 items-center justify-center rounded-full", next ? "bg-foreground" : "border border-border bg-secondary")}>
              <Icon icon={Play} size={16} tone={next ? "background" : "strain-text"} />
            </View>
          </View>
        </Press>
      </SwipeActions>
      <MenuPanel anchor={anchor} onClose={closeMenu} align="end">
        <MenuItem icon={Play} label={t("home.startTemplate")} onPress={() => (closeMenu(), onStart())} />
        <MenuItem icon={Pencil} label={t("routine.edit")} onPress={() => (closeMenu(), onEdit())} />
        <MenuItem icon={Trash2} label={t("routine.delete")} danger onPress={() => (closeMenu(), onDelete())} />
      </MenuPanel>
    </>
  );
}

/** One finished session in the history: name, date, what it trained, and its numbers. */
export function SessionRow({ card, onPress }: { card: SessionCard; onPress: () => void }) {
  const { t } = useTranslation("gym");
  const seconds = card.endTs ? card.endTs - card.startTs : 0;
  const meta = [t("session.setsCount", { count: card.setCount }), volumeText(card.volumeKg, card.unit), ...(seconds > 0 ? [lengthText(seconds)] : [])].join(" · ");
  return (
    <Press activeBg="bg-fill-hover" accessibilityRole="button" onPress={onPress} className="flex-row items-center gap-3 rounded-xl py-3">
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-baseline gap-2">
          <Text className="shrink text-[15px] font-semibold leading-5" numberOfLines={1}>
            {card.name}
          </Text>
          <Text className="shrink-0 text-[12px] leading-4 text-muted-foreground">{formatDay(card.day, DAY.monthDay)}</Text>
        </View>
        <Text className="text-[13px] leading-[18px] text-foreground-secondary" numberOfLines={1}>
          {card.exercises.join(", ") || t("session.empty")}
        </Text>
        <Text className="font-numeric text-[12px] leading-4 text-muted-foreground">{meta}</Text>
      </View>
      <Icon icon={ChevronRight} size={16} tone="muted-foreground" />
    </Press>
  );
}

/** A titled block on a gym page. The header row is the kit's section rhythm (12 px under it, 36 px tall). */
export function Block({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <View className={cn("gap-3", className)}>
      {!!(title || action) && (
        <View className="min-h-9 flex-row items-center justify-between gap-3">
          {!!title && (
            <Text accessibilityRole="header" className="shrink text-[22px] font-semibold leading-7 tracking-[-0.01em]">
              {title}
            </Text>
          )}
          {!!action && <View className="shrink-0">{action}</View>}
        </View>
      )}
      {children}
    </View>
  );
}

/**
 * A section header's action, the same recipe as the kit's `ActionLink` (12 px bold caps, 0.1 em tracking, a 14 px
 * chevron, a 44 px touch target) with a glyph of its own when it creates something. Written here rather than reusing
 * `ActionLink` because that one takes an href and these are handlers.
 */
export function HeaderAction({ icon, label, onPress }: { icon?: LucideIcon; label: string; onPress: () => void }) {
  return (
    <Press activeOpacity={0.7} accessibilityRole="button" onPress={onPress} hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }} className="flex-row items-center gap-0.5">
      {icon ? <Icon icon={icon} size={14} tone="foreground-secondary" strokeWidth={2} /> : null}
      <Text className="text-xs font-bold uppercase leading-4 tracking-[0.1em] text-foreground-secondary">{label}</Text>
      {icon ? null : <Icon icon={ChevronRight} size={14} tone="foreground-secondary" strokeWidth={2} />}
    </Press>
  );
}

/** A card that is one link, with a chevron: the gym's own rows in More and on Home. */
export function LinkRow({ icon, label, aside, onPress }: { icon: LucideIcon; label: string; aside?: string; onPress: () => void }) {
  return (
    <Press activeBg="bg-fill-hover" accessibilityRole="link" onPress={onPress} className="h-12 flex-row items-center gap-3 rounded-xl px-1">
      <Icon icon={icon} size={18} tone="foreground-secondary" />
      <Text className="min-w-0 flex-1 text-[15px] font-medium">{label}</Text>
      {!!aside && <Text className="text-[13px] text-muted-foreground">{aside}</Text>}
      <Icon icon={ChevronRight} size={16} tone="muted-foreground" />
    </Press>
  );
}

/** The empty state the gym pages share. */
export function GymEmpty({ icon, title, body, children }: { icon: LucideIcon; title: string; body: string; children?: ReactNode }) {
  return (
    <Card className="items-center gap-2 px-4 py-8">
      <Icon icon={icon} size={24} tone="muted-foreground" />
      <Text className="text-center text-[16px] font-semibold">{title}</Text>
      <Text className="max-w-72 text-center text-[14px] leading-[21px] text-foreground-secondary">{body}</Text>
      {children}
    </Card>
  );
}

/** A centred confirmation, as the journal's dismiss dialog: a modal so the back gesture keeps the screen behind it. */
export function ConfirmDialog({ open, title, body, extra, confirm, onCancel, onConfirm }: { open: boolean; title: string; body?: string; extra?: ReactNode; confirm: string; onCancel: () => void; onConfirm: () => void }) {
  const { c } = useTheme();
  const panel = usePanelStyle({ ring: "border" });
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent navigationBarTranslucent>
      <Pressable accessibilityLabel={title} onPress={onCancel} className="flex-1 items-center justify-center bg-dim-strong px-4">
        <Pressable accessible={false} onPress={() => {}} className="w-full max-w-[384px] gap-5 overflow-hidden rounded-3xl p-6" style={panel}>
          <Gradient from={c["popover-top"]} to={c.popover} angle="y" />
          <View className="gap-2">
            <Text accessibilityRole="header" className="text-[17px] font-semibold leading-6">
              {title}
            </Text>
            {!!body && <Text className="text-[14px] leading-[21px] text-foreground-secondary">{body}</Text>}
            {extra}
          </View>
          <View className="gap-2">
            <Button onPress={onConfirm} haptic>
              {confirm}
            </Button>
            <Button variant="outline" onPress={onCancel}>
              {i18n.t("common:actions.cancel")}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** A line through a series, the last point marked: an exercise's 1RM curve, the weight's. Skia is heavier than a line. */
export function MiniLine({ values, height = 132, color }: { values: number[]; height?: number; color?: string }) {
  const { c } = useTheme();
  const [width, setWidth] = useState(0);
  const pad = 12;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / Math.max(1, values.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const stroke = color ?? c.strain;
  return (
    <View className="w-full" style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Svg width={width} height={height}>
          <Line x1={pad} y1={y(max)} x2={width - pad} y2={y(max)} stroke={c.border} strokeWidth={1} strokeDasharray="3 4" />
          <Line x1={pad} y1={y(min)} x2={width - pad} y2={y(min)} stroke={c.border} strokeWidth={1} strokeDasharray="3 4" />
          <Path d={d} stroke={stroke} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          <Circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={4} fill={stroke} />
        </Svg>
      )}
    </View>
  );
}
