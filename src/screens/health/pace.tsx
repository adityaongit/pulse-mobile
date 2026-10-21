// The Pace of Aging ruler's end labels: "Slow" with a turtle, "Fast" with a rabbit.
import { Rabbit, Turtle } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";

/** As the web writes them: 15/22 secondary text, 16 px icons. */
export function Slow() {
  const { t } = useTranslation("health");
  return (
    <>
      <Icon icon={Turtle} size={16} tone="foreground-secondary" strokeWidth={1.75} />
      <Text className="text-[15px] leading-[22px] text-foreground-secondary">{t("pace.slow")}</Text>
    </>
  );
}
export function Fast() {
  const { t } = useTranslation("health");
  return (
    <>
      <Text className="text-[15px] leading-[22px] text-foreground-secondary">{t("pace.fast")}</Text>
      <Icon icon={Rabbit} size={16} tone="foreground-secondary" strokeWidth={1.75} />
    </>
  );
}
