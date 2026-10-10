import { createContext, useContext } from "react";
import { View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { cn } from "./cn";
import { Gradient } from "./Gradient";
import { useTheme } from "./theme";

/**
 * The opaque card material (spec §2.6): 16 px corners, a top hairline (dark) or a 1 px ring and soft shadow (light).
 * The fill fades 2-4 % lighter toward the top (`card-top` to `card`) as on the web: that is <CardFill>, the first child
 * of anything wearing this class. `overflow-hidden` clips the fill to the corners.
 */
export const CARD_CLASS = "overflow-hidden rounded-2xl bg-card";

/**
 * The fill of the card material: a native gradient from `card-top` to `card`, with the lit top edge (and an optional
 * inset `ring` colour: a selected or flagged card) drawn over it, since a gradient child would hide the parent's own
 * inset shadow. Put it first inside a CARD_CLASS view. Light mode draws nothing: `card-top` equals `card` there.
 */
export function CardFill({ ring }: { ring?: string }) {
  const { c, scheme } = useTheme();
  if (scheme !== "dark") return null;
  return (
    <>
      <Gradient from={c["card-top"]} to={c.card} angle="y" />
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16, boxShadow: `inset 0 1px 0 ${c["card-edge"]}${ring ? `, inset 0 0 0 1px ${ring}` : ""}` }} />
    </>
  );
}

/** True inside a <Card>: a row in a card steps down to a flat secondary row (the web's `in-data-[slot=card]:`), no card in a card. */
const InCard = createContext(false);
export const useInCard = () => useContext(InCard);

export function useCardStyle(): ViewStyle & { boxShadow: string } {
  const { c, scheme } = useTheme();
  return {
    boxShadow: scheme === "dark" ? `inset 0 1px 0 ${c["card-edge"]}` : "0 1px 2px rgba(16, 21, 24, 0.05), 0 0 0 1px rgba(16, 21, 24, 0.05)",
  };
}

/** `ring`: a 1 px ring colour (the web's `ring-1 ring-*`: an alert's red, a selected card's white) drawn inside the edge. */
export function Card({ className, style, ring, children, ...props }: ViewProps & { style?: StyleProp<ViewStyle>; ring?: string }) {
  const shadow = useCardStyle();
  return (
    <InCard.Provider value>
      <View className={cn(CARD_CLASS, "py-4", className)} style={[ring ? { boxShadow: `${shadow.boxShadow}, inset 0 0 0 1px ${ring}` } : shadow, style]} {...props}>
        <CardFill ring={ring} />
        {children}
      </View>
    </InCard.Provider>
  );
}
