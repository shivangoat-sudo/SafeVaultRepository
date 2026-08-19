import crypto from "crypto";
import bcrypt from "bcryptjs";
import { supabase } from "./lib/supabase.js";

export type TwoFactorChallenge = {
  id: string;
  userId: string;
  type: "setup" | "verify";
  tempSecret?: string;
  expiresAt: Date;
  attemptCount: number;
};

export const twoFactorChallengeStore = new Map<string, TwoFactorChallenge>();

export function generateToken(length = 32) {
  return crypto.randomBytes(length).toString("hex");
}

export async function create2FASetupChallenge(userId: string): Promise<string> {
  const tempToken = generateToken(24);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  
  twoFactorChallengeStore.set(tempToken, {
    id: tempToken,
    userId,
    type: "setup",
    expiresAt,
    attemptCount: 0,
  });

  await supabase.from("two_factor_challenges").insert({
    account_id: userId,
    temp_token: tempToken,
    temp_secret: "setup",
    expires_at: expiresAt.toISOString(),
  }).catch(() => {});

  return tempToken;
}

export async function create2FAVerifyChallenge(userId: string): Promise<string> {
  const tempToken = generateToken(24);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  twoFactorChallengeStore.set(tempToken, {
    id: tempToken,
    userId,
    type: "verify",
    expiresAt,
    attemptCount: 0,
  });

  await supabase.from("two_factor_challenges").insert({
    account_id: userId,
    temp_token: tempToken,
    temp_secret: "verify",
    expires_at: expiresAt.toISOString(),
  }).catch(() => {});

  return tempToken;
}

export async function get2FAChallenge(tempToken: string): Promise<TwoFactorChallenge | null> {
  if (!tempToken) return null;
  const challenge = twoFactorChallengeStore.get(tempToken);
  if (challenge) {
    if (challenge.expiresAt < new Date()) {
      twoFactorChallengeStore.delete(tempToken);
      return null;
    }
    return challenge;
  }

  // Fallback to Supabase table
  const { data } = await supabase.from("two_factor_challenges").select("*").eq("temp_token", tempToken).single();
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) {
    await supabase.from("two_factor_challenges").delete().eq("temp_token", tempToken);
    return null;
  }

  const restored: TwoFactorChallenge = {
    id: data.temp_token,
    userId: data.account_id,
    type: data.temp_secret === "setup" ? "setup" : "verify",
    tempSecret: data.temp_secret !== "setup" && data.temp_secret !== "verify" ? data.temp_secret : undefined,
    expiresAt: new Date(data.expires_at),
    attemptCount: 0,
  };
  twoFactorChallengeStore.set(tempToken, restored);
  return restored;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(accountId: string, hours = 5) {
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("sessions")
    .insert([{ account_id: accountId, expires_at: expiresAt }])
    .select("id, expires_at")
    .single();

  if (error || !data) {
    console.error("Error creating session in database:", error);
    throw new Error("Sessie kon niet worden aangemaakt.");
  }

  return { token: data.id, expiresAt: data.expires_at };
}

export async function validateSession(token: string) {
  if (!token || typeof token !== "string") return null;

  const { data: session, error } = await supabase
    .from("sessions")
    .select("account_id, expires_at")
    .eq("id", token)
    .single();

  if (error || !session) return null;

  if (new Date(session.expires_at) < new Date()) {
    await supabase.from("sessions").delete().eq("id", token);
    return null;
  }

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, number, name, role, status, owner_id")
    .eq("id", session.account_id)
    .single();

  if (accountError || !account || account.status !== "active") return null;

  if (account.role === "user" && String(account.number).startsWith("2")) {
    account.role = "organization";
  }

  return account;
}

export async function revokeSession(token: string) {
  if (!token) return;
  await supabase.from("sessions").delete().eq("id", token);
}
