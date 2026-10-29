import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { requestWidget, widgetsAvailable } from "../../../modules/pulse-widgets";
import { appState, queryCtx } from "@/state/app";
import { refreshWidgets } from "@/widgets/publish";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { SectionShell } from "@/ui/shells/SectionShell";
import { BODY, HINT } from "./controls";

export function WidgetSettings() {
  const { t } = useTranslation("widgets");
  const add = async (size: "small" | "medium" | "large") => {
    if (!widgetsAvailable()) return toast.error(t("rebuild"));
    try {
      const { source, profile } = appState();
      if (source && profile) await refreshWidgets(queryCtx(), source, { force: true });
      toast.success(t(requestWidget(size) ? "added" : "manual"));
    } catch {
      toast.error(t("manual"));
    }
  };
  return (
    <SectionShell variant="card" title={t("title")}>
      <View className="gap-3 py-3">
        <Text className={BODY}>{t("about")}</Text>
        {(["small", "medium", "large"] as const).map((size) => (
          <Button key={size} variant="outline" accessibilityLabel={`${t("add")}: ${t(`sizes.${size}`)}`} onPress={() => void add(size)}>{t(`sizes.${size}`)}</Button>
        ))}
        <Text className={HINT}>{t("refresh")}</Text>
        <Text className={HINT}>{t("manual")}</Text>
      </View>
    </SectionShell>
  );
}
