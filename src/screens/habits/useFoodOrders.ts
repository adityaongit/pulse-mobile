// The food-order row on Habits: how many orders the SMS confirmations found this week and a month of per-day counts.
// The message text never leaves the phone; only merchant, day and the dedupe key are stored.
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import { scanFoodOrders } from "@/actions/foodOrders";
import { actionCtx, dataChanged } from "@/state/app";
import { getFoodOrders } from "@/queries/foodOrders";
import { useScreen } from "@/screens/useScreen";
import { attempt } from "@/lib/attempt";
import { toast } from "@/ui/Toast";

const LAST_SCAN = "pulse.foodOrders.lastScan";
const SCAN_EVERY_MS = 6 * 60 * 60 * 1000;

const nowS = () => Math.floor(Date.now() / 1000);

/** The food row's data and its scan: once per mount, at most every six hours; the Scan button re-runs it. */
export function useFoodOrders() {
  const { t } = useTranslation("habits");
  const { data, reload } = useScreen(getFoodOrders, ["food-orders"], { freshMs: 0 });
  const [scanning, setScanning] = useState(false);
  const auto = useRef(false);

  const scan = async (announce: boolean) => {
    setScanning(true);
    await attempt(async () => {
      const res = await scanFoodOrders(actionCtx().store, actionCtx().timeZone, nowS());
      if (!res.ok) {
        if (announce) toast.error(t(res.error === "unsupported" ? "food.unsupported" : "food.permissionDenied"));
        return;
      }
      await AsyncStorage.setItem(LAST_SCAN, String(Date.now())).catch(() => {});
      dataChanged("habits");
      reload();
      if (announce) toast.success(res.added > 0 ? t("food.found", { count: res.added }) : t("food.noneFound"));
    }, { finally: () => setScanning(false) });
  };
  const autoScan = useEffectEvent(() => scan(false));

  useEffect(() => {
    if (auto.current) return;
    auto.current = true;
    if (Platform.OS !== "android") return;
    void (async () => {
      const ok = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS).catch(() => false);
      if (!ok) return;
      const last = Number(await AsyncStorage.getItem(LAST_SCAN).catch(() => 0));
      if (!Number.isFinite(last) || Date.now() - last > SCAN_EVERY_MS) await autoScan();
    })();
    // The scan runs once per mount; the Scan button re-runs it.
  }, []);

  return { data, scanning, scan };
}
