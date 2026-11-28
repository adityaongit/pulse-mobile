import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { requestWidget, widgetsAvailable } from "../../../modules/pulse-widgets";
import { appState, queryCtx } from "@/state/app";
import { refreshWidgets } from "@/widgets/publish";
import { cn } from "@/ui/cn";
import { haptic } from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { MenuPanel, useMenu } from "@/ui/Menu";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/Toast";
import { SectionShell } from "@/ui/shells/SectionShell";
import { HINT, ROW, ROW_LABEL } from "./controls";

const SIZES = ["small", "medium", "large"] as const;

/** Add widget: one row whose sizes open in a dropdown (the kit's MenuPanel); a pick asks the launcher to pin that size. */
export function WidgetSettings() {
  const { t } = useTranslation("widgets");
  const { ref, anchor, open, close } = useMenu();
  const add = async (size: (typeof SIZES)[number]) => {
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
      <View ref={ref} collapsable={false}>
        <Press activeBg="bg-fill-pressed" accessibilityRole="button" accessibilityState={{ expanded: !!anchor }} onPress={() => (haptic.tap(), open())} className={cn(ROW, "-mx-2 rounded-lg px-2")}>
          <Text className={ROW_LABEL}>{t("add")}</Text>
          <Icon icon={ChevronDown} size={18} tone="muted-foreground" strokeWidth={2} />
        </Press>
        <MenuPanel anchor={anchor} onClose={close} align="end" className="min-w-56">
          {SIZES.map((size) => (
            <Press
              key={size}
              activeBg="bg-fill-pressed"
              accessibilityRole="menuitem"
              onPress={() => {
                close();
                void add(size);
              }}
              className="min-h-12 justify-center rounded-xl px-3 py-2"
            >
              <Text className="text-[15px] font-medium leading-5">{t(`sizes.${size}`)}</Text>
            </Press>
          ))}
        </MenuPanel>
      </View>
      <Text className={HINT}>{t("about")}</Text>
    </SectionShell>
  );
}
