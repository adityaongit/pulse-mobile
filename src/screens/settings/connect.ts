// The Google connect step is not built yet (the owner is choosing how the Android sign-in works). Settings already draws
// every state from the stored grant (`google.grant`: not connected, connected, revoked); the buttons call these three
// functions, which are the places the connect step plugs in. Each stays a stub that says so until then.
//
// What the real step must do (src/google/token.ts is the contract the sync and client already use):
//  - connectGoogle(): run the native OAuth flow for the health scopes in src/google/oauth.ts SCOPES (never openid, email
//    or profile), keep the refresh token in expo-secure-store, then write the non-secret part with
//    `store.settings.set("google.grant", { scope, revokedAt: null, updatedAt })` and call `dataChanged()`. With
//    `{ switchAccount: true }` it first forgets what the current account synced (the screen has asked the person).
//  - forgetGoogleTokens(): delete the refresh token and any cached access token from expo-secure-store.
//  - syncNow(): ask the background stream for a sync run past its 5-minute gate.

import type { ActionResult } from "@/actions/journal";

const NOT_YET = "isn’t available in this build yet.";

/** Settings › Data source › Connect Google, Reconnect Google, "Pulse needs new permissions", Switch Google account. */
export async function connectGoogle(_opts: { switchAccount?: boolean } = {}): Promise<ActionResult> {
  return { ok: false, error: `Connecting Google ${NOT_YET}` };
}

/** Settings › Data source › Sync now. */
export async function syncNow(): Promise<ActionResult> {
  return { ok: false, error: `Sync ${NOT_YET}` };
}

/** Disconnect and Delete everything: removes the Google tokens from the secure store. Nothing is stored there yet. */
export async function forgetGoogleTokens(): Promise<void> {}

/** Delete everything: removes the coach's provider key from the secure store. The coach stream adds its key's name here. */
export async function forgetCoachKey(): Promise<void> {}
