// The Health screens' info-card copy, from pulse's pages (final copy: do not reword). The web's <p> is a <Text> styled as
// the info card's body (the same as src/screens/_lib/info.tsx's, which does not export it).
import type { ReactNode } from "react";
import { View } from "react-native";
import { AGE_LABEL } from "@/lib/format";
import { Text } from "@/ui/Text";
import type { InfoContent } from "@/ui/shells/InfoButton";

function P({ children }: { children: ReactNode }) {
  return <Text className="text-[15px] leading-[22px] text-foreground/85">{children}</Text>;
}

export const MONITOR_INFO: InfoContent = {
  title: "About Health Monitor",
  body: (
    <P>
      Health Monitor compares last night’s vitals with your personal normal range: Google’s own range where it gives one, else your baseline plus or minus two standard deviations. Blood
      oxygen also flags anything below 95%. A change in several vitals at once can be an early sign of illness. Pulse is not a medical device; if you
      feel unwell, talk to a doctor.
    </P>
  ),
};

const LEVELS = [
  { swatch: "bg-stress-low", text: "Low, 0.0 - 0.9: you might be feeling calm, relaxed or sleepy." },
  { swatch: "bg-stress-medium", text: "Medium, 1.0 - 1.9: neutral, alert or mildly activated." },
  { swatch: "bg-stress-high", text: "High, 2.0 - 3.0: excited, stressed or highly activated." },
];

export const STRESS_INFO: InfoContent = {
  title: "About Stress Monitor",
  body: (
    <>
      <P>Stress Monitor scores how activated your body is, from 0 to 3, by comparing your heart rate with your daytime resting baseline.</P>
      <View className="gap-2">
        {LEVELS.map((l) => (
          <View key={l.swatch} className="flex-row items-start gap-3">
            <View accessibilityElementsHidden className={`mt-1.5 size-2.5 shrink-0 rounded-sm ${l.swatch}`} />
            <View className="flex-1">
              <P>{l.text}</P>
            </View>
          </View>
        ))}
      </View>
      <P>Pulse only scores still minutes. Movement, workouts and sleep are left out, so a walk never counts as stress.</P>
    </>
  ),
};

export const FITNESS_INFO: InfoContent = {
  title: "About Fitness",
  body: (
    <P>
      VO2 max is the most oxygen your body can use during hard exercise. Pulse ranks it against people of your age and sex from the FRIEND registry.
      Training load compares your last 7 days of strain with your last 28 (the acute to chronic ratio); 0.8 to 1.3 is the usual sweet spot.
    </P>
  ),
};

export const HEALTHSPAN_INFO: InfoContent = {
  title: "About Healthspan",
  body: (
    <P>
      {AGE_LABEL} estimates how old your body behaves, from nine habits and vitals measured over the last 6 months. Pace of Aging compares your last 30
      days with those 6 months: 1.0x means aging at the normal rate, below 1.0x slower, above 1.0x faster. Both are estimates for personal insight, not a
      medical assessment.
    </P>
  ),
};

export const HEART_RATE_INFO: InfoContent = {
  title: "About heart rate",
  body: (
    <>
      <P>Your band records heart rate through the day. Fitbit uploads it to Google Health, and Pulse reads it from there.</P>
      <P>While this screen is open on today, Pulse checks for new readings every minute. A reading usually arrives one to three minutes after your band takes it, so the newest one is never quite now.</P>
      <P>The chart shows each minute’s average. Minutes without a reading, when the band was off or not syncing, stay blank.</P>
    </>
  ),
};
