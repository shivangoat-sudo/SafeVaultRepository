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

export function generateToken(length = 32) {
  return crypto.randomBytes(length).toString("hex");
}

export async function create2FASetupChallenge(userId: string): Promise<string> {
  const tempToken = generateToken(24);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  const { error } = await supabase.from("two_factor_challenges").insert({
    account_id: userId,
    temp_token: tempToken,
    temp_secret: "setup",
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    console.error("Error creating 2FA setup challenge in DB:", error);
    throw new Error("2FA setup challenge kon niet worden opgeslagen in de database.");
  }

  return tempToken;
}

export async function create2FAVerifyChallenge(userId: string): Promise<string> {
  const tempToken = generateToken(24);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  const { error } = await supabase.from("two_factor_challenges").insert({
    account_id: userId,
    temp_token: tempToken,
    temp_secret: "verify",
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    console.error("Error creating 2FA verify challenge in DB:", error);
    throw new Error("2FA verificatie challenge kon niet worden opgeslagen in de database.");
  }

  return tempToken;
}

export async function get2FAChallenge(tempToken: string): Promise<TwoFactorChallenge | null> {
  if (!tempToken) return null;

  const { data, error } = await supabase
    .from("two_factor_challenges")
    .select("*")
    .eq("temp_token", tempToken)
    .single();

  if (error || !data) return null;

  if (new Date(data.expires_at) < new Date()) {
    await supabase.from("two_factor_challenges").delete().eq("temp_token", tempToken);
    return null;
  }

  return {
    id: data.temp_token,
    userId: data.account_id,
    type: data.temp_secret === "setup" ? "setup" : (data.temp_secret === "verify" ? "verify" : "setup"),
    tempSecret: data.temp_secret !== "setup" && data.temp_secret !== "verify" ? data.temp_secret : undefined,
    expiresAt: new Date(data.expires_at),
    attemptCount: 0,
  };
}

export async function update2FAChallengeSecret(tempToken: string, tempSecret: string): Promise<void> {
  const { error } = await supabase
    .from("two_factor_challenges")
    .update({ temp_secret: tempSecret })
    .eq("temp_token", tempToken);

  if (error) {
    console.error("Error updating 2FA challenge secret in DB:", error);
    throw new Error("Kon 2FA geheim niet bijwerken in de database.");
  }
}

export async function delete2FAChallenge(tempToken: string): Promise<void> {
  if (!tempToken) return;
  const { error } = await supabase.from("two_factor_challenges").delete().eq("temp_token", tempToken);
  if (error) {
    console.warn("Notice: 2FA challenge deletion warning:", error);
  }
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(accountId: string, hours = 5) {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("sessions")
    .insert([{ account_id: accountId, token, expires_at: expiresAt }])
    .select("token, expires_at")
    .single();

  if (error || !data) {
    console.error("Error creating session in database:", error);
    throw new Error("Sessie kon niet worden aangemaakt in de database.");
  }

  return { token: data.token, expiresAt: data.expires_at };
}

export async function validateSession(token: string) {
  if (!token || typeof token !== "string") return null;

  const { data: session, error } = await supabase
    .from("sessions")
    .select("account_id, expires_at")
    .eq("token", token)
    .single();

  if (error || !session) return null;

  if (new Date(session.expires_at) < new Date()) {
    await supabase.from("sessions").delete().eq("token", token);
    return null;
  }

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, number, name, email, role, status, owner_id")
    .eq("id", session.account_id)
    .single();

  if (accountError || !account || account.status !== "active") return null;

  return account;
}

export async function revokeSession(token: string) {
  if (!token) return;
  await supabase.from("sessions").delete().eq("token", token);
}
