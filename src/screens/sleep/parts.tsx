// The card material with its own padding (the web's `<Card className="gap-0 px-4 py-1">`), written once. After the kit's
// class merge lands, `<Card className="px-4 py-1">` does the same.
import type { ReactNode } from "react";
import { View } from "react-native";
import { CARD_CLASS, CardFill, useCardStyle } from "@/ui/Card";

export function PlainCard({ className, children }: { className?: string; children: ReactNode }) {
  const shadow = useCardStyle();
  return (
    <View className={`${CARD_CLASS} ${className ?? ""}`} style={shadow}>
      <CardFill />
      {children}
    </View>
  );
}
