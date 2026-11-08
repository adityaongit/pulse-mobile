import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, ScrollView, Share, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useChat } from "@ai-sdk/react";
import type { CoachActivity } from "@/coach/activity";
import type { UIMessage } from "ai";
import { Activity, ArrowUp, ChevronRight, Dumbbell, Moon, NotebookPen, RefreshCw, RotateCcw, Share2, Square, type LucideIcon } from "lucide-react-native";
import type { CoachSuggestion as CoreSuggestion } from "@/core/algorithms/coachSuggestions";
import { plainText } from "@/coach/chats";
import { i18n } from "@/i18n/config";
import { deviceTransport } from "@/coach/session";
import { Mark } from "@/ui/brand";
import { cn } from "@/ui/cn";
import { Gradient } from "@/ui/Gradient";
import { Icon } from "@/ui/Icon";
import { useKeyboardInset } from "@/ui/keyboard";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/theme";
import { Evidence } from "./Evidence";
import { Prose } from "./Prose";
import { push } from "@/ui/navigate";

type Part = UIMessage["parts"][number];

type CoachSuggestion = { key: CoreSuggestion["key"]; text: string };
const SUGGESTION_ICONS: Record<CoachSuggestion["key"], LucideIcon> = { brief: Activity, recovery: Activity, training: Dumbbell, hrv: Activity, sleep: Moon, strain: Dumbbell, sync: RefreshCw };

/** The tools with a progress line (`coach:running.<tool>`); any other tool reads the default. */
const RUNNING = ["get_day", "get_sleep", "get_activity", "get_trend", "get_activities", "get_journal_impacts", "get_health", "get_report", "get_profile"];

const PROBLEMS = ["limit", "key", "profile", "provider", "network"] as const;
/** The composer's least gap to the screen's bottom edge, and its gap above the keyboard. */
const COMPOSER_GAP = 12;

/** The sentence for a CoachProblem code (see transport.ts); anything else reads the default. */
const errorText = (e: Error) => {
  const code = PROBLEMS.find((p) => p === e.message.trim());
  return code ? i18n.t(`coach:errors.${code}`) : i18n.t("coach:errors.default");
};

export function CoachMark({ size }: { size: number }) {
  const { c } = useTheme();
  return (
    <View accessibilityElementsHidden className="overflow-hidden rounded-full p-px" style={{ width: size, height: size }}>
      <Gradient from={c["insight-from"]} to={c["insight-to"]} angle="xy" />
      <View className="flex-1 items-center justify-center rounded-full bg-background">
        <Mark size={Math.round(size * 0.42)} />
      </View>
    </View>
  );
}

/** A caption with a coach-blue dot: tool progress, "Thinking…", a tool that failed. */
function Caption({ live, children }: { live?: boolean; children: string }) {
  return (
    <View className="min-h-6 flex-row items-center gap-2" accessibilityLiveRegion={live ? "polite" : "none"}>
      <View className={cn("size-1.5 rounded-full bg-coach", live && "animate-pulse")} />
      <Text className="text-[13px] leading-[18px] text-muted-foreground">{children}</Text>
    </View>
  );
}

function PartView({ part }: { part: Part }) {
  const { t } = useTranslation("coach");
  if (part.type === "text") return part.text.trim() ? <Prose text={part.text} /> : null;
  if (!part.type.startsWith("tool-")) return null;
  const name = part.type.slice(5);
  const tool = part as Part & { state: string; output?: unknown };
  if (tool.state === "output-error") return <Caption>{t("chat.toolFailed")}</Caption>;
  if (tool.state !== "output-available") return <Caption live>{RUNNING.includes(name) ? i18n.t(`coach:running.${name}` as "coach:running.get_day") : t("running.default")}</Caption>;
  return <Evidence name={name} output={tool.output} />;
}

function IconAction({ label, icon, onPress, disabled }: { label: string; icon: LucideIcon; onPress: () => void; disabled?: boolean }) {
  return (
    <Press accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} activeScale={0.96} className={cn("size-10 items-center justify-center rounded-xl opacity-65", disabled && "opacity-30")}>
      <Icon icon={icon} size={15} strokeWidth={1.75} tone="foreground-secondary" />
    </Press>
  );
}

function Pill({ label, onPress, disabled, primary, icon }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean; icon?: ReactNode }) {
  return (
    <Press accessibilityRole="button" onPress={onPress} disabled={disabled} className={cn("h-10 flex-row items-center gap-1.5 rounded-full px-4", primary ? "bg-primary" : "bg-secondary", disabled && "opacity-45")}>
      {icon}
      <Text className={cn("text-[13px] font-semibold", primary ? "text-primary-foreground" : "text-foreground")}>{label}</Text>
    </Press>
  );
}

function UserMessage({ m, busy, onEdit }: { m: UIMessage; busy: boolean; onEdit: (text: string) => void }) {
  const { t } = useTranslation("coach");
  const { c } = useTheme();
  const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null)
    return (
      <View className="ml-8 gap-2">
        <TextInput
          autoFocus
          multiline
          value={draft}
          onChangeText={setDraft}
          maxLength={2000}
          accessibilityLabel={t("chat.editLabel")}
          cursorColor={c.coach}
          className="max-h-60 min-h-11 rounded-2xl bg-secondary px-4 py-3 text-[15px] leading-6 text-foreground"
        />
        <View className="flex-row justify-end gap-2">
          <Pill label={t("actions.cancel", { ns: "common" })} onPress={() => setDraft(null)} />
          <Pill
            label={t("chat.saveAndSend")}
            primary
            disabled={busy || !draft.trim()}
            onPress={() => {
              const edited = draft.trim();
              setDraft(null);
              if (edited !== text.trim()) onEdit(edited);
            }}
          />
        </View>
      </View>
    );
  return (
    <View className="items-end pl-8">
      <Text selectable className="max-w-full rounded-2xl bg-secondary px-4 py-3 text-[15px] leading-6 text-foreground">
        {text}
      </Text>
      <Press accessibilityRole="button" accessibilityLabel={t("chat.editMessage")} disabled={busy} onPress={() => setDraft(text)} activeScale={0.96} className={cn("min-h-10 min-w-10 items-center justify-center px-2", busy && "opacity-30")}>
        <Text className="text-xs leading-4 text-muted-foreground">{t("chat.editMessage")}</Text>
      </Press>
    </View>
  );
}

function AssistantMessage({ m, done, onRegenerate }: { m: UIMessage; done: boolean; onRegenerate?: () => void }) {
  const { t } = useTranslation("coach");
  const text = plainText(m);
  return (
    <View className="min-w-0 gap-3">
      {m.parts.map((p, i) => (
        <PartView key={i} part={p} />
      ))}
      {done && (!!text || onRegenerate) && (
        <View className="flex-row gap-1">
          {!!text && <IconAction label={t("chat.shareAnswer")} icon={Share2} onPress={() => void Share.share({ message: text }).catch(() => {})} />}
          {onRegenerate && <IconAction label={t("chat.regenerate")} icon={RotateCcw} onPress={onRegenerate} />}
        </View>
      )}
    </View>
  );
}

function Empty({ providerLabel, suggestions, today, onAsk }: { providerLabel: string; suggestions: CoachSuggestion[]; today: string; onAsk: (text: string) => void }) {
  const { t } = useTranslation("coach");
  return (
    <View className="flex-1 items-center justify-center py-8">
      <CoachMark size={48} />
      <Text accessibilityRole="header" className="mt-5 text-center text-[22px] font-bold leading-7">
        {t("chat.emptyTitle")}
      </Text>
      <Text className="mt-2 max-w-[360px] text-center text-[15px] leading-[22px] text-foreground-secondary">
        {t("chat.emptyBody", { provider: providerLabel })}
      </Text>
      <View className="mt-8 w-full gap-2">
        {suggestions.map((s) => (
          <Press key={s.key} accessibilityRole="button" onPress={() => onAsk(s.text)} className="min-h-14 flex-row items-center gap-3 rounded-2xl border border-border px-4 py-3">
            <Icon icon={SUGGESTION_ICONS[s.key]} size={20} tone="coach-text" />
            <Text className="flex-1 text-[15px] leading-5 text-foreground">{s.text}</Text>
            <Icon icon={ChevronRight} size={16} tone="muted-foreground" />
          </Press>
        ))}
      </View>
      <Press accessibilityRole="button" onPress={() => push(`/checkin?d=${today}`)} className="mt-3 h-10 flex-row items-center gap-2 rounded-full px-4">
        <Icon icon={NotebookPen} size={16} tone="foreground-secondary" />
        <Text className="text-[14px] font-medium text-foreground-secondary">{t("chat.checkIn")}</Text>
      </Press>
    </View>
  );
}

export type CoachProps = {
  id: string;
  initial: UIMessage[];
  /** Fills the composer without sending (`?q=`). */
  prefill: string;
  /** Sends `prefill` at once (`?brief=1`, `?send=1`). */
  auto: boolean;
  activity?: CoachActivity;
  providerLabel: string;
  suggestions: CoachSuggestion[];
  today: string;
  /** After the first answer of a new chat: the screen records the chat's id (`/coach?c=`). */
  onSaved: (id: string) => void;
};

export function Coach({ id, initial, prefill, auto, activity, providerLabel, suggestions, today, onSaved }: CoachProps) {
  const { t } = useTranslation("coach");
  const { c } = useTheme();
  const bottom = Math.max(useSafeAreaInsets().bottom, COMPOSER_GAP);
  const { ref: keyboardRef, onLayout: measureKeyboard, inset: keyboardInset } = useKeyboardInset();
  const [input, setInput] = useState(prefill);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const [transport] = useState(deviceTransport);
  const { messages, sendMessage, regenerate, status, stop } = useChat({
    id,
    messages: initial,
    transport,
    throttle: 50,
    onError: (e) => setError(errorText(e)),
    onFinish: ({ message }) => {
      const words = plainText(message);
      if (words) AccessibilityInfo.announceForAccessibility(words);
      if (initial.length === 0 || activity) onSaved(id);
    },
  });
  const busy = status === "submitted" || status === "streaming";
  useEffect(() => {
    requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: true }));
  }, [messages.length, status]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setError(null);
    setInput("");
    void sendMessage({ text: t, ...(activity && { metadata: { activity } }) });
  };
  // An at-once question (`?brief=1`, `?send=1`) is asked once.
  const asked = useRef(false);
  useEffect(() => {
    if (!auto || asked.current) return;
    asked.current = true;
    send(prefill);
  });
  const again = (messageId?: string) => {
    if (busy) return;
    setError(null);
    void regenerate(messageId ? { messageId } : undefined);
  };
  const lastAnswer = messages.at(-1)?.role === "assistant" ? messages.at(-1)!.id : null;

  return (
    // The keyboard lifts the chat and the composer by however much of the screen it covers (src/ui/keyboard.ts).
    <View ref={keyboardRef} onLayout={measureKeyboard} style={{ flex: 1, paddingBottom: keyboardInset }}>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" className="flex-1" contentContainerClassName="grow px-4 pb-6 pt-2">
        {messages.length === 0 ? (
          <Empty providerLabel={providerLabel} suggestions={suggestions} today={today} onAsk={send} />
        ) : (
          <View accessibilityLabel={t("chat.chatLabel")} className="mt-2 gap-6">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <UserMessage key={m.id} m={m} busy={busy} onEdit={(text) => !busy && (setError(null), void sendMessage({ text, messageId: m.id, metadata: m.metadata }))} />
              ) : (
                <AssistantMessage key={m.id} m={m} done={!busy || i < messages.length - 1} onRegenerate={!busy && m.id === lastAnswer ? () => again(m.id) : undefined} />
              ),
            )}
            {status === "submitted" && (
              <Caption live>{t("chat.thinking")}</Caption>
            )}
          </View>
        )}
        {!!error && (
          <View accessibilityRole="alert" className="mt-6 flex-row items-center gap-3 rounded-xl border border-recovery-red/25 bg-recovery-red/12 py-2 pl-4 pr-2">
            <Text className="flex-1 py-1 text-[14px] leading-5 text-foreground">{error}</Text>
            <Pill label={t("chat.retry")} disabled={busy} onPress={() => again()} icon={<Icon icon={RotateCcw} size={16} />} />
          </View>
        )}
      </ScrollView>
      {/* The composer: a rounded field with Send (or Stop while answering), over the safe area. */}
      <View className="shrink-0 px-4 pt-2" style={{ paddingBottom: keyboardInset ? COMPOSER_GAP : bottom }}>
        <View className="flex-row items-end gap-1.5 rounded-[28px] border border-border bg-card p-1.5">
          <TextInput
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={2000}
            placeholder={t("chat.placeholder")}
            placeholderTextColor={c["muted-foreground"]}
            accessibilityLabel={t("chat.askLabel")}
            submitBehavior="submit"
            returnKeyType="send"
            onSubmitEditing={() => send(input)}
            cursorColor={c.coach}
            className="max-h-40 min-h-11 flex-1 py-2.5 pl-3.5 text-[16px] leading-6 text-foreground"
          />
          {busy ? (
            <Press accessibilityRole="button" accessibilityLabel={t("chat.stop")} onPress={() => void stop()} className="size-11 items-center justify-center rounded-full bg-secondary">
              <Icon icon={Square} size={14} />
            </Press>
          ) : (
            <Press accessibilityRole="button" accessibilityLabel={t("chat.send")} disabled={!input.trim()} onPress={() => send(input)} className={cn("size-11 items-center justify-center rounded-full bg-primary", !input.trim() && "opacity-40")}>
              <Icon icon={ArrowUp} size={20} tone="primary-foreground" strokeWidth={2.25} />
            </Press>
          )}
        </View>
      </View>
    </View>
  );
}
