// Coach `/coach` (spec §7.21), ported from pulse src/app/(app)/coach/page.tsx via halo: consent, then a provider and
// key (BYOK), then the chat. `?c=` opens a saved chat, `?q=` fills the composer without sending, `?brief=1` asks for
// today's brief at once, `?send=1` asks `?q=` at once, `?n=` starts a fresh chat.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { generateId, type UIMessage } from "ai";
import { History, Settings2, SquarePen } from "lucide-react-native";
import { CHAT_ID } from "@/coach/chats";
import { providerLabel } from "@/coach/providers";
import { useChatCount, useCoachSetup } from "@/coach/session";
import { loadChat } from "@/coach/storage";
import { coachSuggestions } from "@/coach/suggestions";
import { workoutChatSeed } from "@/coach/workoutChat";
import { todayOf } from "@/queries/common";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { push } from "@/ui/navigate";
import { Skeleton } from "@/ui/Skeleton";
import { DetailHeader } from "@/ui/shells/DetailHeader";
import { DetailShell } from "@/ui/shells/DetailShell";
import { useScreen } from "../useScreen";
import { Coach } from "./Coach";
import { ConnectProvider, Consent } from "./CoachSetup";

const param = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

function ChatSkeleton() {
  return (
    <View className="gap-3 px-4 pt-4">
      <Skeleton className="h-16 w-4/5 rounded-[20px]" />
      <Skeleton className="h-11 w-3/5 self-end rounded-[20px]" />
      <Skeleton className="h-24 w-full rounded-[20px]" />
    </View>
  );
}

/** The header's right side: Chats (with the count), New chat once a chat is open, and Coach settings. */
function BarActions({ chatCount, chatOpen, onNew }: { chatCount: number; chatOpen: boolean; onNew: () => void }) {
  const { t } = useTranslation("coach");
  return (
    <View className="flex-row items-center">
      <Button variant="ghost" size="icon-touch" haptic={false} onPress={() => push("/coach/chats")} accessibilityLabel={chatCount ? t("bar.chatsCount", { count: chatCount }) : t("bar.chats")}>
        <Icon icon={History} size={20} />
      </Button>
      {chatOpen && (
        <Button variant="ghost" size="icon-touch" onPress={onNew} accessibilityLabel={t("bar.newChat")}>
          <Icon icon={SquarePen} size={20} />
        </Button>
      )}
      <Button variant="ghost" size="icon-touch" haptic={false} onPress={() => push("/coach/settings")} accessibilityLabel={t("settingsTitle")}>
        <Icon icon={Settings2} size={20} />
      </Button>
    </View>
  );
}

export function CoachScreen() {
  const { t } = useTranslation("coach");
  const setup = useCoachSetup();
  const chatCount = useChatCount();
  const params = useLocalSearchParams<{ c?: string; q?: string; brief?: string; send?: string; n?: string; workout?: string; preview?: string }>();
  const c = param(params.c) && CHAT_ID.test(param(params.c)!) ? param(params.c)! : null;
  const brief = param(params.brief) === "1";
  const sendNow = param(params.send) === "1";
  const n = param(params.n);
  const fresh = useMemo(() => generateId(), [n]); // eslint-disable-line react-hooks/exhaustive-deps
  const workoutId = param(params.workout);
  const preview = param(params.preview)?.slice(0, 2000);
  const question = (param(params.q) ?? "").slice(0, 500);
  const seed = useMemo(() => workoutChatSeed(workoutId, question, preview), [workoutId, question, preview]);
  const { data } = useScreen(async (ctx) => ({ suggestions: await coachSuggestions(ctx), today: todayOf(ctx) }), ["coach"]);
  const [headerH, setHeaderH] = useState(0);
  // The chat on screen. No `?c=`: a fresh one (a new one per `?n=`). `?c=` naming the chat on screen keeps it running
  // (a new chat records its id after its first answer); naming another loads it from the Store first.
  const [shown, setShown] = useState<{ id: string; messages: UIMessage[] } | undefined>(c ? undefined : { id: fresh, messages: seed });
  if (!c && shown?.id !== fresh) setShown({ id: fresh, messages: seed });
  const loading = !!c && shown?.id !== c;
  useEffect(() => {
    if (!loading || !c) return;
    let live = true;
    loadChat(c).then(
      (messages) => live && setShown({ id: c, messages: messages ?? [] }),
      () => live && setShown({ id: c, messages: [] }),
    );
    return () => {
      live = false;
    };
  }, [loading, c]);
  const chat = loading ? undefined : shown;

  if (setup === undefined) return <DetailShell title={t("title")} loading primary={<ChatSkeleton />} />;
  if (!setup.consent || !setup.provider) return <DetailShell title={t("title")} primary={!setup.consent ? <Consent /> : <ConnectProvider current={setup} />} />;

  const newChat = () => router.setParams({ c: undefined, q: undefined, brief: undefined, send: undefined, workout: undefined, preview: undefined, n: generateId() });
  return (
    <View className="flex-1 bg-background">
      <DetailHeader title={t("title")} action={<BarActions chatCount={chatCount ?? 0} chatOpen={!!c} onNew={newChat} />} onHeight={setHeaderH} />
      <View className="flex-1" style={{ paddingTop: headerH }}>
        {chat && data ? (
          <Coach
            key={chat.id}
            id={chat.id}
            initial={chat.messages}
            prefill={brief && !c ? t("suggestions.brief") : !c && seed.length ? t("workout.expand") : question}
            auto={(brief || sendNow) && !c}
            workoutId={workoutId}
            providerLabel={providerLabel(setup.provider)}
            suggestions={data.suggestions}
            today={data.today}
            onSaved={(id) => router.setParams({ c: id, q: undefined, brief: undefined, send: undefined, workout: undefined, preview: undefined })}
          />
        ) : (
          <ChatSkeleton />
        )}
      </View>
    </View>
  );
}
