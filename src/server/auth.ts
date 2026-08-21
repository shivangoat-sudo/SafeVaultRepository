import crypto, { randomBytes, randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { generateSecret as otplibGenerateSecret, generateURI as otplibGenerateURI, verifySync as otplibVerifySync } from "otplib";
import { supabase } from "./lib/supabase.js";

export type TwoFactorChallenge = {
  id: string;
  userId: string;
  type: "setup" | "verify";
  tempSecret?: string;
  expiresAt: Date;
  attemptCount: number;
};

// In-memory challenge store cache synchronized with database
const memoryChallengeStore = new Map<string, TwoFactorChallenge>();

export function generateToken(length = 32): string {
  return crypto.randomBytes(length).toString("hex");
}

export function generateTOTPSecret(): string {
  return otplibGenerateSecret();
}

export function getTOTPUri(label: string, issuer: string, secret: string): string {
  return otplibGenerateURI({ label, issuer, secret });
}

export function verifyTOTPCode(token: string, secret: string): boolean {
  if (!token || !secret) return false;
  const cleanToken = String(token).replace(/[^0-9]/g, "").trim();
  if (cleanToken.length !== 6) return false;
  
  try {
    const result = otplibVerifySync({
      token: cleanToken,
      secret: secret.trim(),
      epochTolerance: 30 // ±1 step window for clock drift tolerance
    });
    return Boolean(result.valid);
  } catch (err) {
    console.error("[AUTH] TOTP verification error:", err);
    return false;
  }
}

export async function create2FASetupChallenge(userId: string): Promise<string> {
  const tempToken = generateToken(24);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes TTL

  const challenge: TwoFactorChallenge = {
    id: tempToken,
    userId,
    type: "setup",
    tempSecret: "setup",
    expiresAt,
    attemptCount: 0
  };

  memoryChallengeStore.set(tempToken, challenge);

  try {
    await supabase.from("two_factor_challenges").insert({
      account_id: userId,
      temp_token: tempToken,
      temp_secret: "setup",
      expires_at: expiresAt.toISOString(),
    });
  } catch {
    // Database table might not exist in schema cache; in-memory store acts as primary fallback
  }

  return tempToken;
}

export async function create2FAVerifyChallenge(userId: string): Promise<string> {
  const tempToken = generateToken(24);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes TTL

  const challenge: TwoFactorChallenge = {
    id: tempToken,
    userId,
    type: "verify",
    tempSecret: "verify",
    expiresAt,
    attemptCount: 0
  };

  memoryChallengeStore.set(tempToken, challenge);

  try {
    await supabase.from("two_factor_challenges").insert({
      account_id: userId,
      temp_token: tempToken,
      temp_secret: "verify",
      expires_at: expiresAt.toISOString(),
    });
  } catch {
    // Database table might not exist in schema cache; in-memory store acts as primary fallback
  }

  return tempToken;
}

export async function get2FAChallenge(tempToken: string): Promise<TwoFactorChallenge | null> {
  if (!tempToken) return null;

  // Check memory store first
  const memChallenge = memoryChallengeStore.get(tempToken);
  if (memChallenge) {
    if (memChallenge.expiresAt < new Date()) {
      memoryChallengeStore.delete(tempToken);
      try {
        await supabase.from("two_factor_challenges").delete().eq("temp_token", tempToken);
      } catch {
        // ignore
      }
      return null;
    }
    return memChallenge;
  }

  // Fallback to database
  try {
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

    const challenge: TwoFactorChallenge = {
      id: data.temp_token,
      userId: data.account_id,
      type: data.temp_secret === "verify" ? "verify" : "setup",
      tempSecret: data.temp_secret !== "setup" && data.temp_secret !== "verify" ? data.temp_secret : undefined,
      expiresAt: new Date(data.expires_at),
      attemptCount: 0,
    };

    memoryChallengeStore.set(tempToken, challenge);
    return challenge;
  } catch {
    return null;
  }
}

export async function update2FAChallengeSecret(tempToken: string, tempSecret: string): Promise<void> {
  const memChallenge = memoryChallengeStore.get(tempToken);
  if (memChallenge) {
    memChallenge.tempSecret = tempSecret;
  }

  try {
    await supabase
      .from("two_factor_challenges")
      .update({ temp_secret: tempSecret })
      .eq("temp_token", tempToken);
  } catch {
    // ignore
  }
}

export async function delete2FAChallenge(tempToken: string): Promise<void> {
  if (!tempToken) return;
  memoryChallengeStore.delete(tempToken);
  try {
    await supabase.from("two_factor_challenges").delete().eq("temp_token", tempToken);
  } catch {
    // ignore
  }
}

export async function clearUser2FAChallenges(userId: string): Promise<void> {
  if (!userId) return;
  for (const [token, ch] of memoryChallengeStore.entries()) {
    if (ch.userId === userId) {
      memoryChallengeStore.delete(token);
    }
  }
  try {
    await supabase.from("two_factor_challenges").delete().eq("account_id", userId);
  } catch {
    // ignore
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}

export async function createSession(accountId: string, hours = 5) {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("sessions")
    .insert([{ id: token, account_id: accountId, expires_at: expiresAt }])
    .select("id, expires_at")
    .single();

  if (error || !data) {
    console.error("[AUTH] Error creating session in database:", error);
    throw new Error("Sessie kon niet worden aangemaakt in de database.");
  }

  return { token: data.id, expiresAt: data.expires_at };
}

export async function validateSession(token: string) {
  if (!token || typeof token !== "string") return null;

  const { data: session, error } = await supabase
    .from("sessions")
    .select("id, account_id, expires_at")
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

  let isOrgUser = false;
  if (account.owner_id) {
    const { data: parent } = await supabase
      .from("accounts")
      .select("role")
      .eq("id", account.owner_id)
      .single();
    if (parent && parent.role === "organization") {
      isOrgUser = true;
    }
  }

  return { ...account, is_org_user: isOrgUser };
}

export async function revokeSession(token: string): Promise<void> {
  if (!token) return;
  await supabase.from("sessions").delete().eq("id", token);
}

// 2FA state persistence helper
export async function getAccount2FAState(accountId: string): Promise<{
  two_factor_enabled: boolean;
  totp_secret: string | null;
  last_2fa_verified_at: string | null;
}> {
  // 1. Try reading direct columns on accounts table
  try {
    const { data, error } = await supabase
      .from("accounts")
      .select("two_factor_enabled, totp_secret, last_2fa_verified_at")
      .eq("id", accountId)
      .single();

    if (!error && data) {
      return {
        two_factor_enabled: Boolean(data.two_factor_enabled),
        totp_secret: (data.totp_secret as string) || null,
        last_2fa_verified_at: (data.last_2fa_verified_at as string) || null,
      };
    }
  } catch {
    // accounts table might lack these columns
  }

  // 2. Read from customer_profile_fields as persistent fallback store
  try {
    const { data: fields } = await supabase
      .from("customer_profile_fields")
      .select("field_key, field_value")
      .eq("customer_id", accountId)
      .in("field_key", ["two_factor_enabled", "totp_secret", "last_2fa_verified_at"]);

    const map = new Map((fields || []).map((f) => [f.field_key, f.field_value]));
    const enabled = map.get("two_factor_enabled") === "true";
    const secret = map.get("totp_secret") || null;
    const verifiedAt = map.get("last_2fa_verified_at") || null;

    return {
      two_factor_enabled: enabled,
      totp_secret: secret,
      last_2fa_verified_at: verifiedAt,
    };
  } catch (err) {
    console.error("[AUTH] Error retrieving 2FA state from customer_profile_fields:", err);
    return {
      two_factor_enabled: false,
      totp_secret: null,
      last_2fa_verified_at: null,
    };
  }
}

export async function saveAccount2FAState(
  accountId: string,
  state: {
    two_factor_enabled?: boolean;
    totp_secret?: string | null;
    last_2fa_verified_at?: string | null;
  }
): Promise<void> {
  // 1. Try saving direct columns on accounts table
  let directSuccess = false;
  try {
    const updateData: any = {};
    if (state.two_factor_enabled !== undefined) updateData.two_factor_enabled = state.two_factor_enabled;
    if (state.totp_secret !== undefined) updateData.totp_secret = state.totp_secret;
    if (state.last_2fa_verified_at !== undefined) updateData.last_2fa_verified_at = state.last_2fa_verified_at;

    if (Object.keys(updateData).length > 0) {
      const { error } = await supabase.from("accounts").update(updateData).eq("id", accountId);
      if (!error) {
        directSuccess = true;
      }
    }
  } catch {
    directSuccess = false;
  }

  // 2. Also persist in customer_profile_fields
  try {
    if (state.two_factor_enabled !== undefined) {
      const val = state.two_factor_enabled ? "true" : "false";
      await supabase.from("customer_profile_fields").delete().eq("customer_id", accountId).eq("field_key", "two_factor_enabled");
      await supabase.from("customer_profile_fields").insert({ customer_id: accountId, field_key: "two_factor_enabled", field_value: val });
    }
    if (state.totp_secret !== undefined) {
      await supabase.from("customer_profile_fields").delete().eq("customer_id", accountId).eq("field_key", "totp_secret");
      if (state.totp_secret) {
        await supabase.from("customer_profile_fields").insert({ customer_id: accountId, field_key: "totp_secret", field_value: state.totp_secret });
      }
    }
    if (state.last_2fa_verified_at !== undefined) {
      await supabase.from("customer_profile_fields").delete().eq("customer_id", accountId).eq("field_key", "last_2fa_verified_at");
      if (state.last_2fa_verified_at) {
        await supabase.from("customer_profile_fields").insert({ customer_id: accountId, field_key: "last_2fa_verified_at", field_value: state.last_2fa_verified_at });
      }
    }
  } catch (err) {
    if (!directSuccess) {
      console.error("[AUTH] Error saving 2FA state to customer_profile_fields:", err);
      throw new Error("Fout bij opslaan 2FA-status in database.");
    }
  }
}

export async function resetAccount2FAState(accountId: string): Promise<void> {
  await clearUser2FAChallenges(accountId);
  await saveAccount2FAState(accountId, {
    two_factor_enabled: false,
    totp_secret: null,
    last_2fa_verified_at: null,
  });
}

