import { useState, type ReactNode } from "react";
import { Pressable } from "react-native";
import { Info } from "lucide-react-native";
import { cn } from "../cn";
import { useTheme } from "../theme";
import { InfoDialog, type InfoContent } from "./InfoDialog";

export type { InfoContent };

/**
 * Info trigger and its centred info card (spec §4.8). `card`: 32 px visual inside a 44 px hit area (card headers).
 * `header`: the reference app's ringed "i", 24 px inside 44 px (DetailHeader).
 */
export function InfoButton({ info, label, variant }: { info: InfoContent; label: string; variant: "card" | "header" }) {
  const [open, setOpen] = useState(false);
  const { c } = useTheme();
  const header = variant === "header";
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`About ${label}`}
        onPress={() => setOpen(true)}
        // card: 44 px hit area pulled into the header's padding, as the web's -my-1 -mr-2 size-8 + after:-inset-1.5
        hitSlop={header ? 0 : 6}
        className={cn("items-center justify-center rounded-full active:scale-[0.96]", header ? "size-11" : "-my-1 -mr-2 size-8")}
      >
        {/* lucide's Info already draws the circle: one ring, as the reference app's header "i". */}
        <Info size={header ? 24 : 16} color={header ? c["foreground"] : c["muted-foreground"]} strokeWidth={1.75} style={header ? { opacity: 0.8 } : undefined} />
      </Pressable>
      <InfoDialog open={open} onClose={() => setOpen(false)} {...info} />
    </>
  );
}

/** Any element as the trigger of an info card (Home's day banner, "Add activity"). */
export function InfoCardTrigger({ info, className, children, accessibilityLabel }: { info: InfoContent; className?: string; children: ReactNode; accessibilityLabel?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={() => setOpen(true)} className={className}>
        {children}
      </Pressable>
      <InfoDialog open={open} onClose={() => setOpen(false)} {...info} />
    </>
  );
}
