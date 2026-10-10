import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { router, type Href } from "expo-router";
import type { ChipTone } from "@/lib/bands";
import { Button } from "../Button";
import { StatusChip } from "../metrics/primitives";
import { Text } from "../Text";
import { SheetScreen } from "./SheetScreen";
import { closeSheet, openSheet } from "./sheets";

export type InfoContent = {
  title: string;
  /** A string, or nodes (use <Text> for each paragraph). */
  body: ReactNode;
  /** A 28 px icon above the title. */
  icon?: ReactNode;
  /** Status chip beside the title ("Within 24 - 28"). */
  chip?: { tone: ChipTone; text: string };
  /** One outline action, e.g. "Open trend view". */
  action?: { label: string; href: string };
};

// An info card's content is nodes, which cannot ride in a route's params, so the opener leaves it here and the route
// (app/(sheets)/info.tsx) reads it. It is read once when the sheet mounts; a sheet restored with nothing here closes.
let current: InfoContent | null = null;

/** Opens the info sheet (spec §4.8) over the current screen with `content`. */
export function openInfo(content: InfoContent) {
  current = content;
  openSheet("/info");
}

/** The info sheet's route content: title (and chip), the explanation, one outline action. */
export function InfoSheet() {
  const [info] = useState(current);
  // A restored or deep-linked /info has no content to show.
  useEffect(() => {
    if (!info) closeSheet();
  }, [info]);
  if (!info) return null;
  const { title, body, icon, chip, action } = info;
  return (
    <SheetScreen
      title={title}
      size="tall"
      footer={
        action && (
          <Button
            size="sheet"
            variant="outline-pill"
            onPress={() => {
              closeSheet();
              router.push(action.href as Href);
            }}
          >
            {action.label}
          </Button>
        )
      }
    >
      <View className="gap-4">
        {icon && <View>{icon}</View>}
        {chip && (
          <View className="flex-row">
            <StatusChip tone={chip.tone}>{chip.text}</StatusChip>
          </View>
        )}
        {typeof body === "string" ? <Text className="text-[15px] leading-[22px] text-foreground/85">{body}</Text> : body}
      </View>
    </SheetScreen>
  );
}
