// One score's explainer `/more/how-it-works/[score]` (U21), written from src/core and docs/algorithms. Ported from pulse
// (app)/more/how-it-works/[score]/page.tsx and loading.tsx (the copy is static, so there is nothing to load).
import { Pressable, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { cn } from "@/ui/cn";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { DetailShell } from "@/ui/shells/DetailShell";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { BODY, Divider } from "../settings/controls";
import { SCORE_DOCS, type HowSection } from "./howItWorksContent";

/** A detail this short sits beside its term ("HRV  55%"); a sentence goes under it. */
const SHORT = 24;

function Section({ s }: { s: HowSection }) {
  return (
    <SectionShell variant="card" title={s.title}>
      <View className="gap-3">
        {s.paragraphs?.map((p) => (
          <Text key={p} className={BODY}>
            {p}
          </Text>
        ))}
        {s.rows && (
          <View className={cn(s.paragraphs && "border-t border-border")}>
            {s.rows.map((r, i) => (
              <View key={r.term}>
                {i > 0 && <Divider />}
                <View className={cn("py-2.5", r.detail.length <= SHORT ? "flex-row items-baseline justify-between gap-3" : "gap-0.5")}>
                  <Text className="shrink text-[15px] font-semibold leading-[22px]">{r.term}</Text>
                  <Text className={cn("text-[15px] leading-[22px] text-foreground-secondary", r.detail.length <= SHORT && "shrink-0 text-right tabular-nums")}>{r.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </SectionShell>
  );
}

const STEP = "min-h-14 min-w-0 flex-1 flex-row items-center gap-2 rounded-xl px-3 active:scale-[0.96]";

export function ScoreExplainerScreen() {
  const { score } = useLocalSearchParams<{ score: string }>();
  const i = SCORE_DOCS.findIndex((d) => d.slug === score);
  // Web: notFound(). An unknown score has no page, so the index is the nearest real screen.
  if (i < 0) return <Redirect href="/more/how-it-works" />;
  const doc = SCORE_DOCS[i];
  const prev = SCORE_DOCS[i - 1];
  const next = SCORE_DOCS[i + 1];

  return (
    <DetailShell
      title={doc.name}
      subtitle="How it works"
      primary={
        <View className="w-full gap-4">
          <Text className="text-[17px] leading-6">{doc.summary}</Text>
          {doc.href && (
            <Button variant="secondary" onPress={() => router.push(doc.href as never)}>
              {`Open ${doc.name}`}
            </Button>
          )}
        </View>
      }
      secondary={doc.sections.map((s) => (
        <Section key={s.title} s={s} />
      ))}
      footer={
        <View className="gap-4">
          <Text className="text-xs font-medium leading-4 text-muted-foreground">Not a medical device. Pulse’s scores are estimates from a wrist sensor, for personal use, not a diagnosis.</Text>
          <View accessibilityLabel="Other scores" className="flex-row gap-2">
            {prev ? (
              <Pressable accessibilityRole="link" onPress={() => router.replace(`/more/how-it-works/${prev.slug}` as never)} className={STEP}>
                <Icon icon={ChevronLeft} size={20} tone="muted-foreground" strokeWidth={1.75} />
                <View className="min-w-0">
                  <Text className="text-xs font-medium leading-4 text-muted-foreground">Previous</Text>
                  <Text className="text-[15px] font-semibold leading-[22px]">{prev.name}</Text>
                </View>
              </Pressable>
            ) : (
              <View className="flex-1" />
            )}
            {next && (
              <Pressable accessibilityRole="link" onPress={() => router.replace(`/more/how-it-works/${next.slug}` as never)} className={cn(STEP, "justify-end")}>
                <View className="min-w-0 items-end">
                  <Text className="text-xs font-medium leading-4 text-muted-foreground">Next</Text>
                  <Text className="text-right text-[15px] font-semibold leading-[22px]">{next.name}</Text>
                </View>
                <Icon icon={ChevronRight} size={20} tone="muted-foreground" strokeWidth={1.75} />
              </Pressable>
            )}
          </View>
        </View>
      }
    />
  );
}
