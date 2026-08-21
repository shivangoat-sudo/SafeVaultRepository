const __defProp = Object.defineProperty;
const __name = (target, value) =>
  __defProp(target, "name", { value, configurable: true });
import serverless from "serverless-http";
import express from "express";
import path from "path";
import fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
export const app = express();
// import removed to fix Netlify build

import QRCode from "qrcode";
import { supabase } from "./src/server/lib/supabase.js";
import {
  comparePassword,
  createSession,
  validateSession,
  revokeSession,
  create2FASetupChallenge,
  create2FAVerifyChallenge,
  get2FAChallenge,
  update2FAChallengeSecret,
  delete2FAChallenge,
  getAccount2FAState,
  saveAccount2FAState,
  resetAccount2FAState,
  generateTOTPSecret,
  getTOTPUri,
  verifyTOTPCode,
} from "./src/server/auth.js";
import bcrypt from "bcryptjs";
import multer from "multer";
import {
  sendReminderEmail,
  isEmailConfigured,
} from "./src/server/lib/email.js";
async function ensureBucketsExist() {
  const buckets = ["customer-files", "safevault_files", "safevault_archives"];
  for (const b of buckets) {
    try {
      const { error } = await supabase.storage.createBucket(b, {
        public: false,
      });
      if (error) {
        console.log(
          `Bucket ${b} creation check (maybe already exists):`,
          error.message,
        );
      } else {
        console.log(`Successfully ensured storage bucket "${b}" exists.`);
      }
    } catch (err) {
      console.warn(`Error ensuring bucket ${b} exists:`, err);
    }
  }

  // Ensure public app-assets bucket exists for email assets
  try {
    await supabase.storage.createBucket("app-assets", { public: true });
    const logoPath = path.resolve(process.cwd(), "public/safevault-logo.png");
    if (fs.existsSync(logoPath)) {
      const fileBuf = fs.readFileSync(logoPath);
      await supabase.storage
        .from("app-assets")
        .upload("safevault-logo.png", fileBuf, { upsert: true, contentType: "image/png" });
    }
  } catch (err) {
    console.warn("Notice for app-assets bucket setup:", err);
  }
}
__name(ensureBucketsExist, "ensureBucketsExist");
async function startServer() {
  const PORT = 3e3;
  await ensureBucketsExist();
  app.use(express.json());
  const requireAuth = __name(async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Geen geldige sessie." });
    }
    const token = authHeader.split(" ")[1];
    const user = await validateSession(token);
    if (!user) {
      return res.status(401).json({ error: "Sessie verlopen of ongeldig." });
    }
    req.user = user;
    req.token = token;
    next();
  }, "requireAuth");
  const canAccessCustomer = __name(async (reqUser, customerId) => {
    if (!reqUser) return false;
    if (reqUser.role === "owner") return true;
    if (reqUser.role === "customer") {
      const allowed = reqUser.id === customerId;
      if (!allowed) {
        supabase
          .from("access_logs")
          .insert({
            account_id: reqUser.id,
            account_number: reqUser.number,
            event: "unauthorized_access",
            ip: "127.0.0.1",
            metadata: {
              status: "Nieuw",
              target_customer_id: customerId,
              description:
                "Klant probeerde toegang te krijgen tot dossier van andere klant.",
            },
          })
          .then(null, (e) => console.error("Access log insert error:", e));
      }
      return allowed;
    }
    if (reqUser.role === "user") {
      const { data: customer, error } = await supabase
        .from("accounts")
        .select("owner_id, number")
        .eq("id", customerId)
        .eq("role", "customer")
        .single();
      if (error || !customer) return false;
      if (customer.owner_id === reqUser.id) return true;
      if (reqUser.owner_id) {
        if (customer.owner_id === reqUser.owner_id) return true;
        const { data: ownerAcc } = await supabase
          .from("accounts")
          .select("owner_id")
          .eq("id", customer.owner_id)
          .single();
        if (ownerAcc?.owner_id === reqUser.owner_id) {
          return true;
        }
      }
      supabase
        .from("access_logs")
        .insert({
          account_id: reqUser.id,
          account_number: reqUser.number,
          event: "unauthorized_access",
          ip: "127.0.0.1",
          metadata: {
            status: "Nieuw",
            target_customer_id: customerId,
            target_customer_number: customer.number,
            description: `Boekhouder probeerde toegang te krijgen tot niet-geautoriseerd klantendossier (${customer.number}).`,
          },
        })
        .then(null, (e) => console.error("Access log insert error:", e));
      return false;
    }
    if (reqUser.role === "organization") {
      const { data: customer } = await supabase
        .from("accounts")
        .select("owner_id, number")
        .eq("id", customerId)
        .eq("role", "customer")
        .single();
      if (!customer) return false;
      if (customer.owner_id === reqUser.id) return true;
      if (customer.owner_id) {
        const { data: bookkeeper } = await supabase
          .from("accounts")
          .select("owner_id")
          .eq("id", customer.owner_id)
          .single();
        if (bookkeeper?.owner_id === reqUser.id) return true;
      }
      supabase
        .from("access_logs")
        .insert({
          account_id: reqUser.id,
          account_number: reqUser.number,
          event: "unauthorized_access",
          ip: "127.0.0.1",
          metadata: {
            status: "Nieuw",
            target_customer_id: customerId,
            description:
              "Organisatie probeerde toegang te krijgen tot niet-gekoppeld klantendossier.",
          },
        })
        .then(null, (e) => console.error("Access log insert error:", e));
      return false;
    }
    return false;
  }, "canAccessCustomer");
  const getAccessibleCustomerIds = __name(async (reqUser) => {
    if (!reqUser) return [];
    if (reqUser.role === "owner") {
      const { data } = await supabase
        .from("accounts")
        .select("id")
        .eq("role", "customer");
      return (data || []).map((c) => c.id);
    }
    if (reqUser.role === "customer") {
      return [reqUser.id];
    }
    if (reqUser.role === "user") {
      const ownerIds = [reqUser.id];
      if (reqUser.owner_id) {
        ownerIds.push(reqUser.owner_id);
        const { data: orgUsers } = await supabase
          .from("accounts")
          .select("id")
          .eq("owner_id", reqUser.owner_id);
        if (orgUsers) {
          orgUsers.forEach((u) => ownerIds.push(u.id));
        }
      }
      const { data } = await supabase
        .from("accounts")
        .select("id")
        .eq("role", "customer")
        .in("owner_id", ownerIds);
      return (data || []).map((c) => c.id);
    }
    if (reqUser.role === "organization") {
      const { data: orgUsers } = await supabase
        .from("accounts")
        .select("id")
        .eq("owner_id", reqUser.id);
      const userIds = [reqUser.id, ...(orgUsers || []).map((u) => u.id)];
      const { data } = await supabase
        .from("accounts")
        .select("id")
        .eq("role", "customer")
        .in("owner_id", userIds);
      return (data || []).map((c) => c.id);
    }
    return [];
  }, "getAccessibleCustomerIds");

  const syncProfileFields = __name(async (customerId, data) => {
    const keys = [
      "first_name",
      "last_name",
      "bsn",
      "btw_number",
      "address",
      "postcode",
      "phone",
      "email",
    ];
    for (const key of keys) {
      if (data[key] !== undefined) {
        await supabase
          .from("customer_profile_fields")
          .delete()
          .eq("customer_id", customerId)
          .eq("field_key", key);
        if (data[key] !== null && data[key] !== "") {
          await supabase.from("customer_profile_fields").insert({
            customer_id: customerId,
            field_key: key,
            field_value: String(data[key]).trim(),
          });
        }
      }
    }
  }, "syncProfileFields");

  const getProfileWithFields = __name(async (accountId) => {
    if (!accountId) return null;
    const { data: account, error: accError } = await supabase
      .from("accounts")
      .select("id, number, name, role, status, created_at, owner_id")
      .eq("id", accountId)
      .single();
    if (accError || !account) return null;

    const { data: fields } = await supabase
      .from("customer_profile_fields")
      .select("field_key, field_value")
      .eq("customer_id", accountId);

    const profile: Record<string, any> = { ...account };

    if (fields && Array.isArray(fields)) {
      fields.forEach((f) => {
        if (f.field_key && f.field_value !== undefined && f.field_value !== null) {
          profile[f.field_key] = f.field_value;
        }
      });
    }

    const resolvedEmail =
      profile.email ||
      profile.email_address ||
      profile.emailAddress ||
      profile.mail ||
      "";

    profile.email = resolvedEmail ? String(resolvedEmail).trim() : "";

    return profile;
  }, "getProfileWithFields");

  const canAccessFilePath = __name(async (reqUser, filePath) => {
    if (!reqUser) return false;
    if (reqUser.role === "owner") return true;
    if (filePath.startsWith("notes/")) {
      const parts2 = filePath.split("/");
      if (parts2.length >= 2) {
        return canAccessCustomer(reqUser, parts2[1]);
      }
    }
    if (filePath.startsWith("communications/")) {
      const parts2 = filePath.split("/");
      if (parts2.length >= 2) {
        return canAccessCustomer(reqUser, parts2[1]);
      }
    }
    if (filePath.startsWith("archive/")) {
      const parts2 = filePath.split("/");
      if (parts2.length >= 2) {
        return canAccessCustomer(reqUser, parts2[1]);
      }
    }
    const parts = filePath.split("/");
    if (parts.length === 2) {
      return canAccessCustomer(reqUser, parts[0]);
    }
    return false;
  }, "canAccessFilePath");
  const canAccessFileId = __name(async (reqUser, fileId) => {
    if (!reqUser) return false;
    if (reqUser.role === "owner") return true;
    const { data: fileRecord } = await supabase
      .from("files")
      .select("customer_id")
      .eq("id", fileId)
      .single();
    if (fileRecord) {
      return canAccessCustomer(reqUser, fileRecord.customer_id);
    }
    return false;
  }, "canAccessFileId");
  const canAccessFolderId = __name(async (reqUser, folderId) => {
    if (!reqUser) return false;
    if (reqUser.role === "owner") return true;
    const { data: folder } = await supabase
      .from("archive_folders")
      .select("customer_id")
      .eq("id", folderId)
      .single();
    if (folder) {
      return canAccessCustomer(reqUser, folder.customer_id);
    }
    return false;
  }, "canAccessFolderId");
  const canAccessArchiveFileId = __name(async (reqUser, fileId) => {
    if (!reqUser) return false;
    if (reqUser.role === "owner") return true;
    const { data: file } = await supabase
      .from("archive_files")
      .select("customer_id")
      .eq("id", fileId)
      .single();
    if (file) {
      return canAccessCustomer(reqUser, file.customer_id);
    }
    return false;
  }, "canAccessArchiveFileId");
  const canAccessNoteId = __name(async (reqUser, noteId) => {
    if (!reqUser) return false;
    if (reqUser.role === "owner") return true;
    const { data: note } = await supabase
      .from("user_notes")
      .select("customer_id")
      .eq("id", noteId)
      .single();
    if (note) {
      return canAccessCustomer(reqUser, note.customer_id);
    }
    return false;
  }, "canAccessNoteId");
  const canAccessBtwCalcId = __name(async (reqUser, calcId) => {
    if (!reqUser) return false;
    if (reqUser.role === "owner") return true;
    const { data: dbCalc } = await supabase
      .from("btw_calculations")
      .select("customer_id")
      .eq("id", calcId)
      .single();
    if (dbCalc) {
      return canAccessCustomer(reqUser, dbCalc.customer_id);
    }
    return false;
  }, "canAccessBtwCalcId");
  app.post("/api/auth/emergency-reset", async (req, res) => {
    if (process.env.ALLOW_EMERGENCY_RESET !== "true") {
      return res.status(403).json({ error: "Emergency reset not allowed." });
    }
    try {
      await supabase
        .from("credentials")
        .delete()
        .neq("account_id", "00000000-0000-0000-0000-000000000000");
      await supabase
        .from("sessions")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      const { error } = await supabase
        .from("accounts")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
      res.json({ purged: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Reset failed." });
    }
  });
  app.get("/api/auth/setup-status", async (req, res) => {
    try {
      const { count, error } = await supabase
        .from("accounts")
        .select("id", { count: "exact", head: true });
      if (error) {
        console.error("Setup status check - error:", error);
        return res
          .status(500)
          .json({ error: "Interne serverfout tijdens setup-check" });
      }
      console.log("Setup status check - count:", count);
      res.json({ initialized: count !== null && count !== 0 });
    } catch (err) {
      console.error("Setup status check - unexpected error:", err);
      res.status(500).json({ error: "Interne serverfout tijdens setup-check" });
    }
  });
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { name, number, password } = req.body;
      if (!name || !number || !password) {
        return res
          .status(400)
          .json({ error: "Naam, nummer en wachtwoord zijn verplicht." });
      }
      const cleanName = String(name).trim();
      const cleanNumber = String(number).trim();
      const cleanPassword = String(password).trim();
      const { data: accounts, error: accError } = await supabase
        .from("accounts")
        .select("id, number, name, role, status, failed_attempts")
        .eq("number", cleanNumber);
      if (accError || !accounts || accounts.length === 0) {
        console.warn(
          `[AUTH] Login failed: No account found for number ${cleanNumber}`,
        );
        return res.status(401).json({ error: "Onjuiste inloggegevens." });
      }
      const normalizeStr = __name(
        (s) =>
          String(s || "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " "),
        "normalizeStr",
      );
      const inputNorm = normalizeStr(cleanName);
      const matchingAccounts = accounts.filter((acc) => {
        const dbNorm = normalizeStr(acc.name);
        const dbCleanNorm = normalizeStr(
          acc.name.replace(/\s*\(.*?\)\s*/g, ""),
        );
        const numberNorm = normalizeStr(acc.number);
        const defaultKlantNorm = normalizeStr("klant " + acc.number);
        if (acc.role === "customer" || String(acc.number).startsWith("6")) {
          return true;
        }
        return dbNorm === inputNorm || dbCleanNorm === inputNorm;
      });
      if (matchingAccounts.length === 0) {
        console.warn(
          `[AUTH] Login failed: Name mismatch for number ${cleanNumber}. Input: "${cleanName}"`,
        );
        return res.status(401).json({ error: "Onjuiste inloggegevens." });
      }
      if (matchingAccounts.length > 1) {
        console.error(
          `[AUTH] Login failed: Multiple accounts matched for number ${cleanNumber} and name "${cleanName}"`,
        );
        return res.status(401).json({ error: "Onjuiste inloggegevens." });
      }
      const candidateAccount = matchingAccounts[0];
      const { data: settingRec } = await supabase
        .from("settings")
        .select("max_login_attempts, session_lifetime_hours")
        .eq("id", 1)
        .single();
      const maxLoginAttempts =
        settingRec && Number(settingRec.max_login_attempts)
          ? Number(settingRec.max_login_attempts)
          : 5;
      const sessionLifetimeHours =
        settingRec && Number(settingRec.session_lifetime_hours)
          ? Number(settingRec.session_lifetime_hours)
          : 5;
      if (candidateAccount.status !== "active") {
        console.warn(
          `[AUTH] Login rejected: Account ${cleanNumber} is "${candidateAccount.status}"`,
        );
        await supabase
          .from("access_logs")
          .insert({
            account_id: candidateAccount.id,
            account_number: candidateAccount.number,
            event: "login_blocked",
            ip: req.ip || "127.0.0.1",
            metadata: { status: "Nieuw", reason: "Account is geblokkeerd" },
          })
          .then(null, (e) => console.error("Access log insert error:", e));
        return res.status(401).json({ error: "Account is geblokkeerd." });
      }
      if ((candidateAccount.failed_attempts || 0) >= maxLoginAttempts) {
        console.warn(
          `[AUTH] Login rejected: Account ${cleanNumber} reached failed attempts limit (${candidateAccount.failed_attempts} >= ${maxLoginAttempts})`,
        );
        await supabase
          .from("accounts")
          .update({ status: "blocked" })
          .eq("id", candidateAccount.id);
        await supabase
          .from("access_logs")
          .insert({
            account_id: candidateAccount.id,
            account_number: candidateAccount.number,
            event: "login_blocked",
            ip: req.ip || "127.0.0.1",
            metadata: { status: "Nieuw", reason: "Te veel mislukte pogingen" },
          })
          .then(null, (e) => console.error("Access log insert error:", e));
        return res
          .status(401)
          .json({
            error:
              "Account tijdelijk vergrendeld vanwege te veel mislukte pogingen.",
          });
      }
      const { data: creds, error: credError } = await supabase
        .from("credentials")
        .select("password_hash")
        .eq("account_id", candidateAccount.id);
      if (
        credError ||
        !creds ||
        creds.length === 0 ||
        !creds[0].password_hash
      ) {
        console.error(
          `[AUTH] Credentials lookup failed for account: ${candidateAccount.id} (${cleanNumber})`,
        );
        return res.status(401).json({ error: "Onjuiste inloggegevens." });
      }
      const isValid = await comparePassword(
        cleanPassword,
        creds[0].password_hash,
      );
      const isExempt =
        candidateAccount.role === "customer" ||
        String(candidateAccount.number).startsWith("6");
      console.log(
        JSON.stringify({
          AUTH_DIAGNOSTIC: {
            accountLookup: true,
            accountCount: accounts.length,
            nameMatch: true,
            numberMatch: true,
            credentialsLookup: true,
            credentialsAccountMatch: true,
            passwordVerification: isValid,
            accountStatus: candidateAccount.status,
            role: candidateAccount.role,
            twoFactorRequired: !isExempt,
            sessionCreated: false,
          },
        }),
      );
      if (!isValid) {
        const newFailed = (candidateAccount.failed_attempts || 0) + 1;
        const isNowBlocked = newFailed >= maxLoginAttempts;
        const newStatus = isNowBlocked ? "blocked" : candidateAccount.status;
        console.warn(
          `[AUTH] Login failed: Password mismatch for ${cleanNumber}. Failed attempts: ${newFailed}/${maxLoginAttempts}`,
        );
        await supabase
          .from("accounts")
          .update({ failed_attempts: newFailed, status: newStatus })
          .eq("id", candidateAccount.id);
        await supabase
          .from("access_logs")
          .insert({
            account_id: candidateAccount.id,
            account_number: candidateAccount.number,
            event: "login_failed",
            ip: req.ip || "127.0.0.1",
            metadata: { failed_attempts: newFailed, status: "Nieuw" },
          })
          .then(null, (e) => console.error("Access log insert error:", e));
        if (isNowBlocked) {
          await supabase
            .from("access_logs")
            .insert({
              account_id: candidateAccount.id,
              account_number: candidateAccount.number,
              event:
                candidateAccount.role === "customer"
                  ? "customer_blocked"
                  : "account_blocked",
              ip: req.ip || "127.0.0.1",
              metadata: { status: "Nieuw" },
            })
            .then(null, (e) => console.error("Access log insert error:", e));
        }
        return res.status(401).json({ error: "Onjuiste inloggegevens." });
      }
      const isExemptFrom2FA =
        candidateAccount.role === "customer" ||
        String(candidateAccount.number).startsWith("6");
      if (isExemptFrom2FA) {
        await supabase
          .from("accounts")
          .update({
            failed_attempts: 0,
            last_login_at: new Date().toISOString(),
          })
          .eq("id", candidateAccount.id);
        const sessionLifetime = await getAccountSessionLifetime(
          candidateAccount.id,
          sessionLifetimeHours,
        );
        const { token, expiresAt } = await createSession(
          candidateAccount.id,
          sessionLifetime,
        );
        return res.json({
          token,
          account: sanitizeAccount(candidateAccount),
          expires_at: expiresAt,
        });
      }
      const twoFaState = await getAccount2FAState(candidateAccount.id);
      if (!twoFaState.two_factor_enabled || !twoFaState.totp_secret) {
        console.log(`[AUTH] 2FA setup required for ${cleanNumber}`);
        const tempToken2 = await create2FASetupChallenge(candidateAccount.id);
        return res.json({
          requires_2fa: true,
          requires_2fa_setup: true,
          temp_token: tempToken2,
        });
      }
      const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1e3;
      const lastVerifiedMs = twoFaState.last_2fa_verified_at
        ? new Date(twoFaState.last_2fa_verified_at).getTime()
        : 0;
      const isWithin48Hours =
        Date.now() - lastVerifiedMs < FORTY_EIGHT_HOURS_MS &&
        lastVerifiedMs > 0;
      if (isWithin48Hours) {
        console.log(
          `[AUTH] 2FA bypassed for ${cleanNumber} (verified < 48h ago)`,
        );
        await supabase
          .from("accounts")
          .update({
            failed_attempts: 0,
            last_login_at: new Date().toISOString(),
          })
          .eq("id", candidateAccount.id);
        const sessionLifetime = await getAccountSessionLifetime(
          candidateAccount.id,
          sessionLifetimeHours,
        );
        const { token, expiresAt } = await createSession(
          candidateAccount.id,
          sessionLifetime,
        );
        return res.json({
          token,
          account: sanitizeAccount(candidateAccount),
          expires_at: expiresAt,
        });
      }
      console.log(
        `[AUTH] 2FA TOTP code verification required for ${cleanNumber}`,
      );
      const tempToken = await create2FAVerifyChallenge(candidateAccount.id);
      return res.json({
        requires_2fa: true,
        requires_2fa_setup: false,
        temp_token: tempToken,
      });
    } catch (err) {
      console.error("[AUTH] Unexpected error during login:", err);
      res.status(500).json({ error: "Interne serverfout bij inloggen." });
    }
  });
  app.post("/api/auth/2fa/setup-init", async (req, res) => {
    try {
      const { tempToken } = req.body;
      if (!tempToken)
        return res.status(400).json({ error: "Ontbrekende sessietoken." });
      const challenge = await get2FAChallenge(tempToken);
      if (!challenge || challenge.type !== "setup") {
        return res
          .status(401)
          .json({ error: "Ongeldige of verlopen 2FA-sessie. Log opnieuw in." });
      }
      const { data: account } = await supabase
        .from("accounts")
        .select("id, name, number, role")
        .eq("id", challenge.userId)
        .single();
      if (!account)
        return res.status(404).json({ error: "Account niet gevonden." });
      let secret = challenge.tempSecret;
      if (!secret || secret === "setup" || secret.length < 16) {
        secret = generateTOTPSecret();
        await update2FAChallengeSecret(tempToken, secret);
      }
      const otpauthUri = getTOTPUri(
        account.name || account.number,
        "SafeVault",
        secret,
      );
      const qrCodeUrl = await QRCode.toDataURL(otpauthUri, {
        margin: 2,
        width: 240,
        color: { dark: "#0F172A", light: "#FFFFFF" },
      });
      res.json({
        qrCodeUrl,
        accountName: account.name,
        number: account.number,
        secret,
      });
    } catch (err) {
      console.error("[AUTH] 2FA setup-init error:", err);
      res
        .status(500)
        .json({
          error:
            "Het instellen van tweestapsverificatie is mislukt. Probeer het opnieuw.",
        });
    }
  });
  app.post("/api/auth/2fa/setup-verify", async (req, res) => {
    try {
      const { tempToken, code } = req.body;
      if (!tempToken || !code)
        return res.status(400).json({ error: "Ontbrekende velden." });
      const challenge = await get2FAChallenge(tempToken);
      if (
        !challenge ||
        challenge.type !== "setup" ||
        !challenge.tempSecret ||
        challenge.tempSecret === "setup"
      ) {
        return res
          .status(401)
          .json({ error: "Ongeldige of verlopen 2FA-sessie. Log opnieuw in." });
      }
      const cleanCode = String(code)
        .replace(/[^0-9]/g, "")
        .trim();
      if (cleanCode.length !== 6) {
        return res
          .status(400)
          .json({
            error: "De verificatiecode is onjuist. Probeer het opnieuw.",
          });
      }
      const isValid = verifyTOTPCode(cleanCode, challenge.tempSecret);
      if (!isValid) {
        return res
          .status(400)
          .json({
            error: "De verificatiecode is onjuist. Probeer het opnieuw.",
          });
      }
      const nowIso = new Date().toISOString();
      await saveAccount2FAState(challenge.userId, {
        two_factor_enabled: true,
        totp_secret: challenge.tempSecret,
        last_2fa_verified_at: nowIso,
      });
      await delete2FAChallenge(tempToken);
      const { data: account } = await supabase
        .from("accounts")
        .select("id, number, name, role, status")
        .eq("id", challenge.userId)
        .single();
      if (!account || account.status !== "active") {
        return res.status(401).json({ error: "Account is geblokkeerd." });
      }
      await supabase
        .from("accounts")
        .update({ last_login_at: nowIso, failed_attempts: 0 })
        .eq("id", account.id);
      const sessionLifetime = await getAccountSessionLifetime(account.id, 5);
      const { token, expiresAt } = await createSession(
        account.id,
        sessionLifetime,
      );
      res.json({
        token,
        account: sanitizeAccount(account),
        expires_at: expiresAt,
      });
    } catch (err) {
      console.error("[AUTH] 2FA setup-verify error:", err);
      res
        .status(500)
        .json({
          error:
            err.message ||
            "Het instellen van tweestapsverificatie is mislukt. Probeer het opnieuw.",
        });
    }
  });
  app.post("/api/auth/verify-2fa", async (req, res) => {
    try {
      const { tempToken, code } = req.body;
      if (!tempToken || !code)
        return res.status(400).json({ error: "Ontbrekende velden." });
      const challenge = await get2FAChallenge(tempToken);
      if (!challenge || challenge.type !== "verify") {
        return res
          .status(401)
          .json({ error: "Ongeldige of verlopen 2FA-sessie. Log opnieuw in." });
      }
      const cleanCode = String(code)
        .replace(/[^0-9]/g, "")
        .trim();
      if (cleanCode.length !== 6) {
        return res
          .status(400)
          .json({
            error: "De verificatiecode is onjuist. Probeer het opnieuw.",
          });
      }
      const twoFaState = await getAccount2FAState(challenge.userId);
      if (!twoFaState.totp_secret) {
        return res
          .status(400)
          .json({ error: "2FA is niet ingesteld voor dit account." });
      }
      const isValid = verifyTOTPCode(cleanCode, twoFaState.totp_secret);
      if (!isValid) {
        return res
          .status(400)
          .json({
            error: "De verificatiecode is onjuist. Probeer het opnieuw.",
          });
      }
      const nowIso = new Date().toISOString();
      await saveAccount2FAState(challenge.userId, {
        two_factor_enabled: true,
        last_2fa_verified_at: nowIso,
      });
      await delete2FAChallenge(tempToken);
      const { data: account } = await supabase
        .from("accounts")
        .select("id, number, name, role, status")
        .eq("id", challenge.userId)
        .single();
      if (!account || account.status !== "active") {
        return res.status(401).json({ error: "Account is geblokkeerd." });
      }
      await supabase
        .from("accounts")
        .update({ last_login_at: nowIso, failed_attempts: 0 })
        .eq("id", account.id);
      const sessionLifetime = await getAccountSessionLifetime(account.id, 5);
      const { token, expiresAt } = await createSession(
        account.id,
        sessionLifetime,
      );
      res.json({
        token,
        account: sanitizeAccount(account),
        expires_at: expiresAt,
      });
    } catch (err) {
      console.error("[AUTH] 2FA verify error:", err);
      res
        .status(500)
        .json({
          error: err.message || "Verificatie mislukt. Probeer het opnieuw.",
        });
    }
  });
  app.post("/api/auth/logout", requireAuth, async (req, res) => {
    await revokeSession(req.token);
    res.json({ ok: true });
  });
  app.get("/api/auth/me", requireAuth, (req, res) => {
    res.json(req.user);
  });
  app.post("/api/auth/change-name", requireAuth, async (req, res) => {
    const { newName } = req.body;
    if (!newName || !newName.trim()) {
      return res.status(400).json({ error: "Naam mag niet leeg zijn." });
    }
    const trimmed = newName.trim();
    const { error } = await supabase
      .from("accounts")
      .update({ name: trimmed, updated_at: new Date().toISOString() })
      .eq("id", req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    await supabase
      .from("access_logs")
      .insert({
        account_id: req.user.id,
        event: "name_changed",
        ip: req.ip || "127.0.0.1",
        metadata: { newName: trimmed },
      });
    res.json({ ok: true, name: trimmed });
  });
  app.post("/api/auth/change-password", requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: "Huidig en nieuw wachtwoord zijn verplicht." });
    }
    const cleanCurrentPassword = String(currentPassword).trim();
    const cleanNewPassword = String(newPassword).trim();
    if (cleanNewPassword.length < 8) {
      return res
        .status(400)
        .json({ error: "Nieuw wachtwoord moet minimaal 8 tekens bevatten." });
    }
    const { data: creds } = await supabase
      .from("credentials")
      .select("password_hash")
      .eq("account_id", req.user.id)
      .single();
    if (!creds || !creds.password_hash) {
      return res
        .status(400)
        .json({ error: "Accountinloggegevens niet gevonden." });
    }
    const isValid = await comparePassword(
      cleanCurrentPassword,
      creds.password_hash,
    );
    if (!isValid) {
      return res.status(400).json({ error: "Huidig wachtwoord is onjuist." });
    }
    const newHash = await bcrypt.hash(cleanNewPassword, 10);
    const { error } = await supabase
      .from("credentials")
      .update({ password_hash: newHash, updated_at: new Date().toISOString() })
      .eq("account_id", req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    await supabase
      .from("access_logs")
      .insert({
        account_id: req.user.id,
        event: "password_changed",
        ip: req.ip || "127.0.0.1",
      });
    res.json({ ok: true });
  });
  async function getAccountSessionLifetime(accountId, defaultHours = 5) {
    try {
      const { data: account } = await supabase
        .from("accounts")
        .select("id, number, role, owner_id")
        .eq("id", accountId)
        .single();
      if (!account) return defaultHours;
      let orgId = null;
      if (String(account.number).startsWith("2")) {
        orgId = account.id;
      } else if (String(account.number).startsWith("89") && account.owner_id) {
        orgId = account.owner_id;
      } else if (String(account.number).startsWith("6") && account.owner_id) {
        const { data: parent } = await supabase
          .from("accounts")
          .select("id, number, owner_id")
          .eq("id", account.owner_id)
          .single();
        if (parent) {
          if (String(parent.number).startsWith("2")) {
            orgId = parent.id;
          } else if (String(parent.number).startsWith("89")) {
            orgId = parent.owner_id;
          }
        }
      }
      if (orgId) {
        const { data: setRec } = await supabase
          .from("settings")
          .select("session_lifetime_hours")
          .eq("id", 1)
          .single();
        if (setRec && setRec.session_lifetime_hours) {
          return Number(setRec.session_lifetime_hours);
        }
      }
    } catch (err) {
      console.error("Error fetching custom session lifetime:", err);
    }
    return defaultHours;
  }
  __name(getAccountSessionLifetime, "getAccountSessionLifetime");
  function sanitizeAccount(account) {
    if (!account) return account;
    const copy = { ...account };
    if (copy.role === "user" && String(copy.number).startsWith("2")) {
      copy.role = "organization";
    }
    return {
      id: copy.id,
      number: copy.number,
      name: copy.name,
      role: copy.role,
      status: copy.status,
    };
  }
  __name(sanitizeAccount, "sanitizeAccount");
  function normalizeQuarter(q) {
    if (!q) return null;
    const str = String(q).trim().toUpperCase();
    if (str === "1" || str === "Q1") return "Q1";
    if (str === "2" || str === "Q2") return "Q2";
    if (str === "3" || str === "Q3") return "Q3";
    if (str === "4" || str === "Q4") return "Q4";
    return null;
  }
  __name(normalizeQuarter, "normalizeQuarter");
  function formatFileWithMetadata(f) {
    if (!f) return f;
    const metadata = f.file_metadata;
    const rawQ = metadata?.quarter || f.quarter || null;
    return {
      ...f,
      category: metadata?.category || f.category || "proof",
      quarter: normalizeQuarter(rawQ) || rawQ || null,
      year: metadata?.year || f.year || null,
      file_metadata: void 0,
    };
  }
  __name(formatFileWithMetadata, "formatFileWithMetadata");
  function formatFilesWithMetadata(files) {
    if (!files) return [];
    return files.map(formatFileWithMetadata);
  }
  __name(formatFilesWithMetadata, "formatFilesWithMetadata");
  function mergeFilesWithStore(supabaseFiles, customerId) {
    const formatted = formatFilesWithMetadata(supabaseFiles || []);
    return formatted.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }
  __name(mergeFilesWithStore, "mergeFilesWithStore");
  function mergeNotificationsWithStore(supabaseNotifs, accountId) {
    const list = supabaseNotifs ? [...supabaseNotifs] : [];
    const deduplicated = [];
    const seenKeys = new Set();
    const sorted = list.sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime(),
    );
    for (const item of sorted) {
      const timeBucket = Math.floor(
        new Date(item.created_at || Date.now()).getTime() / (5 * 60 * 1e3),
      );
      const key = `${item.account_id || accountId}_${item.kind || ""}_${(item.message || "").trim()}_${timeBucket}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        deduplicated.push(item);
      }
    }
    return deduplicated;
  }
  __name(mergeNotificationsWithStore, "mergeNotificationsWithStore");
  function extractFolderAndAttachmentsFromBody(body: string) {
    const attachments: any[] = [];
    const attachmentRegex =
      /\uD83D\uDCCE\s*\[attachment:([^:]+):([^:]+):([^:]+):([^\]]+)\]/g;
    let match;

    while ((match = attachmentRegex.exec(body)) !== null) {
      attachments.push({
        file_path: match[1],
        file_name: match[2],
        file_size: parseInt(match[3], 10),
        mime_type: match[4],
      });
    }

    // Check archive folder metadata tag: 📁 [archive_folder:FOLDER_ID]
    const folderRegex = /\uD83D\uDCC1\s*\[archive_folder:([^\]]+)\]/;
    const folderMatch = folderRegex.exec(body);
    const archive_folder_id = folderMatch ? folderMatch[1] : null;

    // Remove tags from the displayed body
    const cleanBody = body
      .replace(/\uD83D\uDCCE\s*\[attachment:[^\]]+\]/g, "")
      .replace(/\uD83D\uDCC1\s*\[archive_folder:[^\]]+\]/g, "")
      .trim();

    return { attachments, archive_folder_id, cleanBody };
  }

  function injectFolderAndAttachmentsIntoBody(
    body: string,
    attachments: any[],
    archiveFolderId?: string | null,
  ) {
    let clean = body
      .replace(/\uD83D\uDCCE\s*\[attachment:[^\]]+\]/g, "")
      .replace(/\uD83D\uDCC1\s*\[archive_folder:[^\]]+\]/g, "")
      .trim();

    let tags = "";
    if (archiveFolderId) {
      tags += `\uD83D\uDCC1 [archive_folder:${archiveFolderId}]\n`;
    }
    if (attachments && attachments.length > 0) {
      tags += attachments
        .map((a) => {
          const path = a.file_path || a.filePath;
          const name = a.file_name || a.fileName;
          const size = a.file_size || a.fileSize;
          const mime = a.mime_type || a.mimeType;
          return `\uD83D\uDCCE [attachment:${path}:${name}:${size}:${mime}]`;
        })
        .join("\n");
    }

    if (tags.trim()) {
      clean += "\n\n" + tags.trim();
    }
    return clean;
  }

  function extractAttachmentsFromBody(body: string) {
    return extractFolderAndAttachmentsFromBody(body);
  }

  function injectAttachmentsIntoBody(body: string, attachments: any[]) {
    return injectFolderAndAttachmentsIntoBody(body, attachments, null);
  }

  app.get("/api/dossier/:customerId/notes", requireAuth, async (req, res) => {
    let { customerId } = req.params;
    const user = req.user;
    if (customerId === "self") {
      customerId = user.id;
    }
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }

    let notes = [];
    let error = null;

    if (user.role === "customer") {
      const { data, error: queryError } = await supabase
        .from("user_notes")
        .select("*")
        .eq("customer_id", customerId)
        .eq("visible_to_customer", true)
        .order("created_at", { ascending: false });
      if (queryError) {
        if (queryError.code === "42703" || queryError.code === "PGRST204") {
          const { data: fallbackData, error: fallbackError } = await supabase
            .from("user_notes")
            .select("*")
            .eq("customer_id", customerId)
            .order("created_at", { ascending: false });
          notes = fallbackData || [];
          error = fallbackError;
        } else {
          notes = [];
          error = queryError;
        }
      } else {
        notes = data || [];
      }
    } else {
      const { data, error: queryError } = await supabase
        .from("user_notes")
        .select("*")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      notes = data || [];
      error = queryError;
    }

    if (error) return res.status(500).json({ error: error.message });

    const enrichedNotes = (notes || [])
      .map((n) => {
        const { attachments, archive_folder_id, cleanBody } =
          extractFolderAndAttachmentsFromBody(n.body || "");
        const first = attachments[0];
        return {
          ...n,
          body: cleanBody,
          archive_folder_id,
          attachments,
          file_path: first?.file_path,
          file_name: first?.file_name,
          file_size: first?.file_size,
          mime_type: first?.mime_type,
        };
      })
      // Only include notes that are NOT moved to an archive folder
      .filter((n) => !n.archive_folder_id);

    res.json({ notes: enrichedNotes });
  });

  app.post("/api/dossier/:customerId/notes", requireAuth, async (req, res) => {
    const { customerId } = req.params;
    const user = req.user;
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }
    if (user.role === "customer" || user.role === "organization") {
      return res
        .status(403)
        .json({ error: "Klanten kunnen geen notities aanmaken." });
    }
    const {
      title,
      body: originalBody,
      visibleToCustomer,
      attachments,
    } = req.body;
    if (!title && !originalBody)
      return res.status(400).json({ error: "Titel of inhoud is verplicht." });

    const body = injectFolderAndAttachmentsIntoBody(
      originalBody || "",
      attachments || [],
      null,
    );

    const insertData = {
      customer_id: customerId,
      user_id: user.id,
      title: title || "",
      body: body || "",
    };
    if (typeof visibleToCustomer === "boolean") {
      insertData.visible_to_customer = visibleToCustomer;
    }

    let { data: note, error } = await supabase
      .from("user_notes")
      .insert(insertData)
      .select()
      .single();
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      delete insertData.visible_to_customer;
      const retryRes = await supabase
        .from("user_notes")
        .insert(insertData)
        .select()
        .single();
      note = retryRes.data;
      error = retryRes.error;
    }

    if (error) return res.status(500).json({ error: error.message });

    if (note && note.visible_to_customer) {
      await supabase
        .from("notifications")
        .insert([
          {
            account_id: customerId,
            kind: "note_created",
            message: `Er is een nieuwe notitie voor u geplaatst: ${note.title || "Geen titel"}`,
            read: false,
            created_at: new Date().toISOString(),
          },
        ])
        .catch((e) => console.error("Note notification error:", e));
    }

    if (note) {
      const { attachments: parsedAttachments, archive_folder_id, cleanBody } =
        extractFolderAndAttachmentsFromBody(note.body || "");
      note.attachments = parsedAttachments;
      note.body = cleanBody;
      note.archive_folder_id = archive_folder_id;
      const first = parsedAttachments[0];
      note.file_path = first?.file_path;
      note.file_name = first?.file_name;
      note.file_size = first?.file_size;
      note.mime_type = first?.mime_type;
    }
    res.json({ note });
  });

  app.put("/api/dossier/notes/:noteId", requireAuth, async (req, res) => {
    const { noteId } = req.params;
    const user = req.user;
    if (user.role === "customer" || user.role === "organization") {
      return res
        .status(403)
        .json({ error: "Klanten kunnen geen notities bewerken." });
    }
    if (!(await canAccessNoteId(user, noteId))) {
      return res.status(404).json({ error: "Notitie niet gevonden." });
    }
    const {
      title,
      body: originalBody,
      visibleToCustomer,
      attachments,
    } = req.body;

    // Check if existing note has an archive_folder_id to preserve it
    const { data: existingNote } = await supabase
      .from("user_notes")
      .select("body")
      .eq("id", noteId)
      .single();
    const existingFolder = existingNote
      ? extractFolderAndAttachmentsFromBody(existingNote.body || "").archive_folder_id
      : null;

    let finalBody = originalBody || "";
    if (attachments !== undefined || existingFolder) {
      finalBody = injectFolderAndAttachmentsIntoBody(
        originalBody || "",
        attachments || [],
        existingFolder,
      );
    }

    const updateData = {
      title: title || "",
      body: finalBody,
      updated_at: new Date().toISOString(),
    };
    if (typeof visibleToCustomer === "boolean") {
      updateData.visible_to_customer = visibleToCustomer;
    }

    let { data: note, error } = await supabase
      .from("user_notes")
      .update(updateData)
      .eq("id", noteId)
      .select()
      .single();
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      delete updateData.visible_to_customer;
      const retryRes = await supabase
        .from("user_notes")
        .update(updateData)
        .eq("id", noteId)
        .select()
        .single();
      note = retryRes.data;
      error = retryRes.error;
    }

    if (error || !note) {
      return res.status(404).json({ error: "Notitie niet gevonden." });
    }

    if (note.visible_to_customer) {
      await supabase
        .from("notifications")
        .insert([
          {
            account_id: note.customer_id,
            kind: "note_updated",
            message: `De notitie "${note.title || "Geen titel"}" is bijgewerkt door uw boekhouder.`,
            read: false,
            created_at: new Date().toISOString(),
          },
        ])
        .catch((e) => console.error("Note update notification error:", e));
    }

    const { attachments: parsedAttachments, archive_folder_id, cleanBody } =
      extractFolderAndAttachmentsFromBody(note.body || "");
    note.attachments = parsedAttachments;
    note.body = cleanBody;
    note.archive_folder_id = archive_folder_id;
    const first = parsedAttachments[0];
    note.file_path = first?.file_path;
    note.file_name = first?.file_name;
    note.file_size = first?.file_size;
    note.mime_type = first?.mime_type;
    res.json({ ok: true, note });
  });

  app.post(
    "/api/dossier/notes/:noteId/move-to-archive",
    requireAuth,
    async (req, res) => {
      const { noteId } = req.params;
      const { folderId } = req.body;
      const user = req.user;
      if (user.role === "customer" || user.role === "organization") {
        return res
          .status(403)
          .json({ error: "Klanten kunnen geen notities verplaatsen." });
      }
      if (!folderId) {
        return res.status(400).json({ error: "Kies een geldige archiefmap." });
      }
      if (!(await canAccessNoteId(user, noteId))) {
        return res.status(404).json({ error: "Notitie niet gevonden." });
      }

      // Fetch note
      const { data: note, error: noteErr } = await supabase
        .from("user_notes")
        .select("*")
        .eq("id", noteId)
        .single();
      if (noteErr || !note) {
        return res.status(404).json({ error: "Notitie niet gevonden." });
      }

      // Verify that folder exists and belongs to the exact same customer
      const { data: folder, error: folderErr } = await supabase
        .from("archive_folders")
        .select("*")
        .eq("id", folderId)
        .single();
      if (folderErr || !folder || folder.customer_id !== note.customer_id) {
        return res
          .status(403)
          .json({ error: "Deze archiefmap hoort niet bij dit klantdossier." });
      }

      // Extract existing attachments and body
      const { attachments, cleanBody } = extractFolderAndAttachmentsFromBody(
        note.body || "",
      );
      const updatedBody = injectFolderAndAttachmentsIntoBody(
        cleanBody,
        attachments,
        folderId,
      );

      // Perform atomic update
      const { data: updatedNote, error: updateErr } = await supabase
        .from("user_notes")
        .update({
          body: updatedBody,
          updated_at: new Date().toISOString(),
        })
        .eq("id", noteId)
        .select()
        .single();

      if (updateErr || !updatedNote) {
        return res
          .status(500)
          .json({ error: updateErr?.message || "Fout bij verplaatsen van notitie." });
      }

      const { attachments: finalAtts, archive_folder_id, cleanBody: finalBody } =
        extractFolderAndAttachmentsFromBody(updatedNote.body || "");
      updatedNote.attachments = finalAtts;
      updatedNote.body = finalBody;
      updatedNote.archive_folder_id = archive_folder_id;
      const first = finalAtts[0];
      updatedNote.file_path = first?.file_path;
      updatedNote.file_name = first?.file_name;
      updatedNote.file_size = first?.file_size;
      updatedNote.mime_type = first?.mime_type;

      res.json({ ok: true, note: updatedNote });
    },
  );

  app.post(
    "/api/dossier/notes/:noteId/restore-to-notes",
    requireAuth,
    async (req, res) => {
      const { noteId } = req.params;
      const user = req.user;
      if (user.role === "customer" || user.role === "organization") {
        return res
          .status(403)
          .json({ error: "Klanten kunnen geen notities terugzetten." });
      }
      if (!(await canAccessNoteId(user, noteId))) {
        return res.status(404).json({ error: "Notitie niet gevonden." });
      }

      // Fetch note
      const { data: note, error: noteErr } = await supabase
        .from("user_notes")
        .select("*")
        .eq("id", noteId)
        .single();
      if (noteErr || !note) {
        return res.status(404).json({ error: "Notitie niet gevonden." });
      }

      // Extract existing attachments and body
      const { attachments, cleanBody } = extractFolderAndAttachmentsFromBody(
        note.body || "",
      );
      // Remove folder id (set null)
      const updatedBody = injectFolderAndAttachmentsIntoBody(
        cleanBody,
        attachments,
        null,
      );

      // Perform atomic update
      const { data: updatedNote, error: updateErr } = await supabase
        .from("user_notes")
        .update({
          body: updatedBody,
          updated_at: new Date().toISOString(),
        })
        .eq("id", noteId)
        .select()
        .single();

      if (updateErr || !updatedNote) {
        return res
          .status(500)
          .json({ error: updateErr?.message || "Fout bij terugzetten van notitie." });
      }

      const { attachments: finalAtts, archive_folder_id, cleanBody: finalBody } =
        extractFolderAndAttachmentsFromBody(updatedNote.body || "");
      updatedNote.attachments = finalAtts;
      updatedNote.body = finalBody;
      updatedNote.archive_folder_id = archive_folder_id;
      const first = finalAtts[0];
      updatedNote.file_path = first?.file_path;
      updatedNote.file_name = first?.file_name;
      updatedNote.file_size = first?.file_size;
      updatedNote.mime_type = first?.mime_type;

      res.json({ ok: true, note: updatedNote });
    },
  );

  app.delete("/api/dossier/notes/:noteId", requireAuth, async (req, res) => {
    const { noteId } = req.params;
    const user = req.user;
    if (user.role === "customer" || user.role === "organization") {
      return res
        .status(403)
        .json({ error: "Klanten kunnen geen notities verwijderen." });
    }
    if (!(await canAccessNoteId(user, noteId))) {
      return res.status(404).json({ error: "Notitie niet gevonden." });
    }
    const { error } = await supabase
      .from("user_notes")
      .delete()
      .eq("id", noteId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
  });
  app.post(
    "/api/dossier/:customerId/notes/upload",
    requireAuth,
    upload.single("file"),
    async (req, res) => {
      const { customerId } = req.params;
      const user = req.user;
      if (!(await canAccessCustomer(user, customerId))) {
        return res.status(404).json({ error: "Dossier niet gevonden." });
      }
      if (user.role === "customer" || user.role === "organization") {
        return res
          .status(403)
          .json({ error: "Klanten kunnen hier geen bestanden uploaden." });
      }
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "Geen bestand meegeleverd." });
      }
      const ext = path.extname(file.originalname);
      const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      const filePath = `notes/${customerId}/${fileName}`;
      const { data: storageData, error: storageError } = await supabase.storage
        .from("customer-files")
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });
      if (storageError) {
        console.error("Storage error:", storageError);
        return res.status(500).json({ error: storageError.message });
      }
      res.json({
        filePath,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
      });
    },
  );
  app.get(
    "/api/dossier/notes/attachment/view",
    requireAuth,
    async (req, res) => {
      const { path: filePath } = req.query;
      if (!filePath)
        return res.status(400).json({ error: "Pad is verplicht." });
      const user = req.user;
      if (!(await canAccessFilePath(user, filePath))) {
        return res.status(404).json({ error: "Bijlage niet gevonden." });
      }
      const { data: signedUrl, error: signedUrlError } = await supabase.storage
        .from("customer-files")
        .createSignedUrl(filePath, 3600);
      if (signedUrlError) {
        return res.status(500).json({ error: signedUrlError.message });
      }
      res.json({ url: signedUrl.signedUrl });
    },
  );
  app.post(
    "/api/customer/upload",
    requireAuth,
    upload.array("files"),
    async (req, res) => {
      const user = req.user;
      if (user.role !== "customer") {
        return res
          .status(403)
          .json({ error: "Alleen klanten kunnen bestanden direct uploaden." });
      }
      const files = req.files;
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "Geen bestanden meegeleverd." });
      }
      let maxUploadBytes = 52428800;
      let retentionYears = 7;
      try {
        const { data: setRec } = await supabase
          .from("settings")
          .select("max_upload_bytes, retention_years")
          .eq("id", 1)
          .single();
        if (setRec?.max_upload_bytes) maxUploadBytes = setRec.max_upload_bytes;
        if (setRec?.retention_years) retentionYears = setRec.retention_years;
      } catch (e) {
        console.error("Error fetching settings for file upload:", e);
      }
      let totalBatchBytes = 0;
      for (const file of files) {
        totalBatchBytes += file.size;
        if (file.size > maxUploadBytes) {
          return res
            .status(400)
            .json({
              error: `Bestand "${file.originalname}" is groter dan de toegestane limiet van ${Math.round(maxUploadBytes / 1024 / 1024)} MB.`,
            });
        }
      }
      if (totalBatchBytes > maxUploadBytes) {
        return res
          .status(400)
          .json({
            error: `Totale uploadgrootte mag maximaal ${Math.round(maxUploadBytes / 1024 / 1024)} MB bedragen.`,
          });
      }
      const { category, quarter, year } = req.body;
      const cat = category || "proof";
      const qtr = normalizeQuarter(quarter) || "Q1";
      const yr = year ? parseInt(year, 10) : new Date().getFullYear();
      const retentionExpiresAt = new Date();
      retentionExpiresAt.setFullYear(
        retentionExpiresAt.getFullYear() + retentionYears,
      );
      const uploaded = [];
      for (const file of files) {
        const ext = path.extname(file.originalname);
        const fileId =
          "file_" + Date.now() + "_" + Math.round(Math.random() * 1e9);
        const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
        const filePath = `${user.id}/${fileName}`;
        let dbDataId = fileId;
        const { error: storageError } = await supabase.storage
          .from("customer-files")
          .upload(filePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false,
          });
        if (storageError) {
          console.error("Storage upload error:", storageError);
          return res
            .status(500)
            .json({
              error: `Opslaan in storage mislukt: ${storageError.message}`,
            });
        }
        try {
          const { data: dbData, error: dbError } = await supabase
            .from("files")
            .insert([
              {
                customer_id: user.id,
                user_id: user.id,
                original_name: file.originalname,
                mime_type: file.mimetype,
                size_bytes: file.size,
                storage_path: filePath,
                category: cat,
                quarter: qtr,
                year: yr,
                expires_at: retentionExpiresAt.toISOString(),
              },
            ])
            .select()
            .single();
          if (dbError) {
            console.error("CUSTOMER FILE INSERT FAILED", {
              message: dbError.message,
              code: dbError.code,
              details: dbError.details,
              hint: dbError.hint,
            });
            try {
              await supabase.storage.from("customer-files").remove([filePath]);
              console.log(
                `Cleaned up storage orphan for failed file insert: ${filePath}`,
              );
            } catch (storageCleanErr) {
              console.error(
                "Failed to clean up storage orphan:",
                storageCleanErr,
              );
            }
            return res
              .status(500)
              .json({
                error:
                  "Opslaan van het bestand is mislukt. Probeer het opnieuw.",
              });
          }
          if (dbData) {
            dbDataId = dbData.id;
            try {
              await supabase
                .from("file_metadata")
                .insert([
                  {
                    file_id: dbData.id,
                    category: cat,
                    quarter: qtr,
                    year: yr,
                    updated_at: new Date().toISOString(),
                  },
                ]);
            } catch (metadataErr) {
              console.error(
                "Optional file_metadata insert check (ignoring):",
                metadataErr,
              );
            }
          }
        } catch (dbErr) {
          console.error("Supabase insert file error:", dbErr);
          try {
            await supabase.storage.from("customer-files").remove([filePath]);
            console.log(
              `Cleaned up storage orphan for caught file insert error: ${filePath}`,
            );
          } catch (storageCleanErr) {
            console.error(
              "Failed to clean up storage orphan:",
              storageCleanErr,
            );
          }
          return res
            .status(500)
            .json({
              error: "Opslaan van het bestand is mislukt. Probeer het opnieuw.",
            });
        }
        uploaded.push({
          id: dbDataId,
          name: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
          category: cat,
          quarter: qtr,
          year: yr,
        });
      }
      if (uploaded.length > 0) {
        try {
          const { data: customerAcc } = await supabase
            .from("accounts")
            .select("owner_id, name, number")
            .eq("id", user.id)
            .single();
          const ownerId = customerAcc?.owner_id || user.id;
          await supabase
            .from("admin_status")
            .upsert(
              {
                user_id: ownerId,
                customer_id: user.id,
                year: yr,
                quarter: qtr,
                status: "in_progress",
                updated_at: new Date().toISOString(),
              },
              { onConflict: "customer_id,quarter,year" },
            );
          const custName = customerAcc?.name || user.name || "Klant";
          const notifMsg = `Klant ${custName} heeft ${uploaded.length} bestand(en) ge\xFCpload voor ${qtr} ${yr}.`;
          await supabase
            .from("notifications")
            .insert([
              {
                account_id: ownerId,
                kind: "file_uploaded",
                message: notifMsg,
                read: false,
                created_at: new Date().toISOString(),
              },
            ]);
        } catch (err) {
          console.error(
            "Error auto-updating status and notification on upload:",
            err,
          );
        }
      }
      res.json({ count: uploaded.length, uploaded });
    },
  );
  app.get("/api/customer/files", requireAuth, async (req, res) => {
    const user = req.user;
    if (user.role !== "customer") {
      return res
        .status(403)
        .json({ error: "Alleen klanten kunnen deze route aanroepen." });
    }
    const { data, error } = await supabase
      .from("files")
      .select("*, file_metadata (category, quarter, year)")
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      return res.json({ files: mergeFilesWithStore([], user.id) });
    }
    res.json({ files: mergeFilesWithStore(data, user.id) });
  });
  app.get("/api/dossier/:customerId/uploads", requireAuth, async (req, res) => {
    const user = req.user;
    const { customerId } = req.params;
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }
    const { data, error } = await supabase
      .from("files")
      .select("*, file_metadata (category, quarter, year)")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });
    if (error) {
      return res.json({ files: mergeFilesWithStore([], customerId) });
    }
    res.json({ files: mergeFilesWithStore(data, customerId) });
  });
  app.get("/api/user/files/:fileId/download", requireAuth, async (req, res) => {
    const { fileId } = req.params;
    const user = req.user;
    if (!(await canAccessFileId(user, fileId))) {
      return res.status(404).json({ error: "Bestand niet gevonden." });
    }
    const { data: fileRecord, error: fileError } = await supabase
      .from("files")
      .select("customer_id, original_name, mime_type, storage_path")
      .eq("id", fileId)
      .single();
    if (fileError || !fileRecord) {
      return res.status(404).json({ error: "Bestand niet gevonden." });
    }
    const { data: signedUrl, error: signedUrlError } = await supabase.storage
      .from("customer-files")
      .createSignedUrl(fileRecord.storage_path, 60);
    if (signedUrlError) {
      return res.status(500).json({ error: "Kon bestand niet downloaden." });
    }
    res.json({
      url: signedUrl.signedUrl,
      mimeType: fileRecord.mime_type,
      originalName: fileRecord.original_name,
    });
  });
  app.get("/api/user/files/:fileId/view", requireAuth, async (req, res) => {
    const { fileId } = req.params;
    const user = req.user;
    if (!(await canAccessFileId(user, fileId))) {
      return res.status(404).json({ error: "Bestand niet gevonden." });
    }
    const { data: fileRecord, error: fileError } = await supabase
      .from("files")
      .select("customer_id, original_name, mime_type, storage_path")
      .eq("id", fileId)
      .single();
    if (fileError || !fileRecord)
      return res.status(404).json({ error: "Bestand niet gevonden." });
    const { data: signedUrl, error: signedUrlError } = await supabase.storage
      .from("customer-files")
      .createSignedUrl(fileRecord.storage_path, 60);
    if (signedUrlError)
      return res.status(500).json({ error: "Kon bestand niet openen." });
    res.json({
      url: signedUrl.signedUrl,
      mimeType: fileRecord.mime_type,
      originalName: fileRecord.original_name,
    });
  });
  app.post("/api/user/files/:fileId/delete", requireAuth, async (req, res) => {
    const { fileId } = req.params;
    const user = req.user;
    if (!(await canAccessFileId(user, fileId))) {
      return res.status(404).json({ error: "Bestand niet gevonden." });
    }
    const { data: fileRecord, error: fileError } = await supabase
      .from("files")
      .select("customer_id, storage_path")
      .eq("id", fileId)
      .single();
    if (fileError || !fileRecord)
      return res.status(404).json({ error: "Bestand niet gevonden." });
    await supabase.storage
      .from("customer-files")
      .remove([fileRecord.storage_path]);
    await supabase.from("files").delete().eq("id", fileId);
    res.json({ ok: true });
  });
  app.put(
    "/api/dossier/files/:fileId/metadata",
    requireAuth,
    async (req, res) => {
      const { fileId } = req.params;
      const user = req.user;
      if (user.role === "customer" || user.role === "organization") {
        return res
          .status(403)
          .json({ error: "Klanten kunnen geen metadata bijwerken." });
      }
      if (!(await canAccessFileId(user, fileId))) {
        return res.status(404).json({ error: "Bestand niet gevonden." });
      }
      const { category, quarter, year } = req.body;
      const { error } = await supabase
        .from("file_metadata")
        .upsert(
          {
            file_id: fileId,
            category,
            quarter,
            year: year ? parseInt(year, 10) : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "file_id" },
        );
      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true });
    },
  );
  app.get("/api/user/files", requireAuth, async (req, res) => {
    const user = req.user;
    if (user.role === "customer" || user.role === "organization") {
      return res
        .status(403)
        .json({ error: "Klanten hebben geen toegang tot deze route." });
    }
    const allowedIds = await getAccessibleCustomerIds(user);
    if (allowedIds.length === 0) {
      return res.json({ files: [] });
    }
    const { data, error } = await supabase
      .from("files")
      .select(
        "*, accounts!files_customer_id_fkey(name, number), file_metadata (category, quarter, year)",
      )
      .in("customer_id", allowedIds)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      return res.json({ files: [] });
    }
    const merged = mergeFilesWithStore(data);
    const filteredMerged = merged.filter((f) =>
      allowedIds.includes(f.customer_id),
    );
    res.json({ files: filteredMerged });
  });
  app.get(
    "/api/user/customers/:customerId/files",
    requireAuth,
    async (req, res) => {
      const { customerId } = req.params;
      const user = req.user;
      if (user.role === "customer" || user.role === "organization") {
        return res
          .status(403)
          .json({ error: "Klanten hebben geen toegang tot deze route." });
      }
      if (!(await canAccessCustomer(user, customerId))) {
        return res.status(404).json({ error: "Klant niet gevonden." });
      }
      const { data: customer, error: customerError } = await supabase
        .from("accounts")
        .select("id, number, name")
        .eq("id", customerId)
        .single();
      if (customerError || !customer)
        return res.status(404).json({ error: "Klant niet gevonden." });
      const { data: files, error: filesError } = await supabase
        .from("files")
        .select("*, file_metadata (category, quarter, year)")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      if (filesError) {
        return res.json({
          customer,
          files: mergeFilesWithStore([], customerId),
        });
      }
      res.json({ customer, files: mergeFilesWithStore(files, customerId) });
    },
  );
  app.get("/api/dossier/:customerId/archive", requireAuth, async (req, res) => {
    const { customerId } = req.params;
    const { folderId } = req.query;
    const user = req.user;
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Archief niet gevonden." });
    }
    let foldersQuery = supabase
      .from("archive_folders")
      .select("*")
      .eq("customer_id", customerId);
    let filesQuery = supabase
      .from("archive_files")
      .select("*")
      .eq("customer_id", customerId);
    if (folderId) {
      foldersQuery = foldersQuery.eq("parent_id", folderId);
      filesQuery = filesQuery.eq("folder_id", folderId);
    } else {
      foldersQuery = foldersQuery.is("parent_id", null);
      filesQuery = filesQuery.is("folder_id", null);
    }
    const [foldersRes, filesRes, notesRes] = await Promise.all([
      foldersQuery,
      filesQuery,
      supabase
        .from("user_notes")
        .select("*")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false }),
    ]);
    const sbFolders = foldersRes.data || [];
    const sbFiles = filesRes.data || [];
    const allNotes = (notesRes.data || []).map((n) => {
      const { attachments, archive_folder_id, cleanBody } =
        extractFolderAndAttachmentsFromBody(n.body || "");
      const first = attachments[0];
      return {
        ...n,
        body: cleanBody,
        archive_folder_id,
        attachments,
        file_path: first?.file_path,
        file_name: first?.file_name,
        file_size: first?.file_size,
        mime_type: first?.mime_type,
      };
    });

    const folderNotes = folderId
      ? allNotes.filter((n) => n.archive_folder_id === folderId)
      : [];

    res.json({ folders: sbFolders, files: sbFiles, notes: folderNotes });
  });

  app.get(
    "/api/dossier/:customerId/archive/all-folders",
    requireAuth,
    async (req, res) => {
      const { customerId } = req.params;
      const user = req.user;
      if (!(await canAccessCustomer(user, customerId))) {
        return res.status(404).json({ error: "Archief niet gevonden." });
      }
      const { data, error } = await supabase
        .from("archive_folders")
        .select("*")
        .eq("customer_id", customerId)
        .order("name", { ascending: true });
      if (error) return res.status(500).json({ error: error.message });
      res.json({ folders: data || [] });
    },
  );

  app.get("/api/customer/archive", requireAuth, async (req, res) => {
    const { folderId } = req.query;
    const user = req.user;
    let foldersQuery = supabase
      .from("archive_folders")
      .select("*")
      .eq("customer_id", user.id);
    let filesQuery = supabase
      .from("archive_files")
      .select("*")
      .eq("customer_id", user.id);
    if (folderId) {
      foldersQuery = foldersQuery.eq("parent_id", folderId);
      filesQuery = filesQuery.eq("folder_id", folderId);
    } else {
      foldersQuery = foldersQuery.is("parent_id", null);
      filesQuery = filesQuery.is("folder_id", null);
    }
    const [foldersRes, filesRes, notesRes] = await Promise.all([
      foldersQuery,
      filesQuery,
      supabase
        .from("user_notes")
        .select("*")
        .eq("customer_id", user.id)
        .eq("visible_to_customer", true)
        .order("created_at", { ascending: false }),
    ]);
    const sbFolders = foldersRes.data || [];
    const sbFiles = filesRes.data || [];
    const allNotes = (notesRes.data || []).map((n) => {
      const { attachments, archive_folder_id, cleanBody } =
        extractFolderAndAttachmentsFromBody(n.body || "");
      const first = attachments[0];
      return {
        ...n,
        body: cleanBody,
        archive_folder_id,
        attachments,
        file_path: first?.file_path,
        file_name: first?.file_name,
        file_size: first?.file_size,
        mime_type: first?.mime_type,
      };
    });

    const folderNotes = folderId
      ? allNotes.filter((n) => n.archive_folder_id === folderId)
      : [];

    res.json({ folders: sbFolders, files: sbFiles, notes: folderNotes });
  });
  app.post(
    "/api/dossier/:customerId/archive/folders",
    requireAuth,
    async (req, res) => {
      const { customerId } = req.params;
      const { name, parentId } = req.body;
      const user = req.user;
      if (user.role === "customer")
        return res
          .status(403)
          .json({ error: "Klanten kunnen geen mappen aanmaken." });
      if (!name || !name.trim())
        return res.status(400).json({ error: "Mapnaam is verplicht." });
      if (!(await canAccessCustomer(user, customerId))) {
        return res.status(404).json({ error: "Archief niet gevonden." });
      }
      const userIdVal = user.id || customerId;
      try {
        const { data, error } = await supabase
          .from("archive_folders")
          .insert({
            customer_id: customerId,
            user_id: userIdVal,
            name: name.trim(),
            parent_id: parentId || null,
          })
          .select()
          .single();
        if (error || !data) {
          return res
            .status(500)
            .json({ error: error?.message || "Fout bij aanmaken map." });
        }
        res.json({ folder: data });
      } catch (err) {
        res
          .status(500)
          .json({ error: err?.message || "Fout bij aanmaken map." });
      }
    },
  );
  app.post(
    "/api/dossier/archive/folders/:folderId/rename",
    requireAuth,
    async (req, res) => {
      const { folderId } = req.params;
      const { name } = req.body;
      const user = req.user;
      if (user.role === "customer")
        return res
          .status(403)
          .json({ error: "Klanten mogen mappen niet hernoemen." });
      if (!name || !name.trim())
        return res.status(400).json({ error: "Mapnaam is verplicht." });
      if (!(await canAccessFolderId(user, folderId))) {
        return res.status(404).json({ error: "Map niet gevonden." });
      }
      await supabase
        .from("archive_folders")
        .update({ name: name.trim() })
        .eq("id", folderId);
      res.json({ ok: true });
    },
  );
  app.post(
    "/api/dossier/archive/folders/:folderId/delete",
    requireAuth,
    async (req, res) => {
      const { folderId } = req.params;
      const user = req.user;
      if (user.role === "customer")
        return res
          .status(403)
          .json({ error: "Klanten mogen mappen niet verwijderen." });
      if (!(await canAccessFolderId(user, folderId))) {
        return res.status(404).json({ error: "Map niet gevonden." });
      }
      async function deleteFolderRecursive(fId) {
        const { data: filesInFolder } = await supabase
          .from("archive_files")
          .select("id, storage_path")
          .eq("folder_id", fId);
        if (filesInFolder && filesInFolder.length > 0) {
          for (const fileRec of filesInFolder) {
            if (fileRec.storage_path) {
              await supabase.storage
                .from("archive-files")
                .remove([fileRec.storage_path])
                .catch(() => {});
            }
            await supabase.from("archive_files").delete().eq("id", fileRec.id);
          }
        }
        const { data: subfolders } = await supabase
          .from("archive_folders")
          .select("id")
          .eq("parent_id", fId);
        if (subfolders && subfolders.length > 0) {
          for (const sub of subfolders) {
            await deleteFolderRecursive(sub.id);
          }
        }

        // Detach any notes linked to this folder
        const { data: notesInFolder } = await supabase
          .from("user_notes")
          .select("id, body")
          .ilike("body", `%[archive_folder:${fId}]%`);
        if (notesInFolder && notesInFolder.length > 0) {
          for (const n of notesInFolder) {
            const { attachments, cleanBody } = extractFolderAndAttachmentsFromBody(n.body || "");
            const restoredBody = injectFolderAndAttachmentsIntoBody(cleanBody, attachments, null);
            await supabase.from("user_notes").update({ body: restoredBody }).eq("id", n.id);
          }
        }

        await supabase.from("archive_folders").delete().eq("id", fId);
      }
      __name(deleteFolderRecursive, "deleteFolderRecursive");
      try {
        await deleteFolderRecursive(folderId);
        res.json({ ok: true });
      } catch (err) {
        console.error("Error deleting folder recursively:", err);
        res.status(500).json({ error: "Fout bij verwijderen van map." });
      }
    },
  );
  app.post(
    "/api/dossier/:customerId/archive/files",
    requireAuth,
    upload.array("file"),
    async (req, res) => {
      const { customerId } = req.params;
      const { folderId } = req.body;
      const user = req.user;
      if (user.role === "customer")
        return res
          .status(403)
          .json({ error: "Klanten kunnen geen archiefbestanden uploaden." });
      if (!(await canAccessCustomer(user, customerId))) {
        return res.status(404).json({ error: "Archief niet gevonden." });
      }
      const files = req.files;
      if (!files || files.length === 0)
        return res.status(400).json({ error: "Geen bestand meegeleverd." });
      const file = files[0];
      const ext = path.extname(file.originalname);
      const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      const filePath = `archive/${customerId}/${fileName}`;
      const userIdVal = user.id || customerId;
      const { error: storageError } = await supabase.storage
        .from("archive-files")
        .upload(filePath, file.buffer, { contentType: file.mimetype });
      if (storageError) {
        console.warn("Storage upload notice:", storageError.message);
      }
      try {
        const { data: dbData, error: dbError } = await supabase
          .from("archive_files")
          .insert({
            customer_id: customerId,
            user_id: userIdVal,
            folder_id: folderId || null,
            name: file.originalname,
            mime_type: file.mimetype,
            size_bytes: file.size,
            storage_path: filePath,
          })
          .select()
          .single();
        if (dbError || !dbData) {
          return res
            .status(500)
            .json({
              error:
                dbError?.message || "Fout bij opslaan bestand in database.",
            });
        }
        res.json({ file: dbData });
      } catch (err) {
        res
          .status(500)
          .json({
            error: err.message || "Fout bij uploaden van archiefbestand.",
          });
      }
    },
  );
  app.get(
    "/api/dossier/archive/files/:fileId/download",
    requireAuth,
    async (req, res) => {
      const { fileId } = req.params;
      const user = req.user;
      if (!(await canAccessArchiveFileId(user, fileId))) {
        return res.status(404).json({ error: "Bestand niet gevonden." });
      }
      const { data: record } = await supabase
        .from("archive_files")
        .select("*")
        .eq("id", fileId)
        .single();
      if (!record)
        return res.status(404).json({ error: "Bestand niet gevonden." });
      const { data: signedUrl, error: signedUrlError } = await supabase.storage
        .from("archive-files")
        .createSignedUrl(record.storage_path, 60);
      if (signedUrlError || !signedUrl?.signedUrl) {
        return res.json({ url: "#", name: record.name });
      }
      res.json({ url: signedUrl.signedUrl, name: record.name });
    },
  );
  app.get(
    "/api/customer/archive/files/:fileId/download",
    requireAuth,
    async (req, res) => {
      const { fileId } = req.params;
      const user = req.user;
      if (!(await canAccessArchiveFileId(user, fileId))) {
        return res.status(404).json({ error: "Bestand niet gevonden." });
      }
      const { data: record } = await supabase
        .from("archive_files")
        .select("*")
        .eq("id", fileId)
        .single();
      if (!record)
        return res.status(404).json({ error: "Bestand niet gevonden." });
      const { data: signedUrl, error: signedUrlError } = await supabase.storage
        .from("archive-files")
        .createSignedUrl(record.storage_path, 60);
      if (signedUrlError || !signedUrl?.signedUrl) {
        return res.json({ url: "#", name: record.name });
      }
      res.json({ url: signedUrl.signedUrl, name: record.name });
    },
  );
  app.post(
    "/api/dossier/archive/files/:fileId/rename",
    requireAuth,
    async (req, res) => {
      const { fileId } = req.params;
      const { name } = req.body;
      const user = req.user;
      if (user.role === "customer")
        return res
          .status(403)
          .json({ error: "Klanten mogen archiefbestanden niet hernoemen." });
      if (!name || !name.trim())
        return res.status(400).json({ error: "Bestandsnaam is verplicht." });
      if (!(await canAccessArchiveFileId(user, fileId))) {
        return res.status(404).json({ error: "Bestand niet gevonden." });
      }
      await supabase
        .from("archive_files")
        .update({ name: name.trim() })
        .eq("id", fileId);
      res.json({ ok: true });
    },
  );
  app.post(
    "/api/dossier/archive/files/:fileId/delete",
    requireAuth,
    async (req, res) => {
      const { fileId } = req.params;
      const user = req.user;
      if (user.role === "customer")
        return res
          .status(403)
          .json({ error: "Klanten mogen archiefbestanden niet verwijderen." });
      if (!(await canAccessArchiveFileId(user, fileId))) {
        return res.status(404).json({ error: "Bestand niet gevonden." });
      }
      const { data: fileRecord } = await supabase
        .from("archive_files")
        .select("storage_path")
        .eq("id", fileId)
        .single();
      if (fileRecord)
        await supabase.storage
          .from("archive-files")
          .remove([fileRecord.storage_path]);
      await supabase.from("archive_files").delete().eq("id", fileId);
      res.json({ ok: true });
    },
  );
  app.get(
    "/api/dossier/archive/:scope/:scopeId/notes",
    requireAuth,
    async (req, res) => {
      const { scope, scopeId } = req.params;
      const user = req.user;
      if (user.role === "customer")
        return res
          .status(403)
          .json({ error: "Klanten hebben geen toegang tot archiefnotities." });
      if (scope === "folder") {
        if (!(await canAccessFolderId(user, scopeId))) {
          return res.status(404).json({ error: "Scope niet gevonden." });
        }
      } else if (scope === "file") {
        if (!(await canAccessArchiveFileId(user, scopeId))) {
          return res.status(404).json({ error: "Scope niet gevonden." });
        }
      } else {
        return res.status(400).json({ error: "Ongeldige scope." });
      }
      let query = supabase.from("archive_notes").select("*");
      if (scope === "folder") {
        query = query.eq("folder_id", scopeId);
      } else {
        query = query.eq("file_id", scopeId);
      }
      const { data, error } = await query.order("created_at", {
        ascending: false,
      });
      if (error) return res.status(500).json({ error: error.message });
      res.json({ notes: data || [] });
    },
  );
  app.post(
    "/api/dossier/archive/:scope/:scopeId/notes",
    requireAuth,
    async (req, res) => {
      const { scope, scopeId } = req.params;
      const { body } = req.body;
      const user = req.user;
      if (user.role === "customer")
        return res
          .status(403)
          .json({ error: "Klanten kunnen geen archiefnotities maken." });
      let customerId = null;
      if (scope === "folder") {
        if (!(await canAccessFolderId(user, scopeId))) {
          return res.status(404).json({ error: "Scope niet gevonden." });
        }
        const { data: f } = await supabase
          .from("archive_folders")
          .select("customer_id")
          .eq("id", scopeId)
          .single();
        customerId = f?.customer_id || null;
      } else if (scope === "file") {
        if (!(await canAccessArchiveFileId(user, scopeId))) {
          return res.status(404).json({ error: "Scope niet gevonden." });
        }
        const { data: f } = await supabase
          .from("archive_files")
          .select("customer_id")
          .eq("id", scopeId)
          .single();
        customerId = f?.customer_id || null;
      } else {
        return res.status(400).json({ error: "Ongeldige scope." });
      }
      const insertObj = { customer_id: customerId, user_id: user.id, body };
      if (scope === "folder") {
        insertObj.folder_id = scopeId;
      } else {
        insertObj.file_id = scopeId;
      }
      const { data, error } = await supabase
        .from("archive_notes")
        .insert(insertObj)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      res.json({ note: data });
    },
  );
  app.delete(
    "/api/dossier/archive/notes/:noteId",
    requireAuth,
    async (req, res) => {
      const { noteId } = req.params;
      const user = req.user;
      if (user.role === "customer")
        return res
          .status(403)
          .json({ error: "Klanten mogen archiefnotities niet verwijderen." });
      const { data: note } = await supabase
        .from("archive_notes")
        .select("folder_id, file_id")
        .eq("id", noteId)
        .single();
      if (!note)
        return res.status(404).json({ error: "Notitie niet gevonden." });
      if (note.folder_id) {
        if (!(await canAccessFolderId(user, note.folder_id))) {
          return res.status(404).json({ error: "Notitie niet gevonden." });
        }
      } else if (note.file_id) {
        if (!(await canAccessArchiveFileId(user, note.file_id))) {
          return res.status(404).json({ error: "Notitie niet gevonden." });
        }
      }
      const { error } = await supabase
        .from("archive_notes")
        .delete()
        .eq("id", noteId);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true });
    },
  );
  app.post(
    "/api/dossier/:customerId/communications/upload",
    requireAuth,
    upload.single("file"),
    async (req, res) => {
      const { customerId } = req.params;
      const user = req.user;
      if (!(await canAccessCustomer(user, customerId))) {
        return res.status(404).json({ error: "Dossier niet gevonden." });
      }
      if (user.role === "customer" || user.role === "organization") {
        return res
          .status(403)
          .json({ error: "Klanten kunnen hier geen bestanden uploaden." });
      }
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "Geen bestand meegeleverd." });
      }
      const ext = path.extname(file.originalname);
      const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      const filePath = `communications/${customerId}/${fileName}`;
      const { data: storageData, error: storageError } = await supabase.storage
        .from("customer-files")
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });
      if (storageError) {
        console.error("Communication attachment upload error:", storageError);
        return res.status(500).json({ error: storageError.message });
      }
      res.json({
        filePath,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
      });
    },
  );

  app.get(
    "/api/dossier/communications/attachment/view",
    requireAuth,
    async (req, res) => {
      const { path: filePath } = req.query;
      if (!filePath || typeof filePath !== "string")
        return res.status(400).json({ error: "Pad is verplicht." });
      const user = req.user;
      if (!(await canAccessFilePath(user, filePath))) {
        return res.status(404).json({ error: "Bijlage niet gevonden." });
      }
      const { data: signedUrl, error: signedUrlError } = await supabase.storage
        .from("customer-files")
        .createSignedUrl(filePath, 3600);
      if (signedUrlError) {
        return res.status(500).json({ error: signedUrlError.message });
      }
      res.json({ url: signedUrl.signedUrl });
    },
  );

  app.get(
    "/api/dossier/:customerId/communications",
    requireAuth,
    async (req, res) => {
      const { customerId } = req.params;
      const user = req.user;
      if (!(await canAccessCustomer(user, customerId))) {
        return res.status(404).json({ error: "Dossier niet gevonden." });
      }
      const { data, error = null } = await supabase
        .from("communications")
        .select("*")
        .eq("customer_id", customerId)
        .order("sent_at", { ascending: false });
      if (error) return res.status(500).json({ error: error.message });

      const enrichedComms = (data || []).map((c) => {
        const { attachments, cleanBody } = extractAttachmentsFromBody(c.body || "");
        return {
          ...c,
          body: cleanBody,
          attachments: attachments || [],
        };
      });

      res.json({ communications: enrichedComms });
    },
  );
  app.post(
    "/api/dossier/:customerId/communications",
    requireAuth,
    async (req, res) => {
      const { customerId } = req.params;
      const { id, draftId, subject, body, quarter, year, status, attachments } = req.body;
      const targetId = id || draftId;
      const user = req.user;
      if (!(await canAccessCustomer(user, customerId))) {
        return res.status(404).json({ error: "Dossier niet gevonden." });
      }
      if (user.role === "customer")
        return res
          .status(403)
          .json({ error: "Klanten kunnen geen dossier-communicatie loggen." });

      if (!subject || !subject.trim()) {
        return res.status(400).json({ error: "Onderwerp is verplicht." });
      }
      if (!body || !body.trim()) {
        return res.status(400).json({ error: "Bericht is verplicht." });
      }

      const isDraft = status === "draft";
      let recipientEmail = "";

      if (!isDraft) {
        // 1. Fetch customer details & profile from server-side database records
        const customerProfile = await getProfileWithFields(customerId);
        if (!customerProfile) {
          return res.status(404).json({ error: "Klantprofiel niet gevonden." });
        }

        recipientEmail = (customerProfile.email || "").trim();

        if (!recipientEmail || !recipientEmail.includes("@")) {
          return res.status(400).json({
            error: "De klant heeft geen geldig e-mailadres ingesteld in SafeVault. Vul eerst een e-mailadres in of sla het bericht op als concept.",
          });
        }

        // 2. Check if email service is configured
        const emailStatus = isEmailConfigured();
        if (!emailStatus.configured) {
          return res.status(503).json({
            error: `E-mailservice is momenteel niet geconfigureerd (${emailStatus.reason}).`,
          });
        }

        // 3. Download attachment buffers from storage if any
        const emailAttachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
        if (Array.isArray(attachments) && attachments.length > 0) {
          for (const att of attachments) {
            try {
              const p = att.file_path || att.filePath;
              if (p) {
                const { data: fileBlob, error: downloadErr } = await supabase.storage
                  .from("customer-files")
                  .download(p);
                if (fileBlob) {
                  const buffer = Buffer.from(await fileBlob.arrayBuffer());
                  emailAttachments.push({
                    filename: att.file_name || att.fileName || "afbeelding.jpg",
                    content: buffer,
                    contentType: att.mime_type || att.mimeType || "image/jpeg",
                  });
                } else if (downloadErr) {
                  console.warn("Storage download warning for email attachment:", downloadErr);
                }
              }
            } catch (dlErr) {
              console.error("Error downloading attachment for email:", dlErr);
            }
          }
        }

        // 4. Dispatch real email via sendReminderEmail
        const senderName = user.name || "SafeVault Boekhouder";
        const sendResult = await sendReminderEmail({
          to: recipientEmail,
          subject: subject.trim(),
          body: body.trim(),
          fromName: senderName,
          attachments: emailAttachments,
        });

        if (!sendResult.success) {
          return res.status(502).json({
            error: sendResult.error || "Het verzenden van de e-mail via de e-mailservice is mislukt. Probeer het later opnieuw.",
          });
        }
      }

      // 5. Inject attachments metadata into communication body
      const finalBody = injectAttachmentsIntoBody(body.trim(), attachments || []);

      // 6. Log or update communication in database
      const recipientName = isDraft ? "Concept" : (recipientEmail || "Klant");
      const commPayload: Record<string, any> = {
        subject: subject.trim(),
        body: finalBody,
        quarter: quarter || null,
        year: year ? parseInt(year, 10) : null,
        recipient: recipientName,
        status: isDraft ? "draft" : "sent",
      };

      if (!isDraft) {
        commPayload.sent_at = new Date().toISOString();
      }

      let data: any = null;
      let error: any = null;

      if (targetId) {
        const updateRes = await supabase
          .from("communications")
          .update(commPayload)
          .eq("id", targetId)
          .eq("customer_id", customerId)
          .select()
          .single();
        data = updateRes.data;
        error = updateRes.error;
      }

      if (!data) {
        const insertRes = await supabase
          .from("communications")
          .insert({
            customer_id: customerId,
            user_id: user.id,
            ...commPayload,
          })
          .select()
          .single();
        data = insertRes.data;
        error = insertRes.error;
      }

      if (error) return res.status(500).json({ error: error.message });

      // 7. In-app notification for the customer if sent
      if (!isDraft) {
        try {
          await supabase.from("notifications").insert([
            {
              account_id: customerId,
              kind: "communication_sent",
              message: `Nieuw bericht ontvangen van uw boekhouder: ${subject.trim()}`,
              read: false,
              created_at: new Date().toISOString(),
            },
          ]);
        } catch (notifErr) {
          console.error("Communication notification error:", notifErr);
        }
      }

      const { attachments: parsedAtts, cleanBody } = extractAttachmentsFromBody(data.body || "");
      res.json({
        ok: true,
        communication: {
          ...data,
          body: cleanBody,
          attachments: parsedAtts,
        },
      });
    },
  );
  app.post(
    "/api/dossier/:customerId/communications/:commId/send",
    requireAuth,
    async (req, res) => {
      const { customerId, commId } = req.params;
      const user = req.user;
      if (!(await canAccessCustomer(user, customerId))) {
        return res.status(404).json({ error: "Dossier niet gevonden." });
      }
      if (user.role === "customer")
        return res
          .status(403)
          .json({ error: "Klanten kunnen geen dossier-communicatie verzenden." });

      const { data: existingComm, error: commErr } = await supabase
        .from("communications")
        .select("*")
        .eq("id", commId)
        .eq("customer_id", customerId)
        .single();

      if (commErr || !existingComm) {
        return res.status(404).json({ error: "Concept niet gevonden." });
      }

      // 1. Fetch customer details & profile from server-side database records
      const customerProfile = await getProfileWithFields(customerId);
      if (!customerProfile) {
        return res.status(404).json({ error: "Klantprofiel niet gevonden." });
      }

      const recipientEmail = (customerProfile.email || "").trim();
      if (!recipientEmail || !recipientEmail.includes("@")) {
        return res.status(400).json({
          error: "De klant heeft geen geldig e-mailadres ingesteld in SafeVault. Vul eerst een e-mailadres in om het concept te kunnen verzenden.",
        });
      }

      // 2. Check if email service is configured
      const emailStatus = isEmailConfigured();
      if (!emailStatus.configured) {
        return res.status(503).json({
          error: `E-mailservice is momenteel niet geconfigureerd (${emailStatus.reason}).`,
        });
      }

      // 3. Extract attachments and clean body
      const { attachments, cleanBody } = extractAttachmentsFromBody(existingComm.body || "");

      // 4. Download attachment buffers from storage if any
      const emailAttachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
      if (Array.isArray(attachments) && attachments.length > 0) {
        for (const att of attachments) {
          try {
            const p = att.file_path || att.filePath;
            if (p) {
              const { data: fileBlob, error: downloadErr } = await supabase.storage
                .from("customer-files")
                .download(p);
              if (fileBlob) {
                const buffer = Buffer.from(await fileBlob.arrayBuffer());
                emailAttachments.push({
                  filename: att.file_name || att.fileName || "afbeelding.jpg",
                  content: buffer,
                  contentType: att.mime_type || att.mimeType || "image/jpeg",
                });
              } else if (downloadErr) {
                console.warn("Storage download warning for draft email attachment:", downloadErr);
              }
            }
          } catch (dlErr) {
            console.error("Error downloading attachment for draft send:", dlErr);
          }
        }
      }

      // 5. Dispatch real email via sendReminderEmail
      const senderName = user.name || "SafeVault Boekhouder";
      const sendResult = await sendReminderEmail({
        to: recipientEmail,
        subject: existingComm.subject,
        body: cleanBody,
        fromName: senderName,
        attachments: emailAttachments,
      });

      if (!sendResult.success) {
        return res.status(502).json({
          error: sendResult.error || "Het verzenden van de e-mail via de e-mailservice is mislukt. Probeer het later opnieuw.",
        });
      }

      // 6. Update communication in database to 'sent'
      const { data: updatedComm, error: updateErr } = await supabase
        .from("communications")
        .update({
          status: "sent",
          recipient: recipientEmail,
          sent_at: new Date().toISOString(),
        })
        .eq("id", commId)
        .select()
        .single();

      if (updateErr) return res.status(500).json({ error: updateErr.message });

      // 7. In-app notification
      try {
        await supabase.from("notifications").insert([
          {
            account_id: customerId,
            kind: "communication_sent",
            message: `Nieuw bericht ontvangen van uw boekhouder: ${existingComm.subject}`,
            read: false,
            created_at: new Date().toISOString(),
          },
        ]);
      } catch (notifErr) {
        console.error("Communication notification error:", notifErr);
      }

      res.json({
        ok: true,
        communication: {
          ...updatedComm,
          body: cleanBody,
          attachments,
        },
      });
    },
  );
  app.delete(
    "/api/dossier/:customerId/communications/:commId",
    requireAuth,
    async (req, res) => {
      const { customerId, commId } = req.params;
      const user = req.user;
      if (!(await canAccessCustomer(user, customerId))) {
        return res.status(404).json({ error: "Dossier niet gevonden." });
      }
      if (user.role === "customer")
        return res
          .status(403)
          .json({ error: "Klanten kunnen geen dossier-communicatie verwijderen." });

      const { error } = await supabase
        .from("communications")
        .delete()
        .eq("id", commId)
        .eq("customer_id", customerId);

      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true });
    },
  );
  app.get("/api/dossier/:customerId/status", requireAuth, async (req, res) => {
    const { customerId } = req.params;
    const { year } = req.query;
    const user = req.user;
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }
    const y = year ? parseInt(year) : new Date().getFullYear();
    const { data: dbRows } = await supabase
      .from("admin_status")
      .select("*")
      .eq("customer_id", customerId)
      .eq("year", y);
    const { data: dbFiles } = await supabase
      .from("files")
      .select("*, file_metadata (category, quarter, year)")
      .eq("customer_id", customerId);
    const allFiles = dbFiles || [];
    const quartersWithFiles = new Set();
    for (const f of allFiles) {
      const q = normalizeQuarter(f.quarter);
      const yrNum = f.year ? parseInt(String(f.year), 10) : y;
      if (q && yrNum === y) {
        quartersWithFiles.add(q);
      }
    }
    const quarters = ["Q1", "Q2", "Q3", "Q4"].map((q) => {
      const dbMatch = dbRows?.find((r) => r.quarter === q);
      if (dbMatch?.status === "done") {
        return {
          id: dbMatch?.id || `${customerId}_${y}_${q}`,
          quarter: q,
          year: y,
          status: "done",
          updated_at: dbMatch?.updated_at || new Date().toISOString(),
        };
      }
      if (quartersWithFiles.has(q)) {
        supabase
          .from("admin_status")
          .upsert(
            {
              user_id: user.id,
              customer_id: customerId,
              year: y,
              quarter: q,
              status: "in_progress",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "customer_id,quarter,year" },
          )
          .then(null, (e) => {
            console.error("Admin status upsert failed", e);
          });
        return {
          id: dbMatch?.id || `${customerId}_${y}_${q}`,
          quarter: q,
          year: y,
          status: "in_progress",
          updated_at: dbMatch?.updated_at || new Date().toISOString(),
        };
      }
      if (dbMatch && dbMatch.status !== "not_submitted") {
        return {
          id: dbMatch.id,
          quarter: q,
          year: y,
          status: dbMatch.status,
          updated_at: dbMatch.updated_at,
        };
      }
      return { quarter: q, year: y, status: "not_submitted", updated_at: null };
    });
    res.json({ year: y, quarters });
  });
  const updateStatusHandler = __name(async (req, res) => {
    const { customerId } = req.params;
    const { year, quarter, status } = req.body;
    const user = req.user;
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }
    if (user.role === "customer")
      return res
        .status(403)
        .json({ error: "Klanten kunnen statussen niet wijzigen." });
    const y = parseInt(year || new Date().getFullYear());
    try {
      await supabase
        .from("admin_status")
        .upsert(
          {
            user_id: user.id,
            customer_id: customerId,
            year: y,
            quarter,
            status,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "customer_id,quarter,year" },
        );
    } catch (err) {
      console.error("Error upserting admin_status:", err);
    }
    res.json({ ok: true });
  }, "updateStatusHandler");
  app.post("/api/dossier/:customerId/status", requireAuth, updateStatusHandler);
  app.put("/api/dossier/:customerId/status", requireAuth, updateStatusHandler);
  app.get("/api/customer/communications", requireAuth, async (req, res) => {
    const user = req.user;
    const { data, error } = await supabase
      .from("communications")
      .select("*")
      .eq("customer_id", user.id)
      .order("sent_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ communications: data });
  });
  app.post(
    "/api/communications/send",
    requireAuth,
    upload.single("file"),
    async (req, res) => {
      const { customerId, body = "", subject = "Chat" } = req.body || {};
      const user = req.user;
      const file = req.file;
      if (!customerId) {
        return res.status(400).json({ error: "Klant ID is verplicht." });
      }
      if (!body && !file) {
        return res
          .status(400)
          .json({ error: "Bericht of bestand is verplicht." });
      }
      if (!(await canAccessCustomer(user, customerId))) {
        return res.status(404).json({ error: "Gesprek niet gevonden." });
      }
      let finalBody = body;
      if (file) {
        const ext = path.extname(file.originalname);
        const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
        const filePath = `chat/${customerId}/${fileName}`;
        const { error: storageError } = await supabase.storage
          .from("customer-files")
          .upload(filePath, file.buffer, { contentType: file.mimetype });
        if (storageError) {
          console.error("Storage upload error in chat:", storageError);
          return res
            .status(500)
            .json({ error: "Bestand kon niet worden opgeslagen." });
        }
        const { data: dbFileData, error: dbFileError } = await supabase
          .from("files")
          .insert([
            {
              customer_id: customerId,
              user_id: user.id,
              original_name: file.originalname,
              mime_type: file.mimetype,
              size_bytes: file.size,
              storage_path: filePath,
            },
          ])
          .select()
          .single();
        if (dbFileError) {
          console.error("DB error inserting file in chat:", dbFileError);
          return res
            .status(500)
            .json({ error: "Fout bij opslaan bestandgegevens." });
        }
        finalBody = `\u{1F4CE} [attachment:${dbFileData.id}:${file.originalname}:${file.size}:${file.mimetype}]${body}`;
      }
      const { data, error } = await supabase
        .from("communications")
        .insert({
          customer_id: customerId,
          user_id: user.id,
          subject,
          body: finalBody,
          recipient: user.role === "customer" ? "Boekhouder" : "Klant",
          status: "sent",
        })
        .select()
        .single();
      if (error) {
        console.error("Error sending communication:", error);
        return res.status(500).json({ error: error.message });
      }
      if (data) {
        try {
          const targetId =
            user.role === "customer"
              ? (
                  await supabase
                    .from("accounts")
                    .select("owner_id")
                    .eq("id", user.id)
                    .single()
                ).data?.owner_id
              : customerId;
          if (targetId) {
            await supabase.from("notifications").insert([
              {
                account_id: targetId,
                kind: "chat_message",
                message:
                  user.role === "customer"
                    ? `Nieuw bericht van klant ${user.name}`
                    : "Nieuw bericht van uw boekhouder",
                read: false,
                created_at: new Date().toISOString(),
              },
            ]);
          }
        } catch (notifErr) {
          console.error("Chat notification error:", notifErr);
        }
      }
      res.json({ communication: data });
    },
  );
  app.get("/api/customer/notifications", requireAuth, async (req, res) => {
    const user = req.user;
    try {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("account_id", user.id)
        .order("created_at", { ascending: false });
      res.json({
        notifications: mergeNotificationsWithStore(data || [], user.id),
      });
    } catch {
      res.json({ notifications: mergeNotificationsWithStore([], user.id) });
    }
  });
  app.get("/api/notifications", requireAuth, async (req, res) => {
    const user = req.user;
    try {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("account_id", user.id)
        .order("created_at", { ascending: false });
      res.json({
        notifications: mergeNotificationsWithStore(data || [], user.id),
        securityWarning: null,
      });
    } catch {
      res.json({
        notifications: mergeNotificationsWithStore([], user.id),
        securityWarning: null,
      });
    }
  });
  app.post("/api/notifications/read", requireAuth, async (req, res) => {
    const { ids, all } = req.body;
    const user = req.user;
    try {
      let query = supabase
        .from("notifications")
        .update({ read: true })
        .eq("account_id", user.id);
      if (!all && ids && ids.length > 0) {
        query = query.in("id", ids);
      }
      await query;
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });
  app.post(
    "/api/customer/notifications/read",
    requireAuth,
    async (req, res) => {
      const { ids, all } = req.body;
      const user = req.user;
      try {
        let query = supabase
          .from("notifications")
          .update({ read: true })
          .eq("account_id", user.id);
        if (!all && ids && ids.length > 0) {
          query = query.in("id", ids);
        }
        await query;
        res.json({ ok: true });
      } catch {
        res.json({ ok: true });
      }
    },
  );
  app.get("/api/email-status", requireAuth, async (req, res) => {
    try {
      const status = isEmailConfigured();
      res.json(status);
    } catch {
      res.json({
        configured: false,
        reason: "SMTP-instellingen niet leesbaar.",
      });
    }
  });
  app.get("/api/email-template", requireAuth, async (req, res) => {
    try {
      const key = req.query.key || "reminder";
      let template = null;
      try {
        const { data } = await supabase
          .from("email_templates")
          .select("*")
          .eq("key", key)
          .single();
        if (data) template = data;
      } catch {}
      if (!template) {
        template = {
          key: "reminder",
          subject: "Herinnering – gegevens aanleveren voor {{kwartaal}}",
          body: "Beste {{klant_naam}},\n\nDit is een vriendelijke herinnering om uw gegevens voor {{kwartaal}} aan te leveren.\n\nWilt u alstublieft vóór {{deadline}} uw gegevens en relevante documenten voor dit kwartaal aanleveren? Op basis hiervan kan ik uw btw-aangifte voor {{kwartaal}} voorbereiden en tijdig verzorgen.\n\nU kunt uw gegevens en benodigde documenten eenvoudig via uw SafeVault-klantomgeving aanleveren. Controleer daarbij of alle relevante inkomsten, uitgaven en overige documenten van het betreffende kwartaal zijn toegevoegd.\n\nHeeft u de gegevens al aangeleverd? Dan kunt u deze herinnering als niet verzonden beschouwen.\n\nMocht u vragen hebben over welke gegevens of documenten u moet aanleveren, neem dan gerust contact met mij op via de gebruikelijke weg of stuur een bericht via de chat in SafeVault.\n\nAlvast bedankt voor het tijdig aanleveren van uw gegevens.\n\nMet vriendelijke groet,\n\n{{boekhouder_naam}}\nSafeVault\nUw beveiligde omgeving voor het aanleveren en verwerken van uw boekhoudgegevens",
        };
      }
      res.json({ template });
    } catch (err) {
      res.status(500).json({ error: "Kon e-mailtemplate niet ophalen." });
    }
  });
  app.post("/api/email-template", requireAuth, async (req, res) => {
    try {
      const { key = "reminder", subject, body } = req.body;
      if (
        !subject ||
        !body ||
        typeof subject !== "string" ||
        typeof body !== "string"
      ) {
        return res
          .status(400)
          .json({ error: "Onderwerp en e-mailtekst zijn verplicht." });
      }
      const { data: updated, error } = await supabase
        .from("email_templates")
        .upsert({
          key,
          subject: subject.trim(),
          body: body.trim(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) {
        return res
          .status(500)
          .json({ error: "Kon e-mailtemplate niet opslaan." });
      }
      res.json({ ok: true, template: updated });
    } catch (err) {
      res.status(500).json({ error: "Kon e-mailtemplate niet opslaan." });
    }
  });
  app.post("/api/dossier/send-reminders", requireAuth, async (req, res) => {
    try {
      const { customerIds, quarter, month, subject, body } = req.body;
      const user = req.user;
      if (user.role === "customer")
        return res.status(403).json({ error: "Geen toegang." });
      if (
        !customerIds ||
        !Array.isArray(customerIds) ||
        customerIds.length === 0
      ) {
        return res
          .status(400)
          .json({ error: "Selecteer minstens \xE9\xE9n klant." });
      }
      let templateSubject = subject;
      let templateBody = body;
      if (!templateSubject || !templateBody) {
        const { data: activeTpl } = await supabase
          .from("email_templates")
          .select("subject, body")
          .eq("key", "reminder")
          .single();
        if (!templateSubject)
          templateSubject =
            activeTpl?.subject || "Herinnering – gegevens aanleveren voor {{kwartaal}}";
        if (!templateBody)
          templateBody =
            activeTpl?.body ||
            "Beste {{klant_naam}},\n\nDit is een vriendelijke herinnering om uw gegevens voor {{kwartaal}} aan te leveren.\n\nWilt u alstublieft vóór {{deadline}} uw gegevens en relevante documenten voor dit kwartaal aanleveren? Op basis hiervan kan ik uw btw-aangifte voor {{kwartaal}} voorbereiden en tijdig verzorgen.\n\nU kunt uw gegevens en benodigde documenten eenvoudig via uw SafeVault-klantomgeving aanleveren. Controleer daarbij of alle relevante inkomsten, uitgaven en overige documenten van het betreffende kwartaal zijn toegevoegd.\n\nHeeft u de gegevens al aangeleverd? Dan kunt u deze herinnering als niet verzonden beschouwen.\n\nMocht u vragen hebben over welke gegevens of documenten u moet aanleveren, neem dan gerust contact met mij op via de gebruikelijke weg of stuur een bericht via de chat in SafeVault.\n\nAlvast bedankt voor het tijdig aanleveren van uw gegevens.\n\nMet vriendelijke groet,\n\n{{boekhouder_naam}}\nSafeVault\nUw beveiligde omgeving voor het aanleveren en verwerken van uw boekhoudgegevens";
      }
      let dbCustomers = [];
      try {
        const [{ data: accounts, error: accErr }, { data: emails, error: emailErr }] = await Promise.all([
          supabase.from("accounts").select("id, number, name"),
          supabase
            .from("customer_profile_fields")
            .select("customer_id, field_value")
            .eq("field_key", "email"),
        ]);
        if (accErr) throw new Error(`Accounts fetch error: ${accErr.message}`);
        if (emailErr) throw new Error(`Emails fetch error: ${emailErr.message}`);
        
        if (accounts) {
          dbCustomers = accounts.map((a) => {
            const e = emails?.find((ef) => ef.customer_id === a.id);
            return { ...a, email: e ? e.field_value : null };
          });
        }
      } catch (e) {
        console.error("Reminder fetch error:", e);
      }
      let sentCount = 0;
      let noEmailCount = 0;
      let failedCount = 0;
      let firstFailureError = "";
      const dispatchResults = [];
      const currentYear = new Date().getFullYear().toString();
      for (const cid of customerIds) {
        const c = dbCustomers.find((a) => a.id === cid || a.number === cid) || {
          id: cid,
          number: cid,
          name: `Klant ${cid}`,
          email: null,
        };
        const customerName = c.name || `Klant ${cid}`;
        const companyName = customerName;
        const customerEmail = c.email || null;
        if (!customerEmail) {
          noEmailCount++;
          dispatchResults.push({
            customerId: c.id,
            customerName,
            email: "",
            status: "no_email",
            error: "Klant heeft geen e-mailadres ingesteld.",
          });
          continue;
        }
        const quarterMonths: Record<string, string> = {
          Q1: "april",
          Q2: "juli",
          Q3: "oktober",
          Q4: "januari",
        };
        const normQ = (quarter || "Q1").toUpperCase().trim();
        const targetMonth = month || quarterMonths[normQ] || "april";
        const deadlineStr = `15 ${targetMonth}`;

        const render = __name((text) => {
          if (typeof text !== "string") return "";
          return text
            .replace(/\{\{klant_naam\}\}/gi, customerName)
            .replace(/\{\{klantnaam\}\}/gi, customerName)
            .replace(/\{\{bedrijfsnaam\}\}/gi, companyName)
            .replace(
              /\{\{boekhouder_naam\}\}/gi,
              user.name || "SafeVault Boekhouder",
            )
            .replace(/\{\{kwartaal\}\}/gi, normQ)
            .replace(/\{\{maand\}\}/gi, targetMonth)
            .replace(/\{\{deadline\}\}/gi, deadlineStr)
            .replace(/\{\{jaar\}\}/gi, currentYear)
            .replace(/\{\{openstaand_bedrag\}\}/gi, "\u20AC 0,00");
        }, "render");
        const finalSubject = render(templateSubject);
        const finalBody = render(templateBody);
        const sendResult = await sendReminderEmail({
          to: customerEmail,
          subject: finalSubject,
          body: finalBody,
          fromName: user.name || "SafeVault Boekhouder",
        });
        if (!sendResult.success) {
          console.warn(
            `[REMINDER DISPATCH RESULT] For ${customerEmail}:`,
            sendResult.error,
          );
          failedCount++;
          if (!firstFailureError)
            firstFailureError = sendResult.error || "E-mail niet geaccepteerd";
          dispatchResults.push({
            customerId: c.id,
            customerName,
            email: customerEmail,
            status: "failed",
            error: sendResult.error,
          });
          try {
            await supabase
              .from("communications")
              .insert({
                customer_id: c.id,
                user_id: user.id,
                subject: finalSubject,
                body: `[MISLUKT VERZONDEN] ${sendResult.error}

${finalBody}`,
                quarter: quarter || null,
                year: currentYear,
                recipient: customerEmail,
                status: "failed",
              });
          } catch {}
          continue;
        }
        sentCount++;
        dispatchResults.push({
          customerId: c.id,
          customerName,
          email: customerEmail,
          status: "accepted",
        });
        try {
          await supabase
            .from("communications")
            .insert({
              customer_id: c.id,
              user_id: user.id,
              subject: finalSubject,
              body: finalBody,
              quarter: quarter || null,
              year: currentYear,
              recipient: customerEmail,
              status: "accepted",
            });
        } catch {}
      }
      res.json({
        sentCount,
        noEmailCount,
        failedCount,
        error: sentCount === 0 && failedCount > 0 ? firstFailureError : void 0,
        results: dispatchResults,
      });
    } catch (err) {
      console.error("[SERVER REMINDER ROUTE FATAL ERROR]", err);
      res.status(500).json({
        error:
          "De herinnering kon momenteel niet worden verzonden. Controleer de e-mailinstellingen of probeer het opnieuw.",
      });
    }
  });
  app.get("/api/owner/stats", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    try {
      const [
        { data: allAccounts, error: accErr },
        { data: customers, error: custErr },
        { data: blocked, error: blockErr },
        { data: files, error: fileErr },
      ] = await Promise.all([
        supabase
          .from("accounts")
          .select(
            "id, number, name, status, role, owner_id, created_at, last_login_at",
          )
          .in("role", ["user", "organization"]),
        supabase.from("accounts").select("id, owner_id").eq("role", "customer"),
        supabase.from("accounts").select("id").eq("status", "blocked"),
        supabase.from("files").select("id, size_bytes"),
      ]);
      if (accErr) {
        console.error("Fout in GET /api/owner/stats accErr:", accErr);
      }
      let totalStorageBytes = 0;
      if (files) {
        totalStorageBytes = files.reduce(
          (acc, f) => acc + (f.size_bytes || 0),
          0,
        );
      }
      const accountList = allAccounts || [];
      const usersList = accountList.filter(
        (u) => u.role === "user" && !String(u.number).startsWith("2"),
      );
      const orgsList = accountList.filter(
        (u) =>
          u.role === "organization" ||
          (u.role === "user" && String(u.number).startsWith("2")),
      );
      res.json({
        userCount: usersList.length,
        organizationCount: orgsList.length,
        customerCount: customers?.length || 0,
        blockedCount: blocked?.length || 0,
        totalStorageBytes,
        fileCount: files?.length || 0,
      });
    } catch (err) {
      console.error("Fout in GET /api/owner/stats:", err);
      res.status(500).json({ error: "Fout bij ophalen statistieken." });
    }
  });
  app.get("/api/owner/organizations", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    try {
      const [
        { data: allAccounts, error: accErr },
        { data: customers, error: custErr },
        { data: files, error: fileErr },
      ] = await Promise.all([
        supabase
          .from("accounts")
          .select(
            "id, number, name, status, role, owner_id, created_at, last_login_at, storage_used_bytes",
          )
          .in("role", ["user", "organization"]),
        supabase
          .from("accounts")
          .select("id, owner_id, storage_used_bytes")
          .eq("role", "customer"),
        supabase.from("files").select("customer_id, size_bytes"),
      ]);
      if (accErr) {
        console.error(
          "Fout bij ophalen accounts in GET /api/owner/organizations:",
          accErr,
        );
        return res
          .status(500)
          .json({ error: "Fout bij ophalen organisaties: " + accErr.message });
      }
      const accountList = allAccounts || [];
      const customerList = customers || [];
      const fileList = files || [];
      const orgs = accountList.filter(
        (a) =>
          a.role === "organization" ||
          (a.role === "user" && String(a.number).startsWith("2")),
      );
      const users = accountList.filter(
        (a) => a.role === "user" && !String(a.number).startsWith("2"),
      );
      const mappedOrganizations = await Promise.all(
        orgs.map(async (o) => {
          const orgUsers = users.filter((u) => u.owner_id === o.id);
          const orgUserIds = new Set(orgUsers.map((u) => u.id));
          const orgCustomers = customerList.filter(
            (c) => orgUserIds.has(c.owner_id || "") || c.owner_id === o.id,
          );
          const orgCustomerIds = new Set(orgCustomers.map((c) => c.id));
          let orgStorageBytes = o.storage_used_bytes || 0;
          orgStorageBytes += orgUsers.reduce(
            (sum, u) => sum + (u.storage_used_bytes || 0),
            0,
          );
          orgStorageBytes += orgCustomers.reduce(
            (sum, c) => sum + (c.storage_used_bytes || 0),
            0,
          );
          orgStorageBytes += fileList
            .filter((f) => orgCustomerIds.has(f.customer_id))
            .reduce((sum, f) => sum + (f.size_bytes || 0), 0);
          const twoFa = await getAccount2FAState(o.id);
          return {
            id: o.id,
            number: o.number,
            name: o.name,
            status: o.status,
            role: "organization",
            owner_id: o.owner_id,
            userCount: orgUsers.length,
            customerCount: orgCustomers.length,
            storageBytes: orgStorageBytes,
            twoFactorEnabled: twoFa.two_factor_enabled,
            last2faVerifiedAt: twoFa.last_2fa_verified_at,
            createdAt: o.created_at,
            lastLoginAt: o.last_login_at,
          };
        }),
      );
      res.json({ organizations: mappedOrganizations });
    } catch (err) {
      console.error("Fout in GET /api/owner/organizations:", err);
      res
        .status(500)
        .json({
          error:
            "Fout bij ophalen organisaties: " +
            (err.message || "Onbekende fout"),
        });
    }
  });
  app.get("/api/owner/customers", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    const { data: customers, error } = await supabase
      .from("accounts")
      .select("id, number, name, status, owner_id, created_at, last_login_at")
      .eq("role", "customer");
    if (error) return res.status(500).json({ error: error.message });
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, name, number, role");
    const accMap = new Map();
    (accounts || []).forEach((a) => accMap.set(a.id, a));
    const mappedCustomers = (customers || []).map((c) => {
      const ownerAcc = c.owner_id ? accMap.get(c.owner_id) : null;
      return {
        ...c,
        ownerName: ownerAcc ? ownerAcc.name : "Ongekoppeld",
        ownerNumber: ownerAcc ? ownerAcc.number : null,
      };
    });
    res.json({ customers: mappedCustomers });
  });
  app.post("/api/owner/assign-customers", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    const { userId, customerIds } = req.body;
    if (!userId || !Array.isArray(customerIds)) {
      return res.status(400).json({ error: "Ongeldige parameters" });
    }
    const { error: clearErr } = await supabase
      .from("accounts")
      .update({ owner_id: null })
      .eq("owner_id", userId);
    if (clearErr) {
      return res
        .status(500)
        .json({ error: "Fout bij ontkoppelen: " + clearErr.message });
    }
    if (customerIds.length > 0) {
      const { error: assignErr } = await supabase
        .from("accounts")
        .update({ owner_id: userId })
        .in("id", customerIds);
      if (assignErr) {
        return res
          .status(500)
          .json({ error: "Fout bij koppelen: " + assignErr.message });
      }
    }
    res.json({ ok: true });
  });
  app.get("/api/owner/users", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    try {
      const [
        { data: allAccounts, error: accErr },
        { data: customers, error: custErr },
        { data: files, error: fileErr },
      ] = await Promise.all([
        supabase
          .from("accounts")
          .select(
            "id, number, name, status, role, owner_id, created_at, last_login_at, storage_used_bytes",
          )
          .in("role", ["user", "organization"]),
        supabase
          .from("accounts")
          .select("id, owner_id, storage_used_bytes")
          .eq("role", "customer"),
        supabase.from("files").select("customer_id, size_bytes"),
      ]);
      if (accErr) {
        console.error(
          "Fout bij ophalen accounts in GET /api/owner/users:",
          accErr,
        );
        return res
          .status(500)
          .json({ error: "Fout bij ophalen gebruikers: " + accErr.message });
      }
      const accountList = allAccounts || [];
      const customerList = customers || [];
      const fileList = files || [];
      const orgs = accountList.filter(
        (a) =>
          a.role === "organization" ||
          (a.role === "user" && String(a.number).startsWith("2")),
      );
      const orgMap = new Map();
      orgs.forEach((o) => orgMap.set(o.id, o.name));
      const users = accountList.filter(
        (a) => a.role === "user" && !String(a.number).startsWith("2"),
      );
      const mappedUsers = await Promise.all(
        users.map(async (u) => {
          const userCustomers = customerList.filter((c) => c.owner_id === u.id);
          const userCustomerIds = new Set(userCustomers.map((c) => c.id));
          let userStorageBytes = u.storage_used_bytes || 0;
          userStorageBytes += userCustomers.reduce(
            (sum, c) => sum + (c.storage_used_bytes || 0),
            0,
          );
          userStorageBytes += fileList
            .filter((f) => userCustomerIds.has(f.customer_id))
            .reduce((sum, f) => sum + (f.size_bytes || 0), 0);
          const organizationName =
            u.owner_id && orgMap.has(u.owner_id)
              ? orgMap.get(u.owner_id)
              : null;
          const twoFa = await getAccount2FAState(u.id);
          return {
            id: u.id,
            number: u.number,
            name: u.name,
            status: u.status,
            role: "user",
            owner_id: u.owner_id,
            organizationName,
            customerCount: userCustomers.length,
            storageBytes: userStorageBytes,
            twoFactorEnabled: twoFa.two_factor_enabled,
            last2faVerifiedAt: twoFa.last_2fa_verified_at,
            createdAt: u.created_at,
            lastLoginAt: u.last_login_at,
          };
        }),
      );
      res.json({ users: mappedUsers });
    } catch (err) {
      console.error("Fout in GET /api/owner/users:", err);
      res
        .status(500)
        .json({
          error:
            "Fout bij ophalen gebruikers: " + (err.message || "Onbekende fout"),
        });
    }
  });
  app.post("/api/owner/users/:id/reset-2fa", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    const userId = req.params.id;
    if (!userId) return res.status(400).json({ error: "userId is verplicht" });
    try {
      await resetAccount2FAState(userId);
    } catch (err) {
      console.warn("Supabase 2FA reset notice:", err);
    }
    await supabase
      .from("access_logs")
      .insert({
        account_id: userId,
        event: "user_2fa_reset",
        ip: req.ip || "127.0.0.1",
      });
    res.json({
      ok: true,
      message:
        "De bestaande authenticator-koppeling is verwijderd. De gebruiker moet bij de volgende login opnieuw 2FA instellen.",
    });
  });
  app.post(
    "/api/owner/create-organization-bulk",
    requireAuth,
    async (req, res) => {
      if (req.user.role !== "owner")
        return res.status(403).json({ error: "Geen toegang" });
      const { org, users, ownerPassword } = req.body;
      if (!org || !org.number || !org.password || !ownerPassword) {
        return res.status(400).json({ error: "Ontbrekende velden." });
      }
      const { data: ownerCreds } = await supabase
        .from("credentials")
        .select("password_hash")
        .eq("account_id", req.user.id)
        .single();
      if (!ownerCreds)
        return res
          .status(500)
          .json({ error: "Eigenaar inloggegevens niet gevonden." });
      const isMatch = await bcrypt.compare(
        ownerPassword,
        ownerCreds.password_hash,
      );
      if (!isMatch)
        return res.status(401).json({ error: "Onjuist wachtwoord." });
      const { data: existingOrg } = await supabase
        .from("accounts")
        .select("id")
        .eq("number", org.number)
        .single();
      if (existingOrg)
        return res
          .status(400)
          .json({ error: "Organisatienummer is al in gebruik." });
      const createdAccountIds = [];
      try {
        const orgHash = await bcrypt.hash(org.password, 10);
        const { data: orgAccount, error: orgErr } = await supabase
          .from("accounts")
          .insert({
            number: org.number,
            name: org.name,
            role: "organization",
            status: "active",
            owner_id: req.user.id,
          })
          .select()
          .single();
        if (orgErr || !orgAccount)
          throw new Error(orgErr?.message || "Fout bij aanmaken organisatie.");
        createdAccountIds.push(orgAccount.id);
        await supabase
          .from("credentials")
          .insert({ account_id: orgAccount.id, password_hash: orgHash });
        for (const u of users || []) {
          const uHash = await bcrypt.hash(u.password, 10);
          const { data: userAcc, error: uErr } = await supabase
            .from("accounts")
            .insert({
              number: u.number,
              name: u.name,
              role: "user",
              status: "active",
              owner_id: orgAccount.id,
            })
            .select()
            .single();
          if (uErr || !userAcc)
            throw new Error(uErr?.message || "Fout bij aanmaken gebruiker.");
          createdAccountIds.push(userAcc.id);
          await supabase
            .from("credentials")
            .insert({ account_id: userAcc.id, password_hash: uHash });
          for (const c of u.customers || []) {
            const cHash = await bcrypt.hash(c.password, 10);
            const { data: custAcc, error: cErr } = await supabase
              .from("accounts")
              .insert({
                number: c.number,
                name: c.name,
                role: "customer",
                status: "active",
                owner_id: userAcc.id,
              })
              .select()
              .single();
            if (cErr || !custAcc)
              throw new Error(cErr?.message || "Fout bij aanmaken klant.");
            createdAccountIds.push(custAcc.id);
            await supabase
              .from("credentials")
              .insert({ account_id: custAcc.id, password_hash: cHash });
          }
        }
        await supabase
          .from("access_logs")
          .insert({
            account_id: req.user.id,
            event: "organization_bulk_created",
            ip: req.ip || "127.0.0.1",
            metadata: {
              orgNumber: org.number,
              usersCount: (users || []).length,
            },
          });
        res.json({ ok: true });
      } catch (err) {
        console.error("Rollback bulk creation due to error:", err);
        if (createdAccountIds.length > 0) {
          try {
            await supabase
              .from("credentials")
              .delete()
              .in("account_id", createdAccountIds);
            await supabase
              .from("accounts")
              .delete()
              .in("id", createdAccountIds);
          } catch (cleanupErr) {
            console.error("Error during rollback cleanup:", cleanupErr);
          }
        }
        res
          .status(500)
          .json({
            error: err.message || "Interne fout bij aanmaken organisatie.",
          });
      }
    },
  );
  app.post("/api/owner/create-user", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    const { name, number, password } = req.body;
    if (!number || (!number.startsWith("89") && !number.startsWith("2"))) {
      return res
        .status(400)
        .json({
          error: "Nummer moet beginnen met 89 (boekhouder) of 2 (organisatie)",
        });
    }
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: "Naam is verplicht" });
    }
    if (name.length > 80) {
      return res
        .status(400)
        .json({ error: "Naam mag maximaal 80 tekens lang zijn" });
    }
    const { data: existing } = await supabase
      .from("accounts")
      .select("id")
      .eq("number", number)
      .single();
    if (existing)
      return res
        .status(400)
        .json({ error: "Dit accountnummer is al in gebruik." });
    const cleanPassword = String(password).trim();
    const hash = await bcrypt.hash(cleanPassword, 10);
    const { data: account, error: accErr } = await supabase
      .from("accounts")
      .insert({
        number,
        name,
        role: "user",
        status: "active",
        owner_id: req.user.id,
      })
      .select()
      .single();
    if (accErr || !account)
      return res
        .status(500)
        .json({ error: accErr?.message || "Fout bij aanmaken gebruiker." });
    await supabase
      .from("credentials")
      .insert({ account_id: account.id, password_hash: hash });
    await supabase
      .from("access_logs")
      .insert({
        account_id: account.id,
        account_number: number,
        event: number.startsWith("2") ? "organization_created" : "user_created",
        ip: req.ip || "127.0.0.1",
        metadata: { name },
      });
    res.json({ account: sanitizeAccount(account) });
  });
  const generateUniqueCustomerNumber = async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      let num = "6";
      while (num.length < 8) {
        num += Math.floor(Math.random() * 10).toString();
      }
      const { data: existing } = await supabase
        .from("accounts")
        .select("id")
        .eq("number", num)
        .maybeSingle();
      if (!existing) return num;
    }
    let fallback = "6";
    while (fallback.length < 8) {
      fallback += Math.floor(Math.random() * 10).toString();
    }
    return fallback;
  };
  const generateSecureCustomerPassword = () => {
    const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let pwd = "";
    for (let i = 0; i < 8; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pwd;
  };
  app.post("/api/owner/create-customers", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    const { userId, count } = req.body;
    const targetOwnerId = userId || req.user.id;
    const created = [];
    for (let i = 0; i < (count || 1); i++) {
      const number = await generateUniqueCustomerNumber();
      const tempPassword = generateSecureCustomerPassword();
      const hash = await bcrypt.hash(tempPassword, 10);
      const { data: account, error: accErr } = await supabase
        .from("accounts")
        .insert({
          number,
          name: `Klant ${number}`,
          role: "customer",
          status: "active",
          owner_id: targetOwnerId,
        })
        .select()
        .single();
      if (!accErr && account) {
        const { error: credErr } = await supabase
          .from("credentials")
          .insert({ account_id: account.id, password_hash: hash });
        if (credErr) {
          console.error("Error creating credentials for customer:", credErr);
          await supabase.from("accounts").delete().eq("id", account.id);
          continue;
        }
        created.push({
          number: account.number,
          name: account.name,
          tempPassword,
        });
      } else if (accErr) {
        console.error("Error creating customer account:", accErr);
      }
    }
    res.json({ created, count: created.length });
  });
  app.post("/api/owner/reset-user-password", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is verplicht" });
    const tempPassword =
      Math.random().toString(36).slice(-8) +
      Math.floor(10 + Math.random() * 90);
    const hash = await bcrypt.hash(tempPassword, 10);
    const { error } = await supabase
      .from("credentials")
      .upsert(
        { account_id: userId, password_hash: hash },
        { onConflict: "account_id" },
      );
    if (error) return res.status(500).json({ error: error.message });
    await supabase
      .from("access_logs")
      .insert({
        account_id: userId,
        event: "user_password_reset",
        ip: req.ip || "127.0.0.1",
      });
    res.json({ tempPassword });
  });
  app.post("/api/owner/delete-user", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is verplicht" });
    if (userId === req.user.id)
      return res
        .status(400)
        .json({ error: "U kunt uzelf hier niet verwijderen." });
    const { data: custs } = await supabase
      .from("accounts")
      .select("id")
      .eq("owner_id", userId);
    const directIds = (custs || []).map((c) => c.id);
    let grandIds = [];
    if (directIds.length > 0) {
      const { data: grand } = await supabase
        .from("accounts")
        .select("id")
        .in("owner_id", directIds);
      grandIds = (grand || []).map((c) => c.id);
    }
    const allTargetIds = Array.from(
      new Set([userId, ...directIds, ...grandIds]),
    );
    for (const tid of allTargetIds) {
      try {
        await supabase
          .from("communications")
          .delete()
          .or(`customer_id.eq.${tid},user_id.eq.${tid}`);
      } catch (e) {}
      try {
        await supabase
          .from("files")
          .delete()
          .or(`customer_id.eq.${tid},user_id.eq.${tid}`);
      } catch (e) {}
      try {
        await supabase.from("file_metadata").delete().eq("account_id", tid);
      } catch (e) {}
      try {
        await supabase
          .from("customer_profile_fields")
          .delete()
          .eq("customer_id", tid);
      } catch (e) {}
      try {
        await supabase.from("notifications").delete().eq("account_id", tid);
      } catch (e) {}
      try {
        await supabase.from("access_logs").delete().eq("account_id", tid);
      } catch (e) {}
      try {
        await supabase
          .from("user_notes")
          .delete()
          .or(`user_id.eq.${tid},account_id.eq.${tid}`);
      } catch (e) {}
      try {
        await supabase.from("btw_calculations").delete().eq("account_id", tid);
      } catch (e) {}
      try {
        await supabase.from("sessions").delete().eq("account_id", tid);
      } catch (e) {}
      try {
        await supabase.from("credentials").delete().eq("account_id", tid);
      } catch (e) {}
    }
    if (grandIds.length > 0) {
      await supabase.from("accounts").delete().in("id", grandIds);
    }
    if (directIds.length > 0) {
      await supabase.from("accounts").delete().in("id", directIds);
    }
    const { error: delErr } = await supabase
      .from("accounts")
      .delete()
      .eq("id", userId);
    if (delErr) {
      return res
        .status(500)
        .json({ error: "Fout bij verwijderen: " + delErr.message });
    }
    await supabase
      .from("access_logs")
      .insert({
        account_id: req.user.id,
        event: "user_deleted",
        ip: req.ip || "127.0.0.1",
        metadata: { deletedUserId: userId },
      });
    res.json({ ok: true });
  });
  app.post("/api/owner/unblock", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    const { accountId } = req.body;
    if (!accountId)
      return res.status(400).json({ error: "accountId is verplicht" });
    const { error } = await supabase
      .from("accounts")
      .update({ status: "active", failed_attempts: 0 })
      .eq("id", accountId);
    if (error) return res.status(500).json({ error: error.message });
    await supabase
      .from("access_logs")
      .insert({
        account_id: accountId,
        event: "owner_unblock",
        ip: req.ip || "127.0.0.1",
        metadata: { status: "Opgelost" },
      });
    const { data: logs } = await supabase
      .from("access_logs")
      .select("id, metadata")
      .eq("account_id", accountId)
      .in("event", [
        "login_blocked",
        "account_blocked",
        "customer_blocked",
        "login_failed",
      ]);
    for (const l of logs || []) {
      if (l.metadata?.status !== "Opgelost") {
        const newMeta = { ...(l.metadata || {}), status: "Opgelost" };
        await supabase
          .from("access_logs")
          .update({ metadata: newMeta })
          .eq("id", l.id);
      }
    }
    res.json({ ok: true });
  });
  app.get("/api/owner/blocked", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    const { data: blockedAccs } = await supabase
      .from("accounts")
      .select("id, number, name, role, created_at, updated_at, owner_id")
      .eq("status", "blocked");
    const { data: owners } = await supabase.from("accounts").select("id, name");
    const mapped = (blockedAccs || []).map((a) => {
      const ownerAcc = (owners || []).find((o) => o.id === a.owner_id);
      return {
        id: a.id,
        number: a.number,
        name: a.name,
        role:
          a.role === "user" || a.role === "bookkeeper" ? "user" : "customer",
        ownerName: ownerAcc?.name || "Systeem",
        blockedAt: a.updated_at || a.created_at,
      };
    });
    res.json({ blocked: mapped });
  });
  app.get("/api/owner/warnings", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    const { data: logs } = await supabase
      .from("access_logs")
      .select("*")
      .in("event", [
        "login_failed",
        "login_blocked",
        "account_blocked",
        "customer_blocked",
        "owner_unblock",
      ])
      .order("created_at", { ascending: false })
      .limit(100);
    const mapped = (logs || [])
      .filter((l) => l.metadata?.status !== "Opgelost")
      .map((l) => ({
        id: l.id,
        account_number: l.account_number || "\u2014",
        event: l.event,
        ip: l.ip || "127.0.0.1",
        created_at: l.created_at,
        attempts: l.attempts || void 0,
      }));
    res.json({ warnings: mapped });
  });
  app.post("/api/owner/warnings/:id/resolve", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    const { data: log } = await supabase
      .from("access_logs")
      .select("metadata")
      .eq("id", req.params.id)
      .single();
    if (log) {
      const newMeta = { ...(log.metadata || {}), status: "Opgelost" };
      await supabase
        .from("access_logs")
        .update({ metadata: newMeta })
        .eq("id", req.params.id);
    }
    res.json({ ok: true });
  });
  app.post("/api/owner/warnings/resolve-all", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    const { data: logs } = await supabase
      .from("access_logs")
      .select("id, metadata")
      .in("event", [
        "login_failed",
        "login_blocked",
        "account_blocked",
        "customer_blocked",
        "owner_unblock",
      ]);
    const toUpdate = (logs || []).filter(
      (l) => l.metadata?.status !== "Opgelost",
    );
    for (const l of toUpdate) {
      const newMeta = { ...(l.metadata || {}), status: "Opgelost" };
      await supabase
        .from("access_logs")
        .update({ metadata: newMeta })
        .eq("id", l.id);
    }
    res.json({ ok: true });
  });
  app.get("/api/owner/logs", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    const { data: logs } = await supabase
      .from("access_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    const mapped = (logs || []).map((l) => ({
      id: l.id,
      account_number: l.account_number || "\u2014",
      event: l.event,
      ip: l.ip || "127.0.0.1",
      created_at: l.created_at,
      attempts: l.attempts || void 0,
    }));
    res.json({ logs: mapped });
  });
  app.get("/api/owner/settings", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    const { data: set, error } = await supabase
      .from("settings")
      .select("*")
      .single();
    if (error || !set) {
      const defaultSettings = {
        id: 1,
        max_customer_accounts_per_batch: 50,
        max_upload_bytes: 52428800,
        session_lifetime_hours: 5,
        max_login_attempts: 5,
        retention_years: 7,
      };
      await supabase.from("settings").insert(defaultSettings);
      return res.json(defaultSettings);
    }
    res.json({
      id: set.id,
      max_customer_accounts_per_batch:
        set.max_customer_accounts_per_batch ?? 50,
      max_upload_bytes: set.max_upload_bytes ?? 52428800,
      session_lifetime_hours: set.session_lifetime_hours ?? 5,
      max_login_attempts: set.max_login_attempts ?? 5,
      retention_years: set.retention_years ?? 7,
    });
  });
  app.post("/api/owner/settings", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    const {
      max_customer_accounts_per_batch,
      max_upload_bytes,
      session_lifetime_hours,
      max_login_attempts,
      retention_years,
    } = req.body;
    const payload = {
      id: 1,
      max_customer_accounts_per_batch:
        Number(max_customer_accounts_per_batch) || 50,
      max_upload_bytes: Number(max_upload_bytes) || 52428800,
      session_lifetime_hours: Number(session_lifetime_hours) || 5,
      max_login_attempts: Number(max_login_attempts) || 5,
      retention_years: Number(retention_years) || 7,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("settings")
      .upsert(payload, { onConflict: "id" })
      .select()
      .single();
    if (error) {
      console.error("Error updating settings:", error);
      return res
        .status(500)
        .json({ error: "Fout bij opslaan van instellingen." });
    }
    await supabase
      .from("access_logs")
      .insert({
        account_id: req.user.id,
        event: "settings_updated",
        ip: req.ip || "127.0.0.1",
      });
    res.json({ ok: true, settings: data });
  });
  app.get("/api/owner/owner-count", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    const { data: owners } = await supabase
      .from("accounts")
      .select("id")
      .eq("role", "owner");
    res.json({ count: owners?.length || 0 });
  });
  app.post("/api/owner/delete-account", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    try {
      const { data: owners, error: ownersErr } = await supabase
        .from("accounts")
        .select("id")
        .eq("role", "owner");
      if (ownersErr || !owners) {
        return res
          .status(500)
          .json({ error: "Kon eigenaarsstatus niet verifi\xEBren." });
      }
      const isLastOwner = owners.length <= 1;
      const { newOwnerName, newOwnerNumber, newOwnerPassword } = req.body || {};
      if (
        isLastOwner &&
        (!newOwnerName || !newOwnerNumber || !newOwnerPassword)
      ) {
        return res
          .status(400)
          .json({
            requiresNewOwner: true,
            error:
              "Je kunt het laatste eigenaar-account niet verwijderen. Maak eerst een nieuwe eigenaar aan.",
          });
      }
      if (isLastOwner) {
        if (String(newOwnerPassword).length < 8) {
          return res
            .status(400)
            .json({
              error:
                "Wachtwoord van nieuwe eigenaar moet minimaal 8 tekens lang zijn.",
            });
        }
        const hash = await bcrypt.hash(String(newOwnerPassword), 10);
        const { data: newAccount, error: accErr } = await supabase
          .from("accounts")
          .insert({
            name: String(newOwnerName).trim(),
            number: String(newOwnerNumber).trim(),
            role: "owner",
            status: "active",
          })
          .select()
          .single();
        if (accErr || !newAccount) {
          return res
            .status(500)
            .json({
              error:
                accErr?.message || "Fout bij aanmaken van de nieuwe eigenaar.",
            });
        }
        const { error: credErr } = await supabase
          .from("credentials")
          .insert({ account_id: newAccount.id, password_hash: hash });
        if (credErr) {
          await supabase.from("accounts").delete().eq("id", newAccount.id);
          return res
            .status(500)
            .json({
              error: "Fout bij opslaan inloggegevens van de nieuwe eigenaar.",
            });
        }
        const { data: verifyAcc } = await supabase
          .from("accounts")
          .select("id")
          .eq("id", newAccount.id)
          .single();
        if (!verifyAcc) {
          return res
            .status(500)
            .json({
              error:
                "Nieuwe eigenaar kon niet geverifieerd worden. Verwijdering geannuleerd.",
            });
        }
      }
      const oldAccountId = req.user.id;
      await supabase.from("sessions").delete().eq("account_id", oldAccountId);
      await supabase
        .from("credentials")
        .delete()
        .eq("account_id", oldAccountId);
      await supabase.from("accounts").delete().eq("id", oldAccountId);
      res.json({ ok: true, message: "Eigenaar-account succesvol verwijderd." });
    } catch (err) {
      console.error("delete-account error:", err);
      res
        .status(500)
        .json({
          error: "Interne serverfout bij verwijderen van eigenaar-account.",
        });
    }
  });
  async function getQuarterStatusData(year, allowedCustomerIds) {
    const targetYear = year || new Date().getFullYear();
    let query = supabase
      .from("accounts")
      .select("id, number, name, status, created_at, last_login_at, owner_id")
      .eq("role", "customer");
    if (allowedCustomerIds) {
      if (allowedCustomerIds.length > 0) {
        query = query.in("id", allowedCustomerIds);
      } else {
        query = query.eq("id", "none");
      }
    }
    const { data: customers } = await query;
    const allCustomers = customers || [];
    const { data: statusRows } = await supabase
      .from("admin_status")
      .select("customer_id, quarter, status")
      .eq("year", targetYear);
    const explicitStatusMap = { Q1: {}, Q2: {}, Q3: {}, Q4: {} };
    if (statusRows) {
      for (const row of statusRows) {
        if (explicitStatusMap[row.quarter]) {
          explicitStatusMap[row.quarter][row.customer_id] = row.status;
        }
      }
    }
    const filesQuarterSets = {
      Q1: new Set(),
      Q2: new Set(),
      Q3: new Set(),
      Q4: new Set(),
    };
    try {
      let filesQuery = supabase
        .from("files")
        .select("customer_id, file_metadata (quarter, year)");
      if (allowedCustomerIds && allowedCustomerIds.length > 0) {
        filesQuery = filesQuery.in("customer_id", allowedCustomerIds);
      }
      const { data: filesWithMeta } = await filesQuery;
      if (filesWithMeta) {
        for (const f of filesWithMeta) {
          const custId = f.customer_id;
          const metaList = Array.isArray(f.file_metadata)
            ? f.file_metadata
            : f.file_metadata
              ? [f.file_metadata]
              : [];
          for (const meta of metaList) {
            if (meta && custId) {
              const normQ = normalizeQuarter(meta.quarter);
              const yrNum = meta.year
                ? parseInt(String(meta.year), 10)
                : targetYear;
              if (yrNum === targetYear && normQ && filesQuarterSets[normQ]) {
                filesQuarterSets[normQ].add(custId);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(
        "Error fetching filesWithMeta in getQuarterStatusData:",
        err,
      );
    }
    const statusByQuarter = {
      Q1: { not_submitted: [], in_progress: [], done: [] },
      Q2: { not_submitted: [], in_progress: [], done: [] },
      Q3: { not_submitted: [], in_progress: [], done: [] },
      Q4: { not_submitted: [], in_progress: [], done: [] },
    };
    const quarters = ["Q1", "Q2", "Q3", "Q4"];
    for (const c of allCustomers) {
      for (const q of quarters) {
        const explicit = explicitStatusMap[q][c.id];
        const hasFiles = filesQuarterSets[q].has(c.id);
        if (explicit === "done") {
          statusByQuarter[q].done.push(c);
        } else if (explicit === "in_progress" || hasFiles) {
          statusByQuarter[q].in_progress.push(c);
        } else {
          statusByQuarter[q].not_submitted.push(c);
        }
      }
    }
    const missingByQuarter = {
      Q1: statusByQuarter.Q1.not_submitted,
      Q2: statusByQuarter.Q2.not_submitted,
      Q3: statusByQuarter.Q3.not_submitted,
      Q4: statusByQuarter.Q4.not_submitted,
    };
    return {
      year: targetYear,
      totalCount: allCustomers.length,
      statusByQuarter,
      missingByQuarter,
      allCustomers,
    };
  }
  __name(getQuarterStatusData, "getQuarterStatusData");
  app.get("/api/user/stats", requireAuth, async (req, res) => {
    const user = req.user;
    if (user.role === "customer" || user.role === "organization")
      return res.status(403).json({ error: "Geen toegang" });
    const allowedIds = await getAccessibleCustomerIds(user);
    let custQuery = supabase
      .from("accounts")
      .select("id, status")
      .eq("role", "customer");
    if (user.role !== "owner") {
      if (allowedIds.length > 0) {
        custQuery = custQuery.in("id", allowedIds);
      } else {
        custQuery = custQuery.eq("id", "none");
      }
    }
    const { data: custs } = await custQuery;
    const customerCount = custs?.length || 0;
    const blockedCustomers =
      custs?.filter((c) => c.status === "blocked").length || 0;
    const quarterData = await getQuarterStatusData(
      void 0,
      user.role !== "owner" ? allowedIds : void 0,
    );
    let filesQuery = supabase
      .from("files")
      .select("id, size_bytes, created_at, customer_id");
    if (user.role !== "owner") {
      if (allowedIds.length > 0) {
        filesQuery = filesQuery.in("customer_id", allowedIds);
      } else {
        filesQuery = filesQuery.eq("customer_id", "none");
      }
    }
    const { data: files } = await filesQuery;
    const totalStorageBytes =
      files?.reduce((acc, f) => acc + (f.size_bytes || 0), 0) || 0;
    const newUploads = files?.length || 0;
    const today = new Date().toISOString().slice(0, 10);
    const newUploadsToday =
      files?.filter((f) => f.created_at?.startsWith(today)).length || 0;
    let doneDossiers = 0;
    let openDossiers = 0;
    for (const c of quarterData.allCustomers) {
      const isQ1Done = quarterData.statusByQuarter.Q1.done.some(
        (m) => m.id === c.id,
      );
      const isQ2Done = quarterData.statusByQuarter.Q2.done.some(
        (m) => m.id === c.id,
      );
      const isQ3Done = quarterData.statusByQuarter.Q3.done.some(
        (m) => m.id === c.id,
      );
      const isQ4Done = quarterData.statusByQuarter.Q4.done.some(
        (m) => m.id === c.id,
      );
      if (isQ1Done && isQ2Done && isQ3Done && isQ4Done) {
        doneDossiers++;
      } else {
        openDossiers++;
      }
    }
    res.json({
      customerCount,
      blockedCustomers,
      newUploads,
      newUploadsToday,
      storageBytes: totalStorageBytes,
      notSubmittedQ1: quarterData.statusByQuarter.Q1.not_submitted.length,
      notSubmittedQ2: quarterData.statusByQuarter.Q2.not_submitted.length,
      notSubmittedQ3: quarterData.statusByQuarter.Q3.not_submitted.length,
      notSubmittedQ4: quarterData.statusByQuarter.Q4.not_submitted.length,
      inProgressQ1: quarterData.statusByQuarter.Q1.in_progress.length,
      inProgressQ2: quarterData.statusByQuarter.Q2.in_progress.length,
      inProgressQ3: quarterData.statusByQuarter.Q3.in_progress.length,
      inProgressQ4: quarterData.statusByQuarter.Q4.in_progress.length,
      doneQ1: quarterData.statusByQuarter.Q1.done.length,
      doneQ2: quarterData.statusByQuarter.Q2.done.length,
      doneQ3: quarterData.statusByQuarter.Q3.done.length,
      doneQ4: quarterData.statusByQuarter.Q4.done.length,
      doneDossiers,
      openDossiers,
      lastActivity: new Date().toISOString(),
    });
  });
  app.get("/api/user/customers", requireAuth, async (req, res) => {
    const user = req.user;
    if (user.role === "customer" || user.role === "organization")
      return res.status(403).json({ error: "Geen toegang" });
    const search = req.query.search ? String(req.query.search).trim() : "";
    const yearParam = req.query.year
      ? parseInt(String(req.query.year), 10)
      : null;
    const quarterParam = req.query.quarter
      ? String(req.query.quarter).trim().toUpperCase()
      : "";
    const statusParam = req.query.status
      ? String(req.query.status).trim()
      : "all";
    const allowedIds = await getAccessibleCustomerIds(user);
    let query = supabase
      .from("accounts")
      .select("id, number, name, status, created_at, last_login_at, owner_id")
      .eq("role", "customer");
    if (user.role !== "owner") {
      if (allowedIds.length > 0) {
        query = query.in("id", allowedIds);
      } else {
        query = query.eq("id", "none");
      }
    }
    const { data: customers } = await query;
    let resultList = customers || [];
    if (search) {
      const sLower = search.toLowerCase();
      resultList = resultList.filter(
        (c) =>
          (c.name && c.name.toLowerCase().includes(sLower)) ||
          (c.number && String(c.number).includes(sLower)),
      );
    }
    if (statusParam === "active" || statusParam === "blocked") {
      resultList = resultList.filter((c) => c.status === statusParam);
    }
    if (
      quarterParam ||
      yearParam ||
      statusParam === "not_submitted" ||
      statusParam === "in_progress" ||
      statusParam === "done"
    ) {
      const targetYear = yearParam || new Date().getFullYear();
      const custIds = resultList.map((c) => c.id);
      if (custIds.length > 0) {
        const { data: statusRows } = await supabase
          .from("admin_status")
          .select("customer_id, quarter, status")
          .eq("year", targetYear)
          .in("customer_id", custIds);
        const explicitMap = {};
        if (statusRows) {
          for (const row of statusRows) {
            if (!explicitMap[row.customer_id]) {
              explicitMap[row.customer_id] = {};
            }
            explicitMap[row.customer_id][row.quarter] = row.status;
          }
        }
        const { data: filesWithMeta } = await supabase
          .from("files")
          .select("customer_id, file_metadata (quarter, year)")
          .in("customer_id", custIds);
        const filesQuarterSets = {
          Q1: new Set(),
          Q2: new Set(),
          Q3: new Set(),
          Q4: new Set(),
        };
        if (filesWithMeta) {
          for (const f of filesWithMeta) {
            const custId = f.customer_id;
            const metaList = Array.isArray(f.file_metadata)
              ? f.file_metadata
              : f.file_metadata
                ? [f.file_metadata]
                : [];
            for (const meta of metaList) {
              if (meta && custId) {
                const normQ = normalizeQuarter(meta.quarter);
                const yrNum = meta.year
                  ? parseInt(String(meta.year), 10)
                  : targetYear;
                if (yrNum === targetYear && normQ && filesQuarterSets[normQ]) {
                  filesQuarterSets[normQ].add(custId);
                }
              }
            }
          }
        }
        resultList = resultList.filter((c) => {
          const getCustQuarterStatus = (q) => {
            if (explicitMap[c.id] && explicitMap[c.id][q]) {
              return explicitMap[c.id][q];
            }
            if (filesQuarterSets[q] && filesQuarterSets[q].has(c.id)) {
              return "in_progress";
            }
            return "not_submitted";
          };
          if (
            statusParam === "not_submitted" ||
            statusParam === "in_progress" ||
            statusParam === "done"
          ) {
            const quartersToCheck = quarterParam
              ? [quarterParam]
              : ["Q1", "Q2", "Q3", "Q4"];
            return quartersToCheck.some(
              (q) => getCustQuarterStatus(q) === statusParam,
            );
          }
          return true;
        });
      }
    }
    res.json({ customers: resultList });
  });
  app.get("/api/user/quarter-missing", requireAuth, async (req, res) => {
    const user = req.user;
    if (user.role === "customer" || user.role === "organization")
      return res.status(403).json({ error: "Geen toegang" });
    const quarter = req.query.quarter || "Q1";
    const yearParam = req.query.year
      ? parseInt(req.query.year)
      : new Date().getFullYear();
    const statusParam = req.query.status || "not_submitted";
    const allowedIds = await getAccessibleCustomerIds(user);
    const quarterData = await getQuarterStatusData(
      yearParam,
      user.role !== "owner" ? allowedIds : void 0,
    );
    const qData = quarterData.statusByQuarter[quarter] || {
      not_submitted: [],
      in_progress: [],
      done: [],
    };
    const selectedCustomers =
      statusParam === "done"
        ? qData.done
        : statusParam === "in_progress"
          ? qData.in_progress
          : qData.not_submitted;
    res.json({
      quarter,
      year: yearParam,
      status: statusParam,
      totalCount: quarterData.totalCount,
      notSubmittedCount: qData.not_submitted.length,
      inProgressCount: qData.in_progress.length,
      doneCount: qData.done.length,
      submittedCount: qData.done.length + qData.in_progress.length,
      missingCount: qData.not_submitted.length,
      customers: selectedCustomers,
    });
  });
  app.get("/api/user/storage", requireAuth, async (req, res) => {
    const user = req.user;
    if (user.role === "customer" || user.role === "organization")
      return res.status(403).json({ error: "Geen toegang" });
    try {
      const allowedIds = await getAccessibleCustomerIds(user);
      let query = supabase
        .from("files")
        .select(
          "id, original_name, size_bytes, created_at, customer:accounts!files_customer_id_fkey(id, number, name)",
        )
        .order("created_at", { ascending: false });
      if (user.role !== "owner") {
        if (allowedIds.length > 0) {
          query = query.in("customer_id", allowedIds);
        } else {
          query = query.eq("customer_id", "none");
        }
      }
      const { data: dbFiles, error: filesError } = await query;
      if (filesError) {
        console.error("Storage files error:", filesError);
        return res.status(500).json({ error: filesError.message });
      }
      const files = (dbFiles || []).map((f) => ({
        id: f.id,
        original_name: f.original_name,
        size_bytes: f.size_bytes || 0,
        created_at: f.created_at,
        customer: f.customer,
      }));
      const totalBytes = files.reduce((acc, f) => acc + f.size_bytes, 0);
      res.json({ totalBytes, fileCount: files.length, files });
    } catch (err) {
      console.error("User storage endpoint error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/dossier/:customerId/profile", requireAuth, async (req, res) => {
    const { customerId } = req.params;
    const user = req.user;
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Profiel niet gevonden." });
    }
    const profile = await getProfileWithFields(customerId);
    res.json({ profile: profile || {} });
  });
  const saveDossierProfile = __name(async (req, res) => {
    const { customerId } = req.params;
    const user = req.user;
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Profiel niet gevonden." });
    }
    if (user.role === "customer" || user.role === "organization") {
      return res
        .status(403)
        .json({ error: "Klanten kunnen dossierprofielen niet bewerken." });
    }
    const profileData =
      req.body && req.body.profile && typeof req.body.profile === "object"
        ? req.body.profile
        : req.body;
    const nameVal = profileData.name
      ? profileData.name
      : profileData.first_name
        ? `${profileData.first_name || ""} ${profileData.last_name || ""}`.trim()
        : void 0;
    const updates: any = {};
    if (nameVal) updates.name = nameVal;
    try {
      if (Object.keys(updates).length > 0) {
        await supabase.from("accounts").update(updates).eq("id", customerId);
      }
    } catch (e) {}
    await syncProfileFields(customerId, profileData);
    const profile = await getProfileWithFields(customerId);
    res.json({ ok: true, profile: profile || {} });
  }, "saveDossierProfile");
  app.post("/api/dossier/:customerId/profile", requireAuth, saveDossierProfile);
  app.put("/api/dossier/:customerId/profile", requireAuth, saveDossierProfile);
  app.get("/api/customer/profile", requireAuth, async (req, res) => {
    const user = req.user;
    const profile = await getProfileWithFields(user.id);
    res.json({ profile: profile || {} });
  });
  const saveCustomerProfile = __name(async (req, res) => {
    const user = req.user;
    const profileData =
      req.body && req.body.profile && typeof req.body.profile === "object"
        ? req.body.profile
        : req.body;
    const nameVal = profileData.name
      ? profileData.name
      : profileData.first_name
        ? `${profileData.first_name || ""} ${profileData.last_name || ""}`.trim()
        : void 0;
    const updates: any = {};
    if (nameVal) updates.name = nameVal;
    try {
      if (Object.keys(updates).length > 0) {
        await supabase.from("accounts").update(updates).eq("id", user.id);
      }
    } catch (e) {}
    await syncProfileFields(user.id, profileData);
    const profile = await getProfileWithFields(user.id);
    res.json({ ok: true, profile: profile || {} });
  }, "saveCustomerProfile");
  app.post("/api/customer/profile", requireAuth, saveCustomerProfile);
  app.put("/api/customer/profile", requireAuth, saveCustomerProfile);
  app.get("/api/customer/my-bookkeeper", requireAuth, async (req, res) => {
    const user = req.user;
    if (user.role !== "customer") {
      return res
        .status(403)
        .json({ error: "Alleen klanten kunnen hun boekhouder opvragen." });
    }
    try {
      const { data: customerAcc, error: customerErr } = await supabase
        .from("accounts")
        .select("owner_id")
        .eq("id", user.id)
        .single();
      if (customerErr || !customerAcc || !customerAcc.owner_id) {
        return res.json({ bookkeeper: null });
      }
      const { data: ownerAcc, error: ownerErr } = await supabase
        .from("accounts")
        .select("name, number")
        .eq("id", customerAcc.owner_id)
        .single();
      if (ownerErr || !ownerAcc) {
        return res.json({ bookkeeper: null });
      }
      res.json({
        bookkeeper: { name: ownerAcc.name, number: ownerAcc.number },
      });
    } catch (err) {
      console.error("Error retrieving bookkeeper:", err);
      res
        .status(500)
        .json({ error: "Interne serverfout bij ophalen van boekhouder." });
    }
  });
  app.get("/api/dossier/:customerId/btw", requireAuth, async (req, res) => {
    const { customerId } = req.params;
    const user = req.user;
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }
    const { data: calculations, error } = await supabase
      .from("btw_calculations")
      .select("*")
      .eq("customer_id", customerId)
      .order("calc_date", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ calculations: calculations || [] });
  });
  app.post("/api/dossier/:customerId/btw", requireAuth, async (req, res) => {
    const { customerId } = req.params;
    const user = req.user;
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }
    if (user.role === "customer" || user.role === "organization") {
      return res
        .status(403)
        .json({ error: "Klanten kunnen geen berekeningen opslaan." });
    }
    const bodyData = req.body;
    const { data: saved, error } = await supabase
      .from("btw_calculations")
      .insert({
        customer_id: customerId,
        user_id: user.id,
        quarter: bodyData.quarter || "Q1",
        year: bodyData.year || new Date().getFullYear(),
        total_inc_21: bodyData.total_inc_21 || bodyData.totaal_incl_21 || 0,
        total_exc_21: bodyData.total_exc_21 || bodyData.totaal_excl_21 || 0,
        total_inc_9: bodyData.total_inc_9 || bodyData.totaal_incl_9 || 0,
        total_exc_9: bodyData.total_exc_9 || bodyData.totaal_excl_9 || 0,
        btw_to_reclaim: bodyData.btw_to_reclaim || bodyData.btw_eindsaldo || 0,
        explanation: bodyData.explanation || JSON.stringify(bodyData),
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, calculation: saved });
  });
  const deleteBtwHandler = __name(async (req, res) => {
    const { calcId } = req.params;
    const user = req.user;
    if (!(await canAccessBtwCalcId(user, calcId))) {
      return res.status(404).json({ error: "Berekening niet gevonden." });
    }
    if (user.role === "customer" || user.role === "organization") {
      return res
        .status(403)
        .json({ error: "Klanten kunnen geen berekeningen verwijderen." });
    }
    const { error } = await supabase
      .from("btw_calculations")
      .delete()
      .eq("id", calcId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  }, "deleteBtwHandler");
  app.post("/api/dossier/btw/:calcId/delete", requireAuth, deleteBtwHandler);
  app.delete("/api/dossier/btw/:calcId", requireAuth, deleteBtwHandler);
  app.post("/api/auth/system-init", async (req, res) => {
    console.log("system-init called");
    try {
      const { name, number, password } = req.body;
      if (!number || !password || !name) {
        return res
          .status(400)
          .json({ error: "Naam, nummer en wachtwoord zijn verplicht." });
      }
      const { count, error: countError } = await supabase
        .from("accounts")
        .select("id", { count: "exact", head: true });
      if (countError) {
        console.error("system-init count error:", countError);
        return res
          .status(500)
          .json({ error: "Interne serverfout tijdens initialisatie-check" });
      } else if (count !== null && count !== 0) {
        console.log("System already initialized, count:", count);
        return res
          .status(403)
          .json({ error: "Systeem is al ge\xEFnitialiseerd." });
      }
      const cleanPassword = String(password).trim();
      const hash = await bcrypt.hash(cleanPassword, 10);
      const { data: account, error: accError } = await supabase
        .from("accounts")
        .insert({
          number: String(number),
          name: String(name),
          role: "owner",
          status: "active",
        })
        .select()
        .single();
      if (accError || !account) {
        console.error("system-init insert error:", accError);
        return res
          .status(500)
          .json({ error: accError?.message || "Fout bij aanmaken eigenaar." });
      }
      const { error: credError } = await supabase
        .from("credentials")
        .insert({ account_id: account.id, password_hash: hash });
      if (credError) {
        console.error("system-init credentials insert error:", credError);
        await supabase.from("accounts").delete().eq("id", account.id);
        return res
          .status(500)
          .json({ error: "Fout bij opslaan van inloggegevens." });
      }
      console.log("Owner created successfully with ID:", account.id);
      const { token, expiresAt } = await createSession(account.id, 5);
      res.json({
        ok: true,
        token,
        account: {
          id: account.id,
          number: account.number,
          name: account.name,
          role: account.role,
          status: account.status,
        },
        expires_at: expiresAt,
      });
    } catch (err) {
      console.error("system-init unexpected error:", err);
      res.status(500).json({ error: "Interne serverfout." });
    }
  });
  app.post("/api/purge", requireAuth, async (req, res) => {
    if (req.user.role !== "owner")
      return res.status(403).json({ error: "Geen toegang" });
    if (process.env.NODE_ENV === "production" && !process.env.ALLOW_PURGE) {
      return res
        .status(403)
        .json({ error: "Purge is uitgeschakeld op deze omgeving." });
    }
    const { password } = req.body || {};
    if (!password) {
      return res
        .status(400)
        .json({
          error: "Wachtwoord is verplicht ter bevestiging van de opschoning.",
        });
    }
    const { data: ownerCred } = await supabase
      .from("credentials")
      .select("password_hash")
      .eq("account_id", req.user.id)
      .single();
    if (
      !ownerCred ||
      !(await comparePassword(password, ownerCred.password_hash))
    ) {
      return res.status(401).json({ error: "Onjuist wachtwoord." });
    }
    try {
      await supabase
        .from("notifications")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase
        .from("communications")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase
        .from("files")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase
        .from("credentials")
        .delete()
        .neq("account_id", req.user.id);
      await supabase.from("sessions").delete().neq("account_id", req.user.id);
      await supabase.from("accounts").delete().neq("id", req.user.id);
      res.json({ purged: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Purge mislukt." });
    }
  });
  app.get(
    "/api/dossier/:customerId/analysis",
    requireAuth,
    async (req, res) => {
      const { customerId } = req.params;
      const user = req.user;
      if (!(await canAccessCustomer(user, customerId))) {
        return res.status(404).json({ error: "Dossier niet gevonden." });
      }
      res.json({ analysis: null });
    },
  );
  app.post(
    "/api/dossier/:customerId/analyze",
    requireAuth,
    async (req, res) => {
      const { customerId } = req.params;
      const user = req.user;
      if (!(await canAccessCustomer(user, customerId))) {
        return res.status(404).json({ error: "Dossier niet gevonden." });
      }
      res.json({ analysis: null });
    },
  );
  app.post(
    "/api/dossier/:customerId/analyze-clarify",
    requireAuth,
    async (req, res) => {
      const { customerId } = req.params;
      const user = req.user;
      if (!(await canAccessCustomer(user, customerId))) {
        return res.status(404).json({ error: "Dossier niet gevonden." });
      }
      res.json({ analysis: null });
    },
  );
  app.post(
    "/api/dossier/analysis/items/:itemId/adjust",
    requireAuth,
    async (req, res) => {
      res.json({ ok: true });
    },
  );
  app.get(
    "/api/dossier/analysis/items/:itemId/adjustments",
    requireAuth,
    async (req, res) => {
      res.json({ adjustments: [] });
    },
  );
  app.get("/api/organization/dashboard", requireAuth, async (req, res) => {
    if (req.user.role !== "organization")
      return res.status(403).json({ error: "Geen toegang" });
    const { data: users } = await supabase
      .from("accounts")
      .select("id, status")
      .eq("role", "user")
      .eq("owner_id", req.user.id);
    const activeUsers = users?.filter((u) => u.status === "active").length || 0;
    const userIds = users?.map((u) => u.id) || [];
    let custs = [];
    if (userIds.length > 0) {
      const { data } = await supabase
        .from("accounts")
        .select("id, status, owner_id")
        .eq("role", "customer")
        .in("owner_id", userIds);
      custs = data || [];
    }
    const totalCustomers = custs.length;
    const distributionMap = {};
    custs.forEach((c) => {
      distributionMap[c.owner_id] = (distributionMap[c.owner_id] || 0) + 1;
    });
    const { data: userDetails } = await supabase
      .from("accounts")
      .select("id, name")
      .in("id", userIds);
    const customerDistribution =
      userDetails?.map((u) => ({
        id: u.id,
        name: u.name,
        count: distributionMap[u.id] || 0,
      })) || [];
    const customerIds = custs.map((c) => c.id);
    const orgAccountIds = [req.user.id, ...userIds, ...customerIds];
    const { data: warnings } = await supabase
      .from("access_logs")
      .select("id, metadata")
      .in("account_id", orgAccountIds)
      .in("event", [
        "login_failed",
        "login_blocked",
        "account_blocked",
        "customer_blocked",
        "unauthorized_access",
        "user_password_reset",
        "user_2fa_reset",
      ]);
    const activeWarningsCount = (warnings || []).filter((w) => {
      const meta = w.metadata || {};
      return meta.status !== "Opgelost";
    }).length;
    const { data: recentActivity } = await supabase
      .from("access_logs")
      .select("*")
      .in("account_id", orgAccountIds)
      .order("created_at", { ascending: false })
      .limit(20);
    res.json({
      totalCustomers,
      activeUsers,
      pendingActions: activeWarningsCount,
      recentActivity: recentActivity || [],
      customerDistribution,
    });
  });
  app.get(
    "/api/organization/security-warnings",
    requireAuth,
    async (req, res) => {
      if (req.user.role !== "organization")
        return res.status(403).json({ error: "Geen toegang" });
      try {
        const { data: users } = await supabase
          .from("accounts")
          .select("id, name, number, role")
          .eq("owner_id", req.user.id)
          .eq("role", "user");
        const userIds = users?.map((u) => u.id) || [];
        let customers = [];
        let customerIds = [];
        if (userIds.length > 0) {
          const { data } = await supabase
            .from("accounts")
            .select("id, name, number, role")
            .eq("role", "customer")
            .in("owner_id", userIds);
          customers = data || [];
          customerIds = customers.map((c) => c.id);
        }
        const orgAccountIds = [req.user.id, ...userIds, ...customerIds];
        const { data: logs, error } = await supabase
          .from("access_logs")
          .select("*")
          .in("account_id", orgAccountIds)
          .in("event", [
            "login_failed",
            "login_blocked",
            "account_blocked",
            "customer_blocked",
            "unauthorized_access",
            "user_password_reset",
            "user_2fa_reset",
          ])
          .order("created_at", { ascending: false });
        if (error) {
          console.error("Error fetching security warnings:", error);
          return res
            .status(500)
            .json({
              error: "Fout bij ophalen van beveiligingswaarschuwingen.",
            });
        }
        const accountMap = new Map();
        accountMap.set(req.user.id, {
          name: req.user.name || "Mijn Organisatie",
          number: req.user.number || "\u2014",
          role: "organization",
        });
        users?.forEach((u) =>
          accountMap.set(u.id, {
            name: u.name,
            number: u.number,
            role: "user",
          }),
        );
        customers.forEach((c) =>
          accountMap.set(c.id, {
            name: c.name,
            number: c.number,
            role: "customer",
          }),
        );
        const mappedWarnings = (logs || []).map((l) => {
          const acc = accountMap.get(l.account_id) || {
            name: `Onbekend (${l.account_number || "\u2014"})`,
            number: l.account_number || "\u2014",
            role: "unknown",
          };
          const meta = l.metadata || {};
          const status = meta.status || "Nieuw";
          let severity = "Warning";
          if (
            [
              "unauthorized_access",
              "account_blocked",
              "customer_blocked",
            ].includes(l.event)
          ) {
            severity = "Critical";
          } else if (
            l.event === "login_blocked" ||
            (l.event === "login_failed" && meta.failed_attempts >= 5)
          ) {
            severity = "High";
          }
          return {
            id: l.id,
            event: l.event,
            created_at: l.created_at,
            account_id: l.account_id,
            account_name: acc.name,
            account_number: acc.number,
            account_role: acc.role,
            ip: l.ip || "127.0.0.1",
            severity,
            status,
            metadata: meta,
          };
        });
        res.json({ warnings: mappedWarnings });
      } catch (err) {
        console.error("Fout in GET /api/organization/security-warnings:", err);
        res.status(500).json({ error: err.message });
      }
    },
  );
  app.post(
    "/api/organization/security-warnings/:id/status",
    requireAuth,
    async (req, res) => {
      if (req.user.role !== "organization")
        return res.status(403).json({ error: "Geen toegang" });
      const { id } = req.params;
      const { status } = req.body;
      if (!["Nieuw", "In behandeling", "Opgelost"].includes(status)) {
        return res.status(400).json({ error: "Ongeldige status." });
      }
      try {
        const { data: log, error: logErr } = await supabase
          .from("access_logs")
          .select("*")
          .eq("id", id)
          .single();
        if (logErr || !log) {
          return res
            .status(404)
            .json({ error: "Beveiligingswaarschuwing niet gevonden." });
        }
        const { data: users } = await supabase
          .from("accounts")
          .select("id")
          .eq("owner_id", req.user.id)
          .eq("role", "user");
        const userIds = users?.map((u) => u.id) || [];
        let customerIds = [];
        if (userIds.length > 0) {
          const { data } = await supabase
            .from("accounts")
            .select("id")
            .eq("role", "customer")
            .in("owner_id", userIds);
          customerIds = (data || []).map((c) => c.id);
        }
        const orgAccountIds = [req.user.id, ...userIds, ...customerIds];
        if (!orgAccountIds.includes(log.account_id)) {
          return res
            .status(403)
            .json({
              error: "U heeft geen toegang tot deze beveiligingswaarschuwing.",
            });
        }
        const currentMeta = log.metadata || {};
        const updatedMeta = { ...currentMeta, status };
        const { error: updateErr } = await supabase
          .from("access_logs")
          .update({ metadata: updatedMeta })
          .eq("id", id);
        if (updateErr) {
          console.error("Error updating warning status:", updateErr);
          return res.status(500).json({ error: "Fout bij bijwerken status." });
        }
        res.json({ ok: true, status });
      } catch (err) {
        console.error(
          "Fout in POST /api/organization/security-warnings/:id/status:",
          err,
        );
        res.status(500).json({ error: err.message });
      }
    },
  );
  app.get("/api/organization/users", requireAuth, async (req, res) => {
    if (req.user.role !== "organization")
      return res.status(403).json({ error: "Geen toegang" });
    const { data: users } = await supabase
      .from("accounts")
      .select("id, number, name, status, last_login_at")
      .eq("role", "user")
      .eq("owner_id", req.user.id);
    const userIds = users?.map((u) => u.id) || [];
    let custs = [];
    if (userIds.length > 0) {
      const { data } = await supabase
        .from("accounts")
        .select("id, owner_id")
        .eq("role", "customer")
        .in("owner_id", userIds);
      custs = data || [];
    }
    const enriched =
      users?.map((u) => ({
        ...u,
        customerCount: custs.filter((c) => c.owner_id === u.id).length,
      })) || [];
    res.json({ users: enriched });
  });
  app.get("/api/organization/customers", requireAuth, async (req, res) => {
    if (req.user.role !== "organization")
      return res.status(403).json({ error: "Geen toegang" });
    const { data: orgUsers } = await supabase
      .from("accounts")
      .select("id, name")
      .eq("role", "user")
      .eq("owner_id", req.user.id);
    const userIds = orgUsers?.map((u) => u.id) || [];
    const userMap = new Map(orgUsers?.map((u) => [u.id, u.name]));
    let customers = [];
    if (userIds.length > 0) {
      const { data } = await supabase
        .from("accounts")
        .select("id, number, name, status, created_at, last_login_at, owner_id")
        .eq("role", "customer")
        .in("owner_id", userIds);
      const baseCustomers = data || [];
      const customerIds = baseCustomers.map((c) => c.id);
      const quarterData = await getQuarterStatusData(
        void 0,
        customerIds.length > 0 ? customerIds : ["none"],
      );
      customers = baseCustomers.map((c) => {
        const statuses = {
          Q1: quarterData.statusByQuarter.Q1.done.some((x) => x.id === c.id)
            ? "done"
            : quarterData.statusByQuarter.Q1.in_progress.some(
                  (x) => x.id === c.id,
                )
              ? "in_progress"
              : "not_submitted",
          Q2: quarterData.statusByQuarter.Q2.done.some((x) => x.id === c.id)
            ? "done"
            : quarterData.statusByQuarter.Q2.in_progress.some(
                  (x) => x.id === c.id,
                )
              ? "in_progress"
              : "not_submitted",
          Q3: quarterData.statusByQuarter.Q3.done.some((x) => x.id === c.id)
            ? "done"
            : quarterData.statusByQuarter.Q3.in_progress.some(
                  (x) => x.id === c.id,
                )
              ? "in_progress"
              : "not_submitted",
          Q4: quarterData.statusByQuarter.Q4.done.some((x) => x.id === c.id)
            ? "done"
            : quarterData.statusByQuarter.Q4.in_progress.some(
                  (x) => x.id === c.id,
                )
              ? "in_progress"
              : "not_submitted",
        };
        return {
          ...c,
          assignedUser: userMap.get(c.owner_id) || "Onbekend",
          statuses,
        };
      });
    }
    res.json({ customers });
  });
  app.get(
    "/api/organization/eligible-transfer-users",
    requireAuth,
    async (req, res) => {
      if (req.user.role !== "user" && req.user.role !== "organization") {
        return res.status(403).json({ error: "Geen toegang" });
      }
      const orgId =
        req.user.role === "organization" ? req.user.id : req.user.owner_id;
      if (!orgId) {
        return res
          .status(403)
          .json({ error: "Een losse gebruiker mag geen klanten overdragen." });
      }
      const { data: orgAcc } = await supabase
        .from("accounts")
        .select("id, role")
        .eq("id", orgId)
        .single();
      if (!orgAcc || orgAcc.role !== "organization") {
        return res
          .status(403)
          .json({ error: "Een losse gebruiker mag geen klanten overdragen." });
      }
      const { data: users, error } = await supabase
        .from("accounts")
        .select("id, name, number, role, status")
        .eq("status", "active")
        .eq("role", "user")
        .eq("owner_id", orgId)
        .neq("id", req.user.id);
      if (error) {
        return res.status(500).json({ error: error.message });
      }
      const validUsers = (users || []).filter(
        (u) => !String(u.number).startsWith("2"),
      );
      res.json({ users: validUsers });
    },
  );
  app.post(
    "/api/user/customers/:customerId/transfer",
    requireAuth,
    async (req, res) => {
      if (req.user.role !== "user") {
        return res.status(403).json({ error: "Geen toegang" });
      }
      const { customerId } = req.params;
      const { receiverUserId } = req.body;
      if (!customerId || !receiverUserId) {
        return res
          .status(400)
          .json({ error: "Klant en doelgebruiker zijn verplicht." });
      }
      if (receiverUserId === req.user.id) {
        return res
          .status(403)
          .json({
            error:
              "Overdracht geweigerd: u kunt een klant niet overdragen aan uzelf.",
          });
      }
      const senderOrgId =
        req.user.role === "organization" ? req.user.id : req.user.owner_id;
      if (!senderOrgId) {
        return res
          .status(403)
          .json({ error: "Een losse gebruiker mag geen klanten overdragen." });
      }
      const { data: senderOrgAcc } = await supabase
        .from("accounts")
        .select("id, role")
        .eq("id", senderOrgId)
        .single();
      if (!senderOrgAcc || senderOrgAcc.role !== "organization") {
        return res
          .status(403)
          .json({ error: "Een losse gebruiker mag geen klanten overdragen." });
      }
      const { data: customer, error: custErr } = await supabase
        .from("accounts")
        .select("id, number, name, owner_id, role")
        .eq("id", customerId)
        .single();
      if (custErr || !customer || customer.role !== "customer") {
        return res.status(404).json({ error: "Klant niet gevonden." });
      }
      let customerOrgId = null;
      if (customer.owner_id) {
        const { data: custOwner } = await supabase
          .from("accounts")
          .select("id, owner_id, number")
          .eq("id", customer.owner_id)
          .single();
        if (custOwner) {
          if (String(custOwner.number).startsWith("2")) {
            customerOrgId = custOwner.id;
          } else {
            customerOrgId = custOwner.owner_id;
          }
        }
      }
      if (customerOrgId !== senderOrgId) {
        return res
          .status(403)
          .json({
            error:
              "Overdracht geweigerd: deze klant behoort niet tot uw organisatie.",
          });
      }
      const { data: targetUser, error: targetErr } = await supabase
        .from("accounts")
        .select("id, number, name, role, status, owner_id")
        .eq("id", receiverUserId)
        .single();
      if (targetErr || !targetUser) {
        return res.status(404).json({ error: "Doelgebruiker niet gevonden." });
      }
      if (targetUser.status !== "active") {
        return res
          .status(403)
          .json({
            error:
              "Overdracht geweigerd: de geselecteerde doelgebruiker is niet actief.",
          });
      }
      if (
        targetUser.role !== "user" ||
        String(targetUser.number).startsWith("2")
      ) {
        return res
          .status(403)
          .json({
            error:
              "Overdracht geweigerd: een klant kan alleen aan een actieve boekhouder worden toegewezen, niet aan een organisatie, eigenaar of klant.",
          });
      }
      if (targetUser.owner_id !== senderOrgId) {
        return res
          .status(403)
          .json({
            error:
              "Overdracht geweigerd: de doelgebruiker behoort niet tot exact dezelfde organisatie als u en de klant.",
          });
      }
      const { error: updateErr } = await supabase
        .from("accounts")
        .update({
          owner_id: receiverUserId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", customerId);
      if (updateErr) {
        return res
          .status(500)
          .json({ error: "Fout bij bijwerken klantverantwoordelijke." });
      }
      await supabase
        .from("access_logs")
        .insert({
          account_id: customerId,
          account_number: customer.number,
          event: "customer_transferred",
          ip: req.ip || "127.0.0.1",
          metadata: {
            from_user_id: req.user.id,
            to_user_id: receiverUserId,
            previous_owner_id: customer.owner_id,
            organization_id: senderOrgId,
          },
        });
      res.json({
        ok: true,
        message: `Klant ${customer.name} is succesvol overgedragen aan ${targetUser.name}.`,
      });
    },
  );
  app.get("/api/organization/settings", requireAuth, async (req, res) => {
    try {
      const { data: setRec } = await supabase
        .from("settings")
        .select("*")
        .eq("id", 1)
        .single();
      const settings = setRec || {
        id: 1,
        max_customer_accounts_per_batch: 50,
        max_upload_bytes: 52428800,
        session_lifetime_hours: 24,
        max_login_attempts: 5,
        retention_years: 7,
      };
      res.json(settings);
    } catch (err) {
      console.error("Error reading organization settings:", err);
      res.json({
        id: 1,
        max_customer_accounts_per_batch: 50,
        max_upload_bytes: 52428800,
        session_lifetime_hours: 24,
        max_login_attempts: 5,
        retention_years: 7,
      });
    }
  });
  app.post("/api/organization/settings", requireAuth, async (req, res) => {
    if (req.user.role !== "owner") {
      return res
        .status(403)
        .json({
          error:
            "Geen toegang: Uitsluitend de eigenaar heeft toegang tot deze instellingen.",
        });
    }
    const {
      max_customers_per_batch,
      max_upload_bytes,
      session_lifetime_hours,
      max_login_attempts,
      retention_years,
    } = req.body;
    const { data: updated, error } = await supabase
      .from("settings")
      .upsert({
        id: 1,
        max_customer_accounts_per_batch: Number(max_customers_per_batch) || 50,
        max_upload_bytes: Number(max_upload_bytes) || 52428800,
        session_lifetime_hours: Number(session_lifetime_hours) || 24,
        max_login_attempts: Number(max_login_attempts) || 5,
        retention_years: Number(retention_years) || 7,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(updated);
  });
  app.post("/api/user/delete-customer", requireAuth, async (req, res) => {
    if (req.user.role !== "user" && req.user.role !== "organization")
      return res.status(403).json({ error: "Geen toegang" });
    const { customerId } = req.body;
    if (!customerId)
      return res.status(400).json({ error: "Klant ID is verplicht" });
    const hasAccess = await canAccessCustomer(req.user, customerId);
    if (!hasAccess)
      return res
        .status(403)
        .json({ error: "U heeft geen toestemming voor deze klant." });
    await supabase.from("sessions").delete().eq("account_id", customerId);
    await supabase.from("credentials").delete().eq("account_id", customerId);
    await supabase.from("accounts").delete().eq("id", customerId);
    await supabase
      .from("access_logs")
      .insert({
        account_id: req.user.id,
        event: "customer_deleted",
        ip: req.ip || "127.0.0.1",
        metadata: { customerId },
      });
    res.json({ ok: true });
  });
  app.post("/api/user/unblock-customer", requireAuth, async (req, res) => {
    if (req.user.role !== "user" && req.user.role !== "organization")
      return res.status(403).json({ error: "Geen toegang" });
    const { customerId } = req.body;
    if (!customerId)
      return res.status(400).json({ error: "Klant ID is verplicht" });
    const hasAccess = await canAccessCustomer(req.user, customerId);
    if (!hasAccess)
      return res
        .status(403)
        .json({ error: "U heeft geen toestemming voor deze klant." });
    await supabase
      .from("accounts")
      .update({ status: "active" })
      .eq("id", customerId);
    await supabase
      .from("access_logs")
      .insert({
        account_id: req.user.id,
        event: "customer_unblocked",
        ip: req.ip || "127.0.0.1",
        metadata: { customerId },
      });
    res.json({ ok: true });
  });
  app.post("/api/user/create-customers", requireAuth, async (req, res) => {
    if (req.user.role !== "user") {
      return res.status(403).json({ error: "Geen toegang" });
    }
    const { count } = req.body;
    const targetOwnerId = req.user.id;
    let maxAllowed = 50;
    const { data: platformSet } = await supabase
      .from("settings")
      .select("max_customer_accounts_per_batch")
      .eq("id", 1)
      .single();
    if (platformSet && platformSet.max_customer_accounts_per_batch) {
      maxAllowed = platformSet.max_customer_accounts_per_batch;
    }
    if (count > maxAllowed) {
      return res
        .status(400)
        .json({
          error: `U mag maximaal ${maxAllowed} klanten per keer aanmaken.`,
        });
    }
    const created = [];
    for (let i = 0; i < (count || 1); i++) {
      const number = await generateUniqueCustomerNumber();
      const tempPassword = generateSecureCustomerPassword();
      const hash = await bcrypt.hash(tempPassword, 10);
      const { data: account, error: accErr } = await supabase
        .from("accounts")
        .insert({
          number,
          name: `Klant ${number}`,
          role: "customer",
          status: "active",
          owner_id: targetOwnerId,
        })
        .select()
        .single();
      if (!accErr && account) {
        const { error: credErr } = await supabase
          .from("credentials")
          .insert({ account_id: account.id, password_hash: hash });
        if (credErr) {
          console.error("Error creating credentials for customer:", credErr);
          await supabase.from("accounts").delete().eq("id", account.id);
          continue;
        }
        created.push({
          number: account.number,
          name: account.name,
          tempPassword,
        });
      } else if (accErr) {
        console.error("Error creating customer account:", accErr);
      }
    }
    res.json({ created, count: created.length });
  });
  app.get("/api/transfers", requireAuth, async (req, res) => {
    if (req.user.role !== "user") {
      return res.status(403).json({ error: "Geen toegang" });
    }
    const { data: list } = await supabase
      .from("transfers")
      .select("*")
      .or(
        `sender_user_id.eq.${req.user.id},receiver_user_id.eq.${req.user.id}`,
      );
    const enriched = [];
    for (const item of list || []) {
      const { data: customer } = await supabase
        .from("accounts")
        .select("id, name, number")
        .eq("id", item.customer_id)
        .single();
      const { data: sender } = await supabase
        .from("accounts")
        .select("id, name, number")
        .eq("id", item.sender_user_id)
        .single();
      const { data: receiver } = await supabase
        .from("accounts")
        .select("id, name, number")
        .eq("id", item.receiver_user_id)
        .single();
      enriched.push({
        ...item,
        customer: customer || {
          id: item.customer_id,
          name: "Onbekend",
          number: "",
        },
        sender: sender || {
          id: item.sender_user_id,
          name: "Onbekend",
          number: "",
        },
        receiver: receiver || {
          id: item.receiver_user_id,
          name: "Onbekend",
          number: "",
        },
      });
    }
    res.json({ transfers: enriched });
  });
  app.post("/api/transfers", requireAuth, async (req, res) => {
    if (req.user.role !== "user") {
      return res.status(403).json({ error: "Geen toegang" });
    }
    const { customerId, receiverUserId } = req.body;
    if (!customerId || !receiverUserId) {
      return res.status(400).json({ error: "Ontbrekende velden" });
    }
    const hasAccess = await canAccessCustomer(req.user, customerId);
    if (!hasAccess) {
      return res
        .status(403)
        .json({ error: "U heeft geen toestemming voor deze klant." });
    }
    const { data: customer } = await supabase
      .from("accounts")
      .select("id, owner_id, role")
      .eq("id", customerId)
      .single();
    const { data: targetUser } = await supabase
      .from("accounts")
      .select("id, status, role, owner_id")
      .eq("id", receiverUserId)
      .single();
    if (!customer || customer.role !== "customer") {
      return res.status(404).json({ error: "Klant niet gevonden." });
    }
    if (!targetUser || targetUser.status !== "active") {
      return res
        .status(404)
        .json({ error: "Doelgebruiker niet gevonden of niet actief." });
    }
    const senderOrgId =
      req.user.role === "organization" ? req.user.id : req.user.owner_id;
    if (!senderOrgId) {
      return res
        .status(403)
        .json({ error: "Een losse gebruiker mag geen klanten overdragen." });
    }
    const { data: senderOrgAcc } = await supabase
      .from("accounts")
      .select("id, role")
      .eq("id", senderOrgId)
      .single();
    if (!senderOrgAcc || senderOrgAcc.role !== "organization") {
      return res
        .status(403)
        .json({ error: "Een losse gebruiker mag geen klanten overdragen." });
    }
    const targetOrgId =
      targetUser.role === "organization" ? targetUser.id : targetUser.owner_id;
    if (targetOrgId !== senderOrgId && targetUser.id !== senderOrgId) {
      return res
        .status(403)
        .json({
          error:
            "Overdracht geweigerd: doelgebruiker behoort niet tot dezelfde organisatie.",
        });
    }
    const { data: request, error: insErr } = await supabase
      .from("transfers")
      .insert({
        sender_user_id: req.user.id,
        receiver_user_id: receiverUserId,
        customer_id: customerId,
        status: "pending_receiver",
      })
      .select()
      .single();
    if (insErr) return res.status(500).json({ error: insErr.message });
    res.json({ ok: true, transfer: request });
  });
  app.post("/api/transfers/:id/action", requireAuth, async (req, res) => {
    if (req.user.role !== "user") {
      return res.status(403).json({ error: "Geen toegang" });
    }
    const { id } = req.params;
    const { action } = req.body;
    const { data: request } = await supabase
      .from("transfers")
      .select("*")
      .eq("id", id)
      .single();
    if (!request) {
      return res
        .status(404)
        .json({ error: "Overdrachtsverzoek niet gevonden" });
    }
    if (action === "cancel") {
      if (request.sender_user_id !== req.user.id) {
        return res
          .status(403)
          .json({ error: "Alleen de verzender kan dit verzoek annuleren." });
      }
      await supabase
        .from("transfers")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", id);
      return res.json({ ok: true });
    }
    if (action === "approve") {
      if (request.receiver_user_id !== req.user.id) {
        return res
          .status(403)
          .json({ error: "Alleen de ontvanger kan dit verzoek goedkeuren." });
      }
      await supabase
        .from("transfers")
        .update({
          status: "pending_customer",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      return res.json({ ok: true });
    }
    if (action === "decline") {
      if (request.receiver_user_id !== req.user.id) {
        return res
          .status(403)
          .json({ error: "Alleen de ontvanger kan dit verzoek afwijzen." });
      }
      await supabase
        .from("transfers")
        .update({
          status: "declined_receiver",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: "Ongeldige actie" });
  });
  app.get("/api/customer/transfers", requireAuth, async (req, res) => {
    if (req.user.role !== "customer") {
      return res.status(403).json({ error: "Geen toegang" });
    }
    const { data: list } = await supabase
      .from("transfers")
      .select("*")
      .eq("customer_id", req.user.id)
      .eq("status", "pending_customer");
    const enriched = [];
    for (const item of list || []) {
      const { data: sender } = await supabase
        .from("accounts")
        .select("id, name, number")
        .eq("id", item.sender_user_id)
        .single();
      const { data: receiver } = await supabase
        .from("accounts")
        .select("id, name, number")
        .eq("id", item.receiver_user_id)
        .single();
      enriched.push({
        ...item,
        sender: sender || {
          id: item.sender_user_id,
          name: "Onbekend",
          number: "",
        },
        receiver: receiver || {
          id: item.receiver_user_id,
          name: "Onbekend",
          number: "",
        },
      });
    }
    res.json({ transfers: enriched });
  });
  app.post(
    "/api/customer/transfers/:id/action",
    requireAuth,
    async (req, res) => {
      if (req.user.role !== "customer") {
        return res.status(403).json({ error: "Geen toegang" });
      }
      const { id } = req.params;
      const { action } = req.body;
      const { data: request } = await supabase
        .from("transfers")
        .select("*")
        .eq("id", id)
        .single();
      if (
        !request ||
        request.customer_id !== req.user.id ||
        request.status !== "pending_customer"
      ) {
        return res
          .status(404)
          .json({ error: "Geen lopend overdrachtsverzoek gevonden." });
      }
      if (action === "decline") {
        await supabase
          .from("transfers")
          .update({
            status: "declined_customer",
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);
        return res.json({ ok: true });
      }
      if (action === "approve") {
        const { data: receiverUser } = await supabase
          .from("accounts")
          .select("id, status, role, owner_id")
          .eq("id", request.receiver_user_id)
          .single();
        const { data: senderUser } = await supabase
          .from("accounts")
          .select("id, role, owner_id")
          .eq("id", request.sender_user_id)
          .single();
        if (!receiverUser || receiverUser.status !== "active") {
          return res
            .status(400)
            .json({ error: "Doelgebruiker is niet meer actief." });
        }
        const senderOrgId =
          senderUser?.role === "organization"
            ? senderUser.id
            : senderUser?.owner_id;
        const receiverOrgId =
          receiverUser.role === "organization"
            ? receiverUser.id
            : receiverUser.owner_id;
        if (
          !senderOrgId ||
          (receiverOrgId !== senderOrgId && receiverUser.id !== senderOrgId)
        ) {
          return res
            .status(403)
            .json({
              error:
                "Overdracht geweigerd: de ontvanger behoort niet tot de organisatie van deze klant.",
            });
        }
        const { error } = await supabase
          .from("accounts")
          .update({
            owner_id: request.receiver_user_id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", request.customer_id);
        if (error) {
          return res
            .status(500)
            .json({
              error: "Fout bij bijwerken van de eigenaar: " + error.message,
            });
        }
        await supabase
          .from("transfers")
          .update({ status: "completed", updated_at: new Date().toISOString() })
          .eq("id", id);
        return res.json({ ok: true });
      }
      res.status(400).json({ error: "Ongeldige actie" });
    },
  );
  app.use("/api", (req, res) => {
    res.status(404).json({ error: "Route niet gevonden." });
  });
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = require("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  if (!process.env.NETLIFY) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}
export const serverPromise = startServer();
__name(startServer, "startServer");
if (!process.env.NETLIFY) {
  serverPromise.catch((err) => {
    console.error("Server startup error:", err);
  });
}

export const handler = serverless(app);
