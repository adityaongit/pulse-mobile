// About (moved from Settings, U21): the user's own wording, version, scoring version, the repo and its issues. Ported from
// pulse (app)/more/About.tsx. Licence and full credits stay in LICENSE, NOTICE and the README.
import { Linking, View } from "react-native";
import { ArrowUpRight } from "lucide-react-native";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { SectionShell } from "@/ui/shells/SectionShell";
import { Text } from "@/ui/Text";
import { BODY, Divider, ROW } from "../settings/controls";

export const REPO_URL = "https://github.com/adityaongit/pulse";

export function About({ version, scoringVersion }: { version: string; scoringVersion: number }) {
  return (
    <SectionShell variant="card" title="About">
      <Text className={BODY}>Scoring is ported from noop. Pulse is for personal use and is not a medical device.</Text>
      <View className="mt-3 border-t border-border">
        {[
          ["Version", version],
          ["Scoring version", String(scoringVersion)],
        ].map(([k, v], i) => (
          <View key={k}>
            {i > 0 && <Divider />}
            <View className={ROW}>
              <Text className="text-[15px] leading-[22px]">{k}</Text>
              <Text className="font-numeric text-[15px] font-semibold leading-[22px] tabular-nums text-foreground-secondary">{v}</Text>
            </View>
          </View>
        ))}
      </View>
      <View className="mt-4 flex-row gap-2">
        <Button variant="secondary" className="flex-1" accessibilityLabel="Source code, opens outside the app" onPress={() => Linking.openURL(REPO_URL)}>
          <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-secondary-foreground">Source code</Text>
          <Icon icon={ArrowUpRight} size={16} tone="secondary-foreground" />
        </Button>
        <Button variant="outline-pill" className="flex-1 rounded-xl" accessibilityLabel="Report a bug, opens outside the app" onPress={() => Linking.openURL(`${REPO_URL}/issues`)}>
          <Text className="text-[13px] font-bold uppercase tracking-[0.1em]">Report a bug</Text>
          <Icon icon={ArrowUpRight} size={16} tone="foreground" />
        </Button>
      </View>
    </SectionShell>
  );
}
