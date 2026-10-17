// Both faults renderSafety.ts exists to catch, as the 6M chart had the first: a Skia Group among React Native elements,
// and a number that renders as text when it is 0.
import { Canvas, Group } from "@shopify/react-native-skia";
import { Text, View } from "react-native";

export function Plot({ months, count }: { months: string[]; count: number }) {
  return (
    <>
      <Canvas>
        <Group />
      </Canvas>
      {months.map((m) => (
        <Group key={m} />
      ))}
      <View>{count && <Text>days</Text>}</View>
    </>
  );
}
