import { HomeScreen } from "@/screens/home/HomeScreen";
import { ShellData } from "@/screens/home/ShellData";

// Home, `/` (spec §7.1): the day's scores and My Day. The query and the page are src/queries/home.ts and src/screens/home.
export default function Home() {
  return (
    <ShellData>
      <HomeScreen />
    </ShellData>
  );
}
