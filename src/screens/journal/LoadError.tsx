import { CircleAlert } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { EmptyState } from "@/ui/shells/EmptyState";

/** The web's error view for every (app) route (app/(app)/error.tsx): the screen offers a retry. */
export function LoadError({ retry }: { retry: () => void }) {
  const { t } = useTranslation("journal");
  return (
    <View accessibilityRole="alert" className="pt-16">
      <EmptyState icon={CircleAlert} body={t("loadError.body")} action={{ label: t("actions.tryAgain", { ns: "common" }), onClick: retry }} />
    </View>
  );
}
