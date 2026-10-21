// About (U21): the user's own wording, version, scoring version, the repo and its issues. Ported from
// pulse (app)/more/About.tsx. Licence and full credits stay in LICENSE, NOTICE and the README.
import { Linking, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ArrowUpRight } from "lucide-react-native";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { cn } from "@/ui/cn";
import { BODY, ROW, ROW_RULE } from "../settings/controls";

export const REPO_URL = "https://github.com/adityaongit/pulse";

export function About({ version, scoringVersion }: { version: string; scoringVersion: number }) {
  const { t } = useTranslation("more");
  return (
    <SectionShell variant="card" title={t("about.title")} info={false}>
      <Text className={BODY}>{t("about.body")}</Text>
      <View className="mt-3 border-t border-border">
        {[
          [t("about.version"), version],
          [t("about.scoringVersion"), String(scoringVersion)],
        ].map(([k, v], i) => (
          <View key={k} className={cn(ROW, i > 0 && ROW_RULE)}>
            <Text className="text-[15px] leading-[22px]">{k}</Text>
            <Text className="font-numeric text-[15px] font-semibold leading-[22px] tabular-nums text-foreground-secondary">{v}</Text>
          </View>
        ))}
      </View>
      {/* On a narrow phone each label shrinks to stay on one line beside its arrow. */}
      <View className="mt-4 flex-row gap-2">
        <Button variant="secondary" className="flex-1" accessibilityLabel={t("about.sourceCodeLabel")} onPress={() => Linking.openURL(REPO_URL)}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} className="shrink text-[13px] font-bold uppercase tracking-[0.1em] text-secondary-foreground">{t("about.sourceCode")}</Text>
          <Icon icon={ArrowUpRight} size={16} tone="secondary-foreground" />
        </Button>
        <Button variant="outline" className="flex-1" accessibilityLabel={t("about.reportBugLabel")} onPress={() => Linking.openURL(`${REPO_URL}/issues`)}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} className="shrink text-[13px] font-bold uppercase tracking-[0.1em]">{t("about.reportBug")}</Text>
          <Icon icon={ArrowUpRight} size={16} tone="foreground" />
        </Button>
      </View>
    </SectionShell>
  );
}
