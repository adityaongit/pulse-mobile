import { CircleAlert } from "lucide-react-native";
import { View } from "react-native";
import { EmptyState } from "@/ui/shells/EmptyState";

/** The web's error view for every (app) route (app/(app)/error.tsx): the screen offers a retry. */
export function LoadError({ retry }: { retry: () => void }) {
  return (
    <View accessibilityRole="alert" className="pt-16">
      <EmptyState icon={CircleAlert} body="Couldn’t load this screen." action={{ label: "Try again", onClick: retry }} />
    </View>
  );
}
