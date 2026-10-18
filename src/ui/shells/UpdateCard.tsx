// The update notice at the top of every tab root, beside the Sample data card (src/state/update.ts): a newer Pulse is
// out. Update downloads it and opens Android's installer; Later hides it until the app is next started (a version cannot
// be skipped); What's new opens the release on GitHub.
import { Linking, View } from "react-native";
import { ArrowDownToLine } from "lucide-react-native";
import { installUpdate, putOffUpdate, useUpdate } from "@/state/update";
import { Card } from "../Card";
import { haptic } from "../haptics";
import { Icon } from "../Icon";
import { LABEL } from "../metrics/primitives";
import { Press } from "../Press";
import { Text } from "../Text";
import { toast } from "../Toast";

export function UpdateCard() {
  const { available: u, progress } = useUpdate();
  if (!u) return null;
  const update = () => {
    haptic.tap();
    installUpdate().catch(() => toast.error("Couldn’t download the update. Try again, or get it from GitHub."));
  };
  return (
    <Card className="mb-6 gap-1 px-4">
      <Text className={LABEL}>Update available</Text>
      <Text className="text-[13px] leading-[18px] text-foreground-secondary">Pulse {u.version} is out. Updating keeps your data.</Text>
      {progress !== null ? (
        <Text accessibilityLiveRegion="polite" className="mt-2 min-h-11 py-3 text-[15px] font-semibold leading-5 tabular-nums">
          Downloading… {Math.round(progress * 100)}%
        </Text>
      ) : (
        <View className="mt-2 min-h-11 flex-row items-center gap-6">
          <Press activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={`Update to Pulse ${u.version}`} onPress={update} className="min-h-11 flex-row items-center gap-2">
            <Icon icon={ArrowDownToLine} size={18} tone="foreground" strokeWidth={1.75} />
            <Text className="text-[15px] font-semibold leading-5">Update</Text>
          </Press>
          <Press activeOpacity={0.7} accessibilityRole="link" onPress={() => void Linking.openURL(u.page).catch(() => {})} className="min-h-11 justify-center">
            <Text className="text-[15px] leading-5 text-foreground-secondary">What’s new</Text>
          </Press>
          <Press activeOpacity={0.7} accessibilityRole="button" onPress={putOffUpdate} className="ml-auto min-h-11 justify-center">
            <Text className="text-[15px] leading-5 text-muted-foreground">Later</Text>
          </Press>
        </View>
      )}
    </Card>
  );
}
