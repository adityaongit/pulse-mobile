// The card material with its own padding: the kit's <Card> fixes py-4 and there is no class merging, so the web's
// `<Card className="gap-0 px-4 py-1">` and `CARD_MATERIAL` rows are this.
import type { ReactNode } from "react";
import { View } from "react-native";
import { CARD_CLASS, CardFill, useCardStyle } from "@/ui/Card";
import { cn } from "@/ui/cn";

export function Surface({ className, ring, children }: { className?: string; ring?: string; children: ReactNode }) {
  const shadow = useCardStyle();
  return (
    <View className={cn(CARD_CLASS, className)} style={ring ? { boxShadow: `${shadow.boxShadow}, inset 0 0 0 1px ${ring}` } : shadow}>
      <CardFill ring={ring} />
      {children}
    </View>
  );
}
