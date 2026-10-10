import { useState } from "react";
import { Button } from "@/ui/Button";
import { SheetScreen } from "@/ui/shells/SheetScreen";
import { closeSheet } from "@/ui/shells/sheets";
import { Text } from "@/ui/Text";

// The check-in sheet, opened by the round button over any screen (src/ui/shells/CheckInAction.tsx). Placeholder: the
// Journal stream builds the check-in's content here. It is registered in app/_layout.tsx, which sets its detents.
export default function CheckIn() {
  const [saved, setSaved] = useState(false);
  return (
    <SheetScreen
      title="Check in"
      size="tall"
      done={saved ? { title: "Saved", body: "Have a great day!", onDone: closeSheet } : null}
      footer={<Button size="sheet" onPress={() => setSaved(true)}>Save</Button>}
    >
      <Text className="text-[15px] leading-[22px] text-foreground-secondary">The Journal check-in is built here from the kit.</Text>
    </SheetScreen>
  );
}
