// The web's (app)/error.tsx: the shell stays, the screen offers a retry. Pulse's copy.
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { CircleAlert } from "lucide-react-native";
import { DetailShell } from "@/ui/shells/DetailShell";
import { EmptyState } from "@/ui/shells/EmptyState";
import { PageShell } from "@/ui/shells/PageShell";

function Body({ retry }: { retry: () => void }) {
  const { t } = useTranslation("health");
  return (
    <View accessibilityRole="alert" className="pt-16">
      <EmptyState icon={CircleAlert} body={t("error.load")} action={{ label: t("actions.tryAgain", { ns: "common" }), onClick: retry }} />
    </View>
  );
}

/** `detail`: a pushed screen keeps its Back button. */
export function ErrorView({ retry, detail }: { retry: () => void; detail?: boolean }) {
  return detail ? <DetailShell title="Pulse" primary={<Body retry={retry} />} /> : <PageShell title="Pulse"><Body retry={retry} /></PageShell>;
}
