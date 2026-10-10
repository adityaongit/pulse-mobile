import { useLocalSearchParams } from "expo-router";
import { NapScreen } from "@/screens/sleep/NapScreen";

// A nap on its own, `/sleep/nap/[id]`; the id is a Google resource name, so napHref encodes it.
const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export default function Nap() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <NapScreen id={decode(id)} />;
}
