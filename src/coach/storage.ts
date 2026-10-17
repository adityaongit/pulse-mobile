// The coach's stored state on the phone (the web's src/server/coach/store.ts): consent, provider and model, the person's
// own notes (AsyncStorage); the API key (expo-secure-store, Android Keystore-backed: never logged, never shown back,
// only its last four characters are kept beside the setup); and the chats, in the app's Store (halo keeps a separate
// coach.db). Every change notifies `subscribe`rs so open screens refresh. Ported from halo src/coach/storage.ts.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { UIMessage } from "ai";
import * as SecureStore from "expo-secure-store";
import { appStore } from "@/state/app";
import { CHAT_PAGE, titleOf, type ChatCursor, type ChatRow } from "./chats";

/** What the screens may know about the setup: never the key itself. */
export type CoachSetup = {
  provider: string | null;
  model: string | null;
  last4: string | null;
  consent: boolean;
  instructions: string | null;
  /** The workout pill asks the provider for a one-line take as a workout opens; off, it asks only when tapped. */
  autoAnalysis: boolean;
  /** The person's own server (provider "custom"): its OpenAI-compatible URL. */
  baseUrl: string | null;
};

const SETUP_KEY = "pulse.coach.setup";
const API_KEY = "pulse.coach.apiKey";
const EMPTY: CoachSetup = { provider: null, model: null, last4: null, consent: false, instructions: null, autoAnalysis: true, baseUrl: null };

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
/** Called after any setup or chat change; returns the unsubscribe. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

const now = () => Math.floor(Date.now() / 1000);

// ── Setup and key ────────────────────────────────────────────────────────────

export async function coachSetup(): Promise<CoachSetup> {
  const raw = await AsyncStorage.getItem(SETUP_KEY).catch(() => null);
  if (!raw) return EMPTY;
  try {
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<CoachSetup>) };
  } catch {
    return EMPTY;
  }
}

async function patchSetup(p: Partial<CoachSetup>): Promise<void> {
  const next = { ...(await coachSetup()), ...p };
  await AsyncStorage.setItem(SETUP_KEY, JSON.stringify(next));
  emit();
}

export const setConsent = (on: boolean) => patchSetup({ consent: on });

/** The person's notes for the coach (null clears them). */
export const setInstructions = (notes: string | null) => patchSetup({ instructions: notes?.trim() || null });

/** Whether a workout's coach pill analyses it as it opens (GitHub #5). */
export const setAutoAnalysis = (on: boolean) => patchSetup({ autoAnalysis: on });

/**
 * Stores the provider, model and server URL, and the key in secure storage (call only after the test request worked).
 * The person's own server may take no key; then none is kept.
 */
export async function saveProvider(c: { provider: string; model: string; apiKey: string | null; baseUrl: string | null }): Promise<void> {
  if (c.apiKey) await SecureStore.setItemAsync(API_KEY, c.apiKey, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(API_KEY).catch(() => {});
  await patchSetup({ provider: c.provider, model: c.model, last4: c.apiKey ? c.apiKey.slice(-4) : null, baseUrl: c.baseUrl });
}

export async function removeProvider(): Promise<void> {
  await SecureStore.deleteItemAsync(API_KEY).catch(() => {});
  await patchSetup({ provider: null, model: null, last4: null, baseUrl: null });
}

/** The saved key, or null (none saved, or the keystore can no longer read it: the person adds it again). */
export async function apiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(API_KEY).catch(() => null);
}

// ── Chats ────────────────────────────────────────────────────────────────────
// In the app's one Store (src/data, table coach_chats), where halo keeps its own coach.db.

/** One page of chats, newest first, after `before` when given; `next` is the cursor for the page after, if any. */
export async function listChats(before?: ChatCursor): Promise<{ chats: ChatRow[]; next: ChatCursor | null }> {
  const rows = await appStore().coachChats(CHAT_PAGE + 1, before);
  const chats = rows.slice(0, CHAT_PAGE);
  const last = chats.at(-1);
  return { chats, next: rows.length > CHAT_PAGE && last ? { updatedAt: last.updatedAt, id: last.id } : null };
}

export const chatCount = (): Promise<number> => appStore().coachChatCount();

export async function loadChat(id: string): Promise<UIMessage[] | null> {
  return (await appStore().coachChatMessages(id)) as UIMessage[] | null;
}

/** Saves the whole chat; the title follows the first question, so editing it renames the chat. */
export async function saveChat(id: string, messages: UIMessage[]): Promise<void> {
  await appStore().putCoachChat(id, titleOf(messages), messages, now());
  emit();
}

export async function deleteChat(id: string): Promise<void> {
  await appStore().deleteCoachChats(id);
  emit();
}

export async function deleteAllChats(): Promise<void> {
  await appStore().deleteCoachChats();
  emit();
}
