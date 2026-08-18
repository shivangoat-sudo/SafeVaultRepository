import crypto from "crypto";
import bcrypt from "bcryptjs";
import { supabase } from "./lib/supabase.js";

// In-memory store for active 2FA challenges
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

export function create2FASetupChallenge(userId: string): string {
  const tempToken = generateToken(24);
  twoFactorChallengeStore.set(tempToken, {
    id: tempToken,
    userId,
    type: "setup",
    expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 mins
    attemptCount: 0,
  });
  return tempToken;
}

export function create2FAVerifyChallenge(userId: string): string {
  const tempToken = generateToken(24);
  twoFactorChallengeStore.set(tempToken, {
    id: tempToken,
    userId,
    type: "verify",
    expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 mins
    attemptCount: 0,
  });
  return tempToken;
}

export function get2FAChallenge(tempToken: string): TwoFactorChallenge | null {
  if (!tempToken) return null;
  const challenge = twoFactorChallengeStore.get(tempToken);
  if (!challenge) return null;
  if (challenge.expiresAt < new Date()) {
    twoFactorChallengeStore.delete(tempToken);
    return null;
  }
  return challenge;
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
    // Expired session
    await supabase.from("sessions").delete().eq("id", token);
    return null;
  }

  // Get account
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

