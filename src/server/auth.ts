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

export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
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
    console.error("Error creating 2FA setup challenge:", error);
    throw new Error("2FA setup challenge kon niet worden opgeslagen.");
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
    console.error("Error creating 2FA verify challenge:", error);
    throw new Error("2FA verificatiechallenge kon niet worden opgeslagen.");
  }

  return tempToken;
}

export async function get2FAChallenge(tempToken: string): Promise<TwoFactorChallenge | null> {
  if (!tempToken) return null;

  const { data, error } = await supabase
    .from("two_factor_challenges")
    .select("id, account_id, temp_token, temp_secret, expires_at")
    .eq("temp_token", tempToken)
    .maybeSingle();

  if (error || !data) return null;

  if (new Date(data.expires_at).getTime() <= Date.now()) {
    await delete2FAChallenge(tempToken);
    return null;
  }

  const type = data.temp_secret === "verify" ? "verify" : data.temp_secret === "setup" ? "setup" : null;
  if (!type) return null;

  return {
    id: data.id,
    userId: data.account_id,
    type,
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
    console.error("Error updating 2FA challenge secret:", error);
    throw new Error("Kon 2FA-geheim niet bijwerken.");
  }
}

export async function delete2FAChallenge(tempToken: string): Promise<void> {
  if (!tempToken) return;
  const { error } = await supabase
    .from("two_factor_challenges")
    .delete()
    .eq("temp_token", tempToken);
  if (error) console.warn("2FA challenge deletion warning:", error.message);
}

export async function createSession(accountId: string, hours = 5) {
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 5;
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + safeHours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("sessions")
    .insert({ account_id: accountId, token, expires_at: expiresAt })
    .select("token, expires_at")
    .single();

  if (error || !data) {
    console.error("Error creating session:", error);
    throw new Error("Sessie kon niet worden aangemaakt.");
  }

  return { token: data.token, expiresAt: data.expires_at };
}

export async function validateSession(token: string) {
  if (!token || typeof token !== "string") return null;

  const { data: session, error } = await supabase
    .from("sessions")
    .select("account_id, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error || !session) return null;

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await supabase.from("sessions").delete().eq("token", token);
    return null;
  }

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, number, name, email, role, status, owner_id")
    .eq("id", session.account_id)
    .maybeSingle();

  if (accountError || !account || account.status !== "active") return null;
  return account;
}

export async function revokeSession(token: string): Promise<void> {
  if (!token) return;
  await supabase.from("sessions").delete().eq("token", token);
}
