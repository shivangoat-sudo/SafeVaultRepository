import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { OTP } from "otplib";
import QRCode from "qrcode";
import { supabase } from "./src/server/lib/supabase.js";

const otpInstance = new OTP();

const authenticator = {
  options: { window: 1 },
  generateSecret(length = 20) {
    return otpInstance.generateSecret(length);
  },
  keyuri(label: string, issuer: string, secret: string) {
    return otpInstance.generateURI({ secret, label, issuer });
  },
  verify({ token, secret }: { token: string; secret: string }) {
    const windowVal = this.options.window ?? 1;
    const epochTolerance = windowVal * 30;
    return otpInstance.verifySync({ token, secret, epochTolerance }).valid;
  }
};

import { 
  comparePassword, 
  createSession, 
  validateSession, 
  revokeSession, 
  create2FASetupChallenge,
  create2FAVerifyChallenge,
  get2FAChallenge,
  twoFactorChallengeStore
} from "./src/server/auth.js";
import bcrypt from "bcryptjs";
import multer from "multer";
import { sendReminderEmail, isEmailConfigured } from "./src/server/lib/email.js";



async function ensureBucketsExist() {
  const buckets = ["customer-files", "safevault_files", "safevault_archives"];
  for (const b of buckets) {
    try {
      const { error } = await supabase.storage.createBucket(b, { public: false });
      if (error) {
        console.log(`Bucket ${b} creation check (maybe already exists):`, error.message);
      } else {
        console.log(`Successfully ensured storage bucket "${b}" exists.`);
      }
    } catch (err) {
      console.warn(`Error ensuring bucket ${b} exists:`, err);
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  await ensureBucketsExist();
  
  app.use(express.json());

  // Middleware to authenticate
  const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Geen geldige sessie." });
    }
    const token = authHeader.split(" ")[1];
    const user = await validateSession(token);
    if (!user) {
      return res.status(401).json({ error: "Sessie verlopen of ongeldig." });
    }
    (req as any).user = user;
    (req as any).token = token;
    next();
  };

  // Helper to verify if the logged-in user can access a specific customer
  const canAccessCustomer = async (reqUser: any, customerId: string): Promise<boolean> => {
    if (!reqUser) return false;
    if (reqUser.role === "owner") return true;
    if (reqUser.role === "customer") {
      const allowed = reqUser.id === customerId;
      if (!allowed) {
        supabase.from("access_logs").insert({
          account_id: reqUser.id,
          account_number: reqUser.number,
          event: "unauthorized_access",
          ip: "127.0.0.1",
          metadata: { 
            status: "Nieuw", 
            target_customer_id: customerId, 
            description: "Klant probeerde toegang te krijgen tot dossier van andere klant." 
          }
        }).then(null, (e) => console.error("Access log insert error:", e));
      }
      return allowed;
    }
    if (reqUser.role === "user") {
      // Check if this customer's owner_id is reqUser.id
      const { data: customer, error } = await supabase
        .from("accounts")
        .select("owner_id, number")
        .eq("id", customerId)
        .eq("role", "customer")
        .single();
      if (error || !customer) return false;
      if (customer.owner_id === reqUser.id) return true;
      // If user belongs to an organization, check if customer belongs to same org
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
      // Access denied
      supabase.from("access_logs").insert({
        account_id: reqUser.id,
        account_number: reqUser.number,
        event: "unauthorized_access",
        ip: "127.0.0.1",
        metadata: { 
          status: "Nieuw", 
          target_customer_id: customerId, 
          target_customer_number: customer.number,
          description: `Boekhouder probeerde toegang te krijgen tot niet-geautoriseerd klantendossier (${customer.number}).` 
        }
      }).then(null, (e) => console.error("Access log insert error:", e));
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
      supabase.from("access_logs").insert({
        account_id: reqUser.id,
        account_number: reqUser.number,
        event: "unauthorized_access",
        ip: "127.0.0.1",
        metadata: { 
          status: "Nieuw", 
          target_customer_id: customerId, 
          description: "Organisatie probeerde toegang te krijgen tot niet-gekoppeld klantendossier." 
        }
      }).then(null, (e) => console.error("Access log insert error:", e));
      return false;
    }
    return false;
  };

  // Helper to get all customer IDs accessible by the user
  const getAccessibleCustomerIds = async (reqUser: any): Promise<string[]> => {
    if (!reqUser) return [];
    if (reqUser.role === "owner") {
      const { data } = await supabase.from("accounts").select("id").eq("role", "customer");
      return (data || []).map(c => c.id);
    }
    if (reqUser.role === "customer") {
      return [reqUser.id];
    }
    if (reqUser.role === "user") {
      const { data } = await supabase.from("accounts").select("id").eq("role", "customer").eq("owner_id", reqUser.id);
      return (data || []).map(c => c.id);
    }
    if (reqUser.role === "organization") {
      const { data: orgUsers } = await supabase.from("accounts").select("id").eq("owner_id", reqUser.id);
      const userIds = [reqUser.id, ...(orgUsers || []).map(u => u.id)];
      const { data } = await supabase.from("accounts").select("id").eq("role", "customer").in("owner_id", userIds);
      return (data || []).map(c => c.id);
    }
    return [];
  };

  const canAccessFilePath = async (reqUser: any, filePath: string): Promise<boolean> => {
    if (!reqUser) return false;
    if (reqUser.role === "owner") return true;

    // Check notes/CUSTOMER_ID/...
    if (filePath.startsWith("notes/")) {
      const parts = filePath.split("/");
      if (parts.length >= 2) {
        return canAccessCustomer(reqUser, parts[1]);
      }
    }

    // Check archive/CUSTOMER_ID/...
    if (filePath.startsWith("archive/")) {
      const parts = filePath.split("/");
      if (parts.length >= 2) {
        return canAccessCustomer(reqUser, parts[1]);
      }
    }

    // Check CUSTOMER_ID/FILENAME
    const parts = filePath.split("/");
    if (parts.length === 2) {
      return canAccessCustomer(reqUser, parts[0]);
    }

    return false;
  };

  const canAccessFileId = async (reqUser: any, fileId: string): Promise<boolean> => {
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
  };

  const canAccessFolderId = async (reqUser: any, folderId: string): Promise<boolean> => {
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
  };

  const canAccessArchiveFileId = async (reqUser: any, fileId: string): Promise<boolean> => {
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
  };

  const canAccessNoteId = async (reqUser: any, noteId: string): Promise<boolean> => {
    if (!reqUser) return false;
    if (reqUser.role === "owner") return true;

    const { data: note } = await supabase
      .from("notes")
      .select("customer_id")
      .eq("id", noteId)
      .single();

    if (note) {
      return canAccessCustomer(reqUser, note.customer_id);
    }

    return false;
  };

  const canAccessBtwCalcId = async (reqUser: any, calcId: string): Promise<boolean> => {
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
  };

  app.post("/api/auth/emergency-reset", async (req, res) => {
    if (process.env.ALLOW_EMERGENCY_RESET !== "true") {
      return res.status(403).json({ error: "Emergency reset not allowed." });
    }
    try {
      await supabase.from("credentials").delete().neq("account_id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("sessions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      const { error } = await supabase.from("accounts").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
      res.json({ purged: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Reset failed." });
    }
  });

  // ----- Auth routes -----
  app.get("/api/auth/setup-status", async (req, res) => {
    try {
      const { count, error } = await supabase
        .from("accounts")
        .select("id", { count: "exact", head: true });
        
      if (error) {
        console.error("Setup status check - error:", error);
        return res.status(500).json({ error: "Interne serverfout tijdens setup-check" });
      }
      
      console.log("Setup status check - count:", count);
      res.json({ initialized: count !== null && count !== 0 });
    } catch (err) {
      console.error("Setup status check - unexpected error:", err);
      res.status(500).json({ error: "Interne serverfout tijdens setup-check" });
    }
  });

  // Helper to fetch account 2FA state safely from Supabase
  async function getAccount2FAState(accountId: string) {
    const { data, error } = await supabase
      .from("accounts")
      .select("two_factor_enabled, totp_secret, last_2fa_verified_at")
      .eq("id", accountId)
      .single();

    if (error || !data) {
      console.error("Supabase 2FA query error:", error);
      throw new Error(`Fout bij opvragen 2FA-status: ${error?.message || "Account niet gevonden"}`);
    }

    return {
      two_factor_enabled: Boolean(data.two_factor_enabled),
      totp_secret: (data.totp_secret as string) || null,
      last_2fa_verified_at: (data.last_2fa_verified_at as string) || null,
    };
  }

  async function saveAccount2FAState(accountId: string, state: { two_factor_enabled?: boolean; totp_secret?: string | null; last_2fa_verified_at?: string | null }) {
    try {
      const updateData: any = {};
      if (state.two_factor_enabled !== undefined) updateData.two_factor_enabled = state.two_factor_enabled;
      if (state.totp_secret !== undefined) updateData.totp_secret = state.totp_secret;
      if (state.last_2fa_verified_at !== undefined) updateData.last_2fa_verified_at = state.last_2fa_verified_at;

      await supabase.from("accounts").update(updateData).eq("id", accountId);
    } catch (err) {
      console.warn("Supabase 2FA update notice:", err);
    }
  }

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { name, number, password } = req.body;
      if (!name || !number || !password) {
        return res.status(400).json({ error: "Naam, nummer en wachtwoord zijn verplicht." });
      }

      const cleanName = String(name).trim();
      const cleanNumber = String(number).trim();
      const cleanPassword = String(password);

      // Lookup account by number
      let { data: accounts, error: accError } = await supabase
        .from("accounts")
        .select("id, number, name, role, status, failed_attempts")
        .eq("number", cleanNumber);

      if (accError || !accounts || accounts.length === 0) {
        // Fallback 1: Lookup by email if the number looks like an email address
        if (cleanNumber.includes("@")) {
          const { data: emailAccounts, error: emailErr } = await supabase
            .from("accounts")
            .select("id, number, name, role, status, failed_attempts")
            .eq("email", cleanNumber);
          if (!emailErr && emailAccounts && emailAccounts.length > 0) {
            accounts = emailAccounts;
          }
        }
      }

      if (!accounts || accounts.length === 0) {
        // Fallback 2: Lookup by name if still not found
        const { data: nameAccounts, error: nameErr } = await supabase
          .from("accounts")
          .select("id, number, name, role, status, failed_attempts")
          .eq("name", cleanName);
        if (!nameErr && nameAccounts && nameAccounts.length > 0) {
          accounts = nameAccounts;
        }
      }

      if (!accounts || accounts.length === 0) {
        console.error("Login lookup error for identifier:", cleanNumber);
        return res.status(401).json({ error: "Onjuiste inloggegevens." });
      }

      // Normalize function for robust string comparison
      const normalizeStr = (s: string) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
      const targetNorm = normalizeStr(cleanName);

      // Match name case-insensitively with normalized comparison
      let account = accounts.find((a) => {
        const accNorm = normalizeStr(a.name);
        if (accNorm === targetNorm) return true;
        // Strip parenthetical labels if present
        const cleanAccName = normalizeStr(a.name.replace(/\s*\(.*?\)\s*/g, ""));
        if (cleanAccName === targetNorm) return true;
        return false;
      });

      // FALLBACK 3: If name comparison didn't match, but we have accounts for this identifier, allow using the first account
      if (!account && accounts.length > 0) {
        account = accounts[0];
      }

      if (!account) {
        return res.status(401).json({ error: "Onjuiste inloggegevens." });
      }

      if (account.status !== "active") {
        await supabase.from("access_logs").insert({
          account_id: account.id,
          account_number: account.number,
          event: "login_blocked",
          ip: req.ip || "127.0.0.1",
          metadata: { status: "Nieuw", reason: "Account is niet actief of geblokkeerd" }
        }).then(null, (e) => console.error("Access log insert error:", e));
        return res.status(401).json({ error: "Account is geblokkeerd." });
      }

      if ((account.failed_attempts || 0) >= 10) {
        await supabase.from("access_logs").insert({
          account_id: account.id,
          account_number: account.number,
          event: "login_blocked",
          ip: req.ip || "127.0.0.1",
          metadata: { status: "Nieuw", reason: "Te veel mislukte pogingen" }
        }).then(null, (e) => console.error("Access log insert error:", e));
        return res.status(401).json({ error: "Account tijdelijk vergrendeld vanwege te veel mislukte pogingen." });
      }

      // Lookup credentials
      const { data: creds, error: credError } = await supabase
        .from("credentials")
        .select("password_hash")
        .eq("account_id", account.id)
        .single();

      if (credError || !creds || !creds.password_hash) {
        console.error("Credentials lookup error for account:", account.id, credError?.message);
        return res.status(401).json({ error: "Onjuiste inloggegevens." });
      }

      // Verify password
      const isValid = await comparePassword(cleanPassword, creds.password_hash);
      if (!isValid) {
        const newFailed = (account.failed_attempts || 0) + 1;
        const newStatus = newFailed >= 10 ? "blocked" : account.status;
        await supabase
          .from("accounts")
          .update({ 
            failed_attempts: newFailed,
            status: newStatus
          })
          .eq("id", account.id);

        // Log login_failed
        await supabase.from("access_logs").insert({
          account_id: account.id,
          account_number: account.number,
          event: "login_failed",
          ip: req.ip || "127.0.0.1",
          metadata: { failed_attempts: newFailed, status: "Nieuw" }
        }).then(null, (e) => console.error("Access log insert error:", e));

        // If newly blocked, log block event
        if (newStatus === "blocked") {
          await supabase.from("access_logs").insert({
            account_id: account.id,
            account_number: account.number,
            event: account.role === "customer" ? "customer_blocked" : "account_blocked",
            ip: req.ip || "127.0.0.1",
            metadata: { status: "Nieuw" }
          }).then(null, (e) => console.error("Access log insert error:", e));
        }

        return res.status(401).json({ error: "Onjuiste inloggegevens." });
      }

      // Check role for 2FA
      // ONLY customers (role === "customer" or number starts with "6") are exempt from 2FA.
      // Owners, Organizations (starts with "2"), and Users/Bookkeepers (starts with "89") MUST use 2FA.
      const isExemptFrom2FA = account.role === "customer" || String(account.number).startsWith("6");
      if (isExemptFrom2FA) {
        await supabase
          .from("accounts")
          .update({ failed_attempts: 0, last_login_at: new Date().toISOString() })
          .eq("id", account.id);

        const sessionLifetime = await getAccountSessionLifetime(account.id, 5);
        const { token, expiresAt } = await createSession(account.id, sessionLifetime);

        return res.json({ 
          token, 
          account: sanitizeAccount(account),
          expires_at: expiresAt
        });
      }

      // User/Boekhouder requires 2FA
      const twoFaState = await getAccount2FAState(account.id);

      if (!twoFaState.two_factor_enabled || !twoFaState.totp_secret) {
        // 2FA setup required
        const tempToken = await create2FASetupChallenge(account.id);
        return res.json({
          requires_2fa: true,
          requires_2fa_setup: true,
          temp_token: tempToken
        });
      }

      // 2FA enabled: check 48-hour rule server-side
      const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
      const lastVerifiedMs = twoFaState.last_2fa_verified_at ? new Date(twoFaState.last_2fa_verified_at).getTime() : 0;
      const isWithin48Hours = (Date.now() - lastVerifiedMs) < FORTY_EIGHT_HOURS_MS;

      if (isWithin48Hours) {
        // Verified < 48 hours ago -> let user through directly
        await supabase
          .from("accounts")
          .update({ failed_attempts: 0, last_login_at: new Date().toISOString() })
          .eq("id", account.id);

        const sessionLifetime = await getAccountSessionLifetime(account.id, 5);
        const { token, expiresAt } = await createSession(account.id, sessionLifetime);

        return res.json({ 
          token, 
          account: sanitizeAccount(account),
          expires_at: expiresAt
        });
      }

      // Verified 48+ hours ago -> ask for TOTP code
      const tempToken = await create2FAVerifyChallenge(account.id);
      return res.json({
        requires_2fa: true,
        requires_2fa_setup: false,
        temp_token: tempToken
      });

    } catch (err: any) {
      console.error("Unexpected error during login:", err);
      res.status(500).json({ error: "Interne serverfout bij inloggen." });
    }
  });

  // 2FA Setup Initialize (returns QR Code Data URL)
  app.post("/api/auth/2fa/setup-init", async (req, res) => {
    try {
      const { tempToken } = req.body;
      if (!tempToken) return res.status(400).json({ error: "Ontbrekende sessietoken." });

      const challenge = await get2FAChallenge(tempToken);
      if (!challenge || challenge.type !== "setup") {
        return res.status(401).json({ error: "Ongeldige of verlopen 2FA-sessie. Log opnieuw in." });
      }

      const { data: account } = await supabase.from("accounts").select("id, name, number, role").eq("id", challenge.userId).single();
      if (!account) return res.status(404).json({ error: "Account niet gevonden." });

      // Generate a new TOTP secret server-side
      const secret = authenticator.generateSecret();
      challenge.tempSecret = secret;

      // Construct OTP URI
      const otpauthUri = authenticator.keyuri(account.name || account.number, "SafeVault", secret);

      // Generate local SVG / Data URL QR code
      const qrCodeUrl = await QRCode.toDataURL(otpauthUri, {
        margin: 2,
        width: 240,
        color: {
          dark: "#0F172A",
          light: "#FFFFFF"
        }
      });

      res.json({
        qrCodeUrl,
        accountName: account.name,
        number: account.number
      });
    } catch (err: any) {
      console.error("2FA setup-init error:", err);
      res.status(500).json({ error: "Het instellen van tweestapsverificatie is mislukt. Probeer het opnieuw." });
    }
  });

  // 2FA Setup Verification
  app.post("/api/auth/2fa/setup-verify", async (req, res) => {
    try {
      const { tempToken, code } = req.body;
      if (!tempToken || !code) return res.status(400).json({ error: "Ontbrekende velden." });

      const challenge = await get2FAChallenge(tempToken);
      if (!challenge || challenge.type !== "setup" || !challenge.tempSecret) {
        return res.status(401).json({ error: "Ongeldige of verlopen 2FA-sessie. Log opnieuw in." });
      }

      if (challenge.attemptCount >= 5) {
        twoFactorChallengeStore.delete(tempToken);
        return res.status(401).json({ error: "Te veel mislukte pogingen. Log opnieuw in." });
      }

      const cleanCode = String(code).replace(/[^0-9]/g, "").trim();
      if (cleanCode.length !== 6) {
        challenge.attemptCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return res.status(400).json({ error: "De verificatiecode is onjuist. Probeer het opnieuw." });
      }

      const isValid = authenticator.verify({ token: cleanCode, secret: challenge.tempSecret });
      if (!isValid) {
        challenge.attemptCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return res.status(400).json({ error: "De verificatiecode is onjuist. Probeer het opnieuw." });
      }

      // Success! Enable 2FA for this user
      const nowIso = new Date().toISOString();
      await saveAccount2FAState(challenge.userId, {
        two_factor_enabled: true,
        totp_secret: challenge.tempSecret,
        last_2fa_verified_at: nowIso,
      });

      twoFactorChallengeStore.delete(tempToken);

      const { data: account } = await supabase.from("accounts").select("id, number, name, role, status").eq("id", challenge.userId).single();
      if (!account || account.status !== "active") {
        return res.status(401).json({ error: "Account is geblokkeerd." });
      }

      await supabase.from("accounts").update({ last_login_at: nowIso, failed_attempts: 0 }).eq("id", account.id);

      const sessionLifetime = await getAccountSessionLifetime(account.id, 5);
      const { token, expiresAt } = await createSession(account.id, sessionLifetime);

      res.json({
        token,
        account: sanitizeAccount(account),
        expires_at: expiresAt
      });
    } catch (err: any) {
      console.error("2FA setup-verify error:", err);
      res.status(500).json({ error: "Het instellen van tweestapsverificatie is mislukt. Probeer het opnieuw." });
    }
  });

  // 2FA Normal Verification
  app.post("/api/auth/verify-2fa", async (req, res) => {
    try {
      const { tempToken, code } = req.body;
      if (!tempToken || !code) return res.status(400).json({ error: "Ontbrekende velden." });

      const challenge = await get2FAChallenge(tempToken);
      if (!challenge || challenge.type !== "verify") {
        return res.status(401).json({ error: "Ongeldige of verlopen 2FA-sessie. Log opnieuw in." });
      }

      if (challenge.attemptCount >= 5) {
        twoFactorChallengeStore.delete(tempToken);
        return res.status(401).json({ error: "Te veel mislukte pogingen. Log opnieuw in." });
      }

      const cleanCode = String(code).replace(/[^0-9]/g, "").trim();
      if (cleanCode.length !== 6) {
        challenge.attemptCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return res.status(400).json({ error: "De verificatiecode is onjuist. Probeer het opnieuw." });
      }

      const twoFaState = await getAccount2FAState(challenge.userId);
      if (!twoFaState.totp_secret) {
        return res.status(400).json({ error: "2FA is niet ingesteld voor dit account." });
      }

      const isValid = authenticator.verify({ token: cleanCode, secret: twoFaState.totp_secret });

      if (!isValid) {
        challenge.attemptCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (challenge.attemptCount >= 5) {
          twoFactorChallengeStore.delete(tempToken);
          return res.status(401).json({ error: "Te veel mislukte pogingen. Log opnieuw in." });
        }
        return res.status(400).json({ error: "De verificatiecode is onjuist. Probeer het opnieuw." });
      }

      // Success! Update last_2fa_verified_at
      const nowIso = new Date().toISOString();
      await saveAccount2FAState(challenge.userId, {
        two_factor_enabled: true,
        last_2fa_verified_at: nowIso,
      });

      twoFactorChallengeStore.delete(tempToken);

      const { data: account } = await supabase.from("accounts").select("id, number, name, role, status").eq("id", challenge.userId).single();
      if (!account || account.status !== "active") {
        return res.status(401).json({ error: "Account is geblokkeerd." });
      }

      await supabase.from("accounts").update({ last_login_at: nowIso, failed_attempts: 0 }).eq("id", account.id);

      const sessionLifetime = await getAccountSessionLifetime(account.id, 5);
      const { token, expiresAt } = await createSession(account.id, sessionLifetime);

      res.json({
        token,
        account: sanitizeAccount(account),
        expires_at: expiresAt
      });
    } catch (err) {
      console.error("2FA verify error:", err);
      res.status(500).json({ error: "Verificatie mislukt. Probeer het opnieuw." });
    }
  });

  app.post("/api/auth/logout", requireAuth, async (req: any, res) => {
    await revokeSession(req.token);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", requireAuth, (req: any, res) => {
    res.json(req.user);
  });

  app.post("/api/auth/change-name", requireAuth, async (req: any, res) => {
    const { newName } = req.body;
    if (!newName || !newName.trim()) {
      return res.status(400).json({ error: "Naam mag niet leeg zijn." });
    }
    const trimmed = newName.trim();

    const { error } = await supabase.from("accounts").update({ name: trimmed, updated_at: new Date().toISOString() }).eq("id", req.user.id);
    if (error) return res.status(500).json({ error: error.message });

    await supabase.from("access_logs").insert({
      account_id: req.user.id,
      event: "name_changed",
      ip: req.ip || "127.0.0.1",
      metadata: { newName: trimmed }
    });

    res.json({ ok: true, name: trimmed });
  });

  app.post("/api/auth/change-password", requireAuth, async (req: any, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Huidig en nieuw wachtwoord zijn verplicht." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Nieuw wachtwoord moet minimaal 8 tekens bevatten." });
    }

    const { data: creds } = await supabase.from("credentials").select("password_hash").eq("account_id", req.user.id).single();
    if (!creds || !creds.password_hash) {
      return res.status(400).json({ error: "Accountinloggegevens niet gevonden." });
    }

    const isValid = await comparePassword(currentPassword, creds.password_hash);
    if (!isValid) {
      return res.status(400).json({ error: "Huidig wachtwoord is onjuist." });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    const { error } = await supabase.from("credentials").update({ password_hash: newHash, updated_at: new Date().toISOString() }).eq("account_id", req.user.id);
    if (error) return res.status(500).json({ error: error.message });

    await supabase.from("access_logs").insert({
      account_id: req.user.id,
      event: "password_changed",
      ip: req.ip || "127.0.0.1"
    });

    res.json({ ok: true });
  });

  // Helper to determine custom session duration based on organization settings
  async function getAccountSessionLifetime(accountId: string, defaultHours = 5): Promise<number> {
    try {
      const { data: account } = await supabase
        .from("accounts")
        .select("id, number, role, owner_id")
        .eq("id", accountId)
        .single();
      if (!account) return defaultHours;
      
      let orgId: string | null = null;
      if (String(account.number).startsWith("2")) {
        orgId = account.id;
      } else if (String(account.number).startsWith("89") && account.owner_id) {
        orgId = account.owner_id;
      } else if (String(account.number).startsWith("6") && account.owner_id) {
        // Find if parent user belongs to org
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
        const { data: setRec } = await supabase.from("settings").select("session_lifetime_hours").eq("id", 1).single();
        if (setRec && setRec.session_lifetime_hours) {
          return Number(setRec.session_lifetime_hours);
        }
      }
    } catch (err) {
      console.error("Error fetching custom session lifetime:", err);
    }
    return defaultHours;
  }

  // Helper to sanitize account output and map role to organization
  function sanitizeAccount(account: any) {
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
      status: copy.status
    };
  }

  // Helpers to normalize quarter strings and flatten file metadata
  function normalizeQuarter(q: any): string | null {
    if (!q) return null;
    const str = String(q).trim().toUpperCase();
    if (str === "1" || str === "Q1") return "Q1";
    if (str === "2" || str === "Q2") return "Q2";
    if (str === "3" || str === "Q3") return "Q3";
    if (str === "4" || str === "Q4") return "Q4";
    return null;
  }

  function formatFileWithMetadata(f: any) {
    if (!f) return f;
    const metadata = f.file_metadata;
    const rawQ = metadata?.quarter || f.quarter || null;
    return {
      ...f,
      category: metadata?.category || f.category || "proof",
      quarter: normalizeQuarter(rawQ) || rawQ || null,
      year: metadata?.year || f.year || null,
      file_metadata: undefined
    };
  }

  function formatFilesWithMetadata(files: any[]) {
    if (!files) return [];
    return files.map(formatFileWithMetadata);
  }

  function mergeFilesWithStore(supabaseFiles: any[], customerId?: string) {
    const formatted = formatFilesWithMetadata(supabaseFiles || []);
    return formatted.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  function mergeNotificationsWithStore(supabaseNotifs: any[], accountId: string) {
    const list = supabaseNotifs ? [...supabaseNotifs] : [];
    const deduplicated: any[] = [];
    const seenKeys = new Set<string>();

    const sorted = list.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

    for (const item of sorted) {
      const timeBucket = Math.floor(new Date(item.created_at || Date.now()).getTime() / (5 * 60 * 1000));
      const key = `${item.account_id || accountId}_${item.kind || ''}_${(item.message || '').trim()}_${timeBucket}`;

      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        deduplicated.push(item);
      }
    }

    return deduplicated;
  }

  // ----- Notes API -----
  app.get("/api/dossier/:customerId/notes", requireAuth, async (req: any, res) => {
    let { customerId } = req.params;
    const user = req.user;

    if (customerId === "self") {
      customerId = user.id;
    }

    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }

    let query = supabase.from("notes").select("*").eq("customer_id", customerId);
    if (user.role === "customer") {
      query = query.eq("visible_to_customer", true);
    }
    const { data: notes, error } = await query.order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ notes: notes || [] });
  });

  app.post("/api/dossier/:customerId/notes", requireAuth, async (req: any, res) => {
    const { customerId } = req.params;
    const user = req.user;

    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }

    if (user.role === "customer" || user.role === "organization") {
      return res.status(403).json({ error: "Klanten kunnen geen notities aanmaken." });
    }

    const { title, body, visible_to_customer, file_path, file_name, file_size, mime_type } = req.body;
    if (!title && !body && !file_path) return res.status(400).json({ error: "Titel, inhoud of bijlage is verplicht." });

    const { data: note, error } = await supabase.from("notes").insert({
      customer_id: customerId,
      author_id: user.id,
      title: title || "",
      body: body || "",
      visible_to_customer: !!visible_to_customer,
      file_path,
      file_name,
      file_size,
      mime_type
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ note });
  });

  app.put("/api/dossier/notes/:noteId", requireAuth, async (req: any, res) => {
    const { noteId } = req.params;
    const user = req.user;

    if (user.role === "customer" || user.role === "organization") {
      return res.status(403).json({ error: "Klanten kunnen geen notities bewerken." });
    }

    if (!(await canAccessNoteId(user, noteId))) {
      return res.status(404).json({ error: "Notitie niet gevonden." });
    }

    const { title, body, visible_to_customer, file_path, file_name, file_size, mime_type } = req.body;
    const { data: note, error } = await supabase.from("notes").update({
      title,
      body,
      visible_to_customer: !!visible_to_customer,
      file_path,
      file_name,
      file_size,
      mime_type,
      updated_at: new Date().toISOString()
    }).eq("id", noteId).select().single();

    if (error || !note) {
      return res.status(404).json({ error: "Notitie niet gevonden." });
    }

    res.json({ ok: true, note });
  });

  app.delete("/api/dossier/notes/:noteId", requireAuth, async (req: any, res) => {
    const { noteId } = req.params;
    const user = req.user;

    if (user.role === "customer" || user.role === "organization") {
      return res.status(403).json({ error: "Klanten kunnen geen notities verwijderen." });
    }

    if (!(await canAccessNoteId(user, noteId))) {
      return res.status(404).json({ error: "Notitie niet gevonden." });
    }

    const { error } = await supabase.from("notes").delete().eq("id", noteId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // ----- Upload Config -----
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

  app.post("/api/dossier/:customerId/notes/upload", requireAuth, upload.single("file"), async (req: any, res) => {
    const { customerId } = req.params;
    const user = req.user;

    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }

    if (user.role === "customer" || user.role === "organization") {
      return res.status(403).json({ error: "Klanten kunnen hier geen bestanden uploaden." });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "Geen bestand meegeleverd." });
    }

    const ext = path.extname(file.originalname);
    const fileName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
    const filePath = `notes/${customerId}/${fileName}`;

    const { data: storageData, error: storageError } = await supabase.storage
      .from("customer-files")
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (storageError) {
      console.error("Storage error:", storageError);
      return res.status(500).json({ error: storageError.message });
    }

    res.json({
      filePath,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype
    });
  });

  app.get("/api/dossier/notes/attachment/view", requireAuth, async (req: any, res) => {
    const { path: filePath } = req.query;
    if (!filePath) return res.status(400).json({ error: "Pad is verplicht." });

    const user = req.user;
    if (!(await canAccessFilePath(user, filePath as string))) {
      return res.status(404).json({ error: "Bijlage niet gevonden." });
    }

    const { data: signedUrl, error: signedUrlError } = await supabase.storage
      .from("customer-files")
      .createSignedUrl(filePath as string, 3600);

    if (signedUrlError) {
      return res.status(500).json({ error: signedUrlError.message });
    }

    res.json({ url: signedUrl.signedUrl });
  });

  // ----- Files API -----

  app.post("/api/customer/upload", requireAuth, upload.array("files"), async (req: any, res) => {
    const user = req.user;
    if (user.role !== "customer") {
      return res.status(403).json({ error: "Alleen klanten kunnen bestanden direct uploaden." });
    }

    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "Geen bestanden meegeleverd." });
    }

    // Determine custom organization upload size limits
    let maxUploadBytes = 52428800; // default 50MB
    try {
      const { data: customerAcc } = await supabase.from("accounts").select("owner_id").eq("id", user.id).single();
      if (customerAcc && customerAcc.owner_id) {
        const { data: ownerAcc } = await supabase.from("accounts").select("id, number").eq("id", customerAcc.owner_id).single();
        if (ownerAcc && String(ownerAcc.number).startsWith("2")) {
          const { data: setRec } = await supabase.from("settings").select("max_upload_bytes").eq("id", 1).single();
          maxUploadBytes = setRec?.max_upload_bytes || 52428800;
        }
      }
    } catch (e) {
      console.error("Error determining custom organization upload size limit:", e);
    }

    // Check sizes of files
    for (const file of files) {
      if (file.size > maxUploadBytes) {
        return res.status(400).json({
          error: `Bestand "${file.originalname}" is groter dan de toegestane limiet van ${Math.round(maxUploadBytes / 1024 / 1024)} MB voor uw organisatie.`
        });
      }
    }

    const { category, quarter, year } = req.body;
    const cat = category || "proof";
    const qtr = normalizeQuarter(quarter) || "Q1";
    const yr = year ? parseInt(year, 10) : new Date().getFullYear();

    const uploaded = [];
    for (const file of files) {
      const ext = path.extname(file.originalname);
      const fileId = "file_" + Date.now() + "_" + Math.round(Math.random() * 1E9);
      const fileName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
      const filePath = `${user.id}/${fileName}`;

      let dbDataId = fileId;

      const { storageError } = await supabase.storage
        .from("customer-files")
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (storageError) {
        console.error("Storage error:", storageError);
      }

      // Insert DB record
      try {
        const { data: dbData } = await supabase
          .from("files")
          .insert([{
            customer_id: user.id,
            uploader_id: user.id,
            original_name: file.originalname,
            mime_type: file.mimetype,
            size_bytes: file.size,
            storage_path: filePath,
            category: cat,
            quarter: qtr,
            year: yr
          }])
          .select()
          .single();
        
        if (dbData) {
          dbDataId = dbData.id;
          try {
            await supabase.from("file_metadata").insert([{
              file_id: dbData.id,
              category: cat,
              quarter: qtr,
              year: yr,
              updated_at: new Date().toISOString()
            }]);
          } catch (metadataErr) {
            console.error("Optional file_metadata insert check (ignoring):", metadataErr);
          }
        }
      } catch (dbErr) {
        console.error("Supabase insert file error:", dbErr);
      }

      uploaded.push({
        id: dbDataId,
        name: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
        category: cat,
        quarter: qtr,
        year: yr
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

        await supabase.from("admin_status").upsert(
          {
            user_id: ownerId,
            customer_id: user.id,
            year: yr,
            quarter: qtr,
            status: "in_progress",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "customer_id,quarter,year" }
        );

        const custName = customerAcc?.name || user.name || "Klant";
        const notifMsg = `Klant ${custName} heeft ${uploaded.length} bestand(en) geüpload voor ${qtr} ${yr}.`;
        
        await supabase.from("notifications").insert([{
          account_id: ownerId,
          kind: "file_uploaded",
          message: notifMsg,
          read: false,
          created_at: new Date().toISOString()
        }]);
      } catch (err) {
        console.error("Error auto-updating status and notification on upload:", err);
      }
    }

    res.json({ count: uploaded.length, uploaded });
  });

  app.get("/api/customer/files", requireAuth, async (req: any, res) => {
    const user = req.user;
    if (user.role !== "customer") {
      return res.status(403).json({ error: "Alleen klanten kunnen deze route aanroepen." });
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

  app.get("/api/dossier/:customerId/uploads", requireAuth, async (req: any, res) => {
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

  app.get("/api/user/files/:fileId/download", requireAuth, async (req: any, res) => {
    const { fileId } = req.params;
    const user = req.user;

    if (!(await canAccessFileId(user, fileId))) {
      return res.status(404).json({ error: "Bestand niet gevonden." });
    }

    // Get file record
    const { data: fileRecord, error: fileError } = await supabase
      .from("files")
      .select("customer_id, original_name, mime_type, storage_path")
      .eq("id", fileId)
      .single();

    if (fileError || !fileRecord) {
      return res.status(404).json({ error: "Bestand niet gevonden." });
    }

    // Generate signed URL
    const { data: signedUrl, error: signedUrlError } = await supabase.storage
      .from("customer-files")
      .createSignedUrl(fileRecord.storage_path, 60); // 60 seconds validity

    if (signedUrlError) {
      return res.status(500).json({ error: "Kon bestand niet downloaden." });
    }

    res.json({ url: signedUrl.signedUrl, mimeType: fileRecord.mime_type, originalName: fileRecord.original_name });
  });

  app.get("/api/user/files/:fileId/view", requireAuth, async (req: any, res) => {
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

    if (fileError || !fileRecord) return res.status(404).json({ error: "Bestand niet gevonden." });

    const { data: signedUrl, error: signedUrlError } = await supabase.storage
      .from("customer-files")
      .createSignedUrl(fileRecord.storage_path, 60);

    if (signedUrlError) return res.status(500).json({ error: "Kon bestand niet openen." });

    res.json({ url: signedUrl.signedUrl, mimeType: fileRecord.mime_type, originalName: fileRecord.original_name });
  });

  app.post("/api/user/files/:fileId/delete", requireAuth, async (req: any, res) => {
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

    if (fileError || !fileRecord) return res.status(404).json({ error: "Bestand niet gevonden." });

    // Delete from Storage
    await supabase.storage.from("customer-files").remove([fileRecord.storage_path]);
    
    // Delete from DB
    await supabase.from("files").delete().eq("id", fileId);

    res.json({ ok: true });
  });

  app.put("/api/dossier/files/:fileId/metadata", requireAuth, async (req: any, res) => {
    const { fileId } = req.params;
    const user = req.user;

    // Only bookkeepers/owners can update metadata
    if (user.role === "customer" || user.role === "organization") {
      return res.status(403).json({ error: "Klanten kunnen geen metadata bijwerken." });
    }

    if (!(await canAccessFileId(user, fileId))) {
      return res.status(404).json({ error: "Bestand niet gevonden." });
    }

    const { category, quarter, year } = req.body;

    const { error } = await supabase
      .from("file_metadata")
      .upsert({
        file_id: fileId,
        category,
        quarter,
        year: year ? parseInt(year, 10) : null,
        updated_at: new Date().toISOString()
      }, { onConflict: "file_id" });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  app.get("/api/user/files", requireAuth, async (req: any, res) => {
    const user = req.user;
    if (user.role === "customer" || user.role === "organization") {
      return res.status(403).json({ error: "Klanten hebben geen toegang tot deze route." });
    }

    const allowedIds = await getAccessibleCustomerIds(user);
    if (allowedIds.length === 0) {
      return res.json({ files: [] });
    }

    const { data, error } = await supabase
      .from("files")
      .select("*, accounts!files_customer_id_fkey(name, number), file_metadata (category, quarter, year)") // join customer info
      .in("customer_id", allowedIds)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return res.json({ files: [] });
    }

    const merged = mergeFilesWithStore(data);
    const filteredMerged = merged.filter((f: any) => allowedIds.includes(f.customer_id));

    res.json({ files: filteredMerged });
  });

  app.get("/api/user/customers/:customerId/files", requireAuth, async (req: any, res) => {
    const { customerId } = req.params;
    const user = req.user;

    if (user.role === "customer" || user.role === "organization") {
      return res.status(403).json({ error: "Klanten hebben geen toegang tot deze route." });
    }

    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Klant niet gevonden." });
    }

    // Get customer info
    const { data: customer, error: customerError } = await supabase
      .from("accounts")
      .select("id, number, name")
      .eq("id", customerId)
      .single();

    if (customerError || !customer) return res.status(404).json({ error: "Klant niet gevonden." });

    // Get files
    const { data: files, error: filesError } = await supabase
      .from("files")
      .select("*, file_metadata (category, quarter, year)")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    if (filesError) {
      return res.json({ customer, files: mergeFilesWithStore([], customerId) });
    }
    res.json({ customer, files: mergeFilesWithStore(files, customerId) });
  });


  // ----- Archive API (Phase 2K) -----
  app.get("/api/dossier/:customerId/archive", requireAuth, async (req: any, res) => {
    const { customerId } = req.params;
    const { folderId } = req.query;
    const user = req.user;

    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Archief niet gevonden." });
    }

    let foldersQuery = supabase.from("archive_folders").select("*").eq("customer_id", customerId);
    let filesQuery = supabase.from("archive_files").select("*").eq("customer_id", customerId);

    if (folderId) {
      foldersQuery = foldersQuery.eq("parent_id", folderId);
      filesQuery = filesQuery.eq("folder_id", folderId);
    } else {
      foldersQuery = foldersQuery.is("parent_id", null);
      filesQuery = filesQuery.is("folder_id", null);
    }

    const [foldersRes, filesRes] = await Promise.all([foldersQuery, filesQuery]);
    const sbFolders = foldersRes.data || [];
    const sbFiles = filesRes.data || [];

    res.json({ folders: sbFolders, files: sbFiles });
  });

  app.get("/api/customer/archive", requireAuth, async (req: any, res) => {
    const { folderId } = req.query;
    const user = req.user;

    let foldersQuery = supabase.from("archive_folders").select("*").eq("customer_id", user.id);
    let filesQuery = supabase.from("archive_files").select("*").eq("customer_id", user.id);

    if (folderId) {
      foldersQuery = foldersQuery.eq("parent_id", folderId);
      filesQuery = filesQuery.eq("folder_id", folderId);
    } else {
      foldersQuery = foldersQuery.is("parent_id", null);
      filesQuery = filesQuery.is("folder_id", null);
    }

    const [foldersRes, filesRes] = await Promise.all([foldersQuery, filesQuery]);

    const sbFolders = foldersRes.data || [];
    const sbFiles = filesRes.data || [];

    res.json({ folders: sbFolders, files: sbFiles });
  });

  app.post("/api/dossier/:customerId/archive/folders", requireAuth, async (req: any, res) => {
    const { customerId } = req.params;
    const { name, parentId } = req.body;
    const user = req.user;

    if (user.role === "customer") return res.status(403).json({ error: "Klanten kunnen geen mappen aanmaken." });
    if (!name || !name.trim()) return res.status(400).json({ error: "Mapnaam is verplicht." });

    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Archief niet gevonden." });
    }

    const userIdVal = user.id || customerId;

    try {
      const { data, error } = await supabase.from("archive_folders").insert({
        customer_id: customerId,
        user_id: userIdVal,
        name: name.trim(),
        parent_id: parentId || null
      }).select().single();

      if (error || !data) {
        return res.status(500).json({ error: error?.message || "Fout bij aanmaken map." });
      }

      res.json({ folder: data });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Fout bij aanmaken map." });
    }
  });

  app.post("/api/dossier/archive/folders/:folderId/rename", requireAuth, async (req: any, res) => {
    const { folderId } = req.params;
    const { name } = req.body;
    const user = req.user;

    if (user.role === "customer") return res.status(403).json({ error: "Klanten mogen mappen niet hernoemen." });
    if (!name || !name.trim()) return res.status(400).json({ error: "Mapnaam is verplicht." });

    if (!(await canAccessFolderId(user, folderId))) {
      return res.status(404).json({ error: "Map niet gevonden." });
    }

    await supabase.from("archive_folders").update({ name: name.trim() }).eq("id", folderId);
    res.json({ ok: true });
  });

  app.post("/api/dossier/archive/folders/:folderId/delete", requireAuth, async (req: any, res) => {
    const { folderId } = req.params;
    const user = req.user;

    if (user.role === "customer") return res.status(403).json({ error: "Klanten mogen mappen niet verwijderen." });

    if (!(await canAccessFolderId(user, folderId))) {
      return res.status(404).json({ error: "Map niet gevonden." });
    }

    async function deleteFolderRecursive(fId: string) {
      const { data: filesInFolder } = await supabase.from("archive_files").select("id, storage_path").eq("folder_id", fId);
      if (filesInFolder && filesInFolder.length > 0) {
        for (const fileRec of filesInFolder) {
          if (fileRec.storage_path) {
            await supabase.storage.from("archive-files").remove([fileRec.storage_path]).catch(() => {});
          }
          await supabase.from("archive_files").delete().eq("id", fileRec.id);
        }
      }
      const { data: subfolders } = await supabase.from("archive_folders").select("id").eq("parent_id", fId);
      if (subfolders && subfolders.length > 0) {
        for (const sub of subfolders) {
          await deleteFolderRecursive(sub.id);
        }
      }
      await supabase.from("archive_folders").delete().eq("id", fId);
    }

    try {
      await deleteFolderRecursive(folderId);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("Error deleting folder recursively:", err);
      res.status(500).json({ error: "Fout bij verwijderen van map." });
    }
  });

  app.post("/api/dossier/:customerId/archive/files", requireAuth, upload.array("file"), async (req: any, res) => {
    const { customerId } = req.params;
    const { folderId } = req.body;
    const user = req.user;

    if (user.role === "customer") return res.status(403).json({ error: "Klanten kunnen geen archiefbestanden uploaden." });

    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Archief niet gevonden." });
    }

    const files = req.files;
    if (!files || files.length === 0) return res.status(400).json({ error: "Geen bestand meegeleverd." });
    
    const file = files[0];
    const ext = path.extname(file.originalname);
    const fileName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
    const filePath = `archive/${customerId}/${fileName}`;
    const userIdVal = user.id || customerId;

    const { error: storageError } = await supabase.storage
      .from("archive-files")
      .upload(filePath, file.buffer, { contentType: file.mimetype });

    if (storageError) {
      console.warn("Storage upload notice:", storageError.message);
    }

    try {
      const { data: dbData, error: dbError } = await supabase.from("archive_files").insert({
        customer_id: customerId,
        user_id: userIdVal,
        folder_id: folderId || null,
        name: file.originalname,
        mime_type: file.mimetype,
        size_bytes: file.size,
        storage_path: filePath
      }).select().single();

      if (dbError || !dbData) {
        return res.status(500).json({ error: dbError?.message || "Fout bij opslaan bestand in database." });
      }

      res.json({ file: dbData });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Fout bij uploaden van archiefbestand." });
    }
  });

  app.get("/api/dossier/archive/files/:fileId/download", requireAuth, async (req: any, res) => {
    const { fileId } = req.params;
    const user = req.user;

    if (!(await canAccessArchiveFileId(user, fileId))) {
      return res.status(404).json({ error: "Bestand niet gevonden." });
    }

    const { data: record } = await supabase.from("archive_files").select("*").eq("id", fileId).single();

    if (!record) return res.status(404).json({ error: "Bestand niet gevonden." });

    const { data: signedUrl, error: signedUrlError } = await supabase.storage.from("archive-files").createSignedUrl(record.storage_path, 60);
    if (signedUrlError || !signedUrl?.signedUrl) {
      return res.json({ url: "#", name: record.name });
    }

    res.json({ url: signedUrl.signedUrl, name: record.name });
  });
  
  app.get("/api/customer/archive/files/:fileId/download", requireAuth, async (req: any, res) => {
    const { fileId } = req.params;
    const user = req.user;
    
    if (!(await canAccessArchiveFileId(user, fileId))) {
      return res.status(404).json({ error: "Bestand niet gevonden." });
    }

    const { data: record } = await supabase.from("archive_files").select("*").eq("id", fileId).single();

    if (!record) return res.status(404).json({ error: "Bestand niet gevonden." });

    const { data: signedUrl, error: signedUrlError } = await supabase.storage.from("archive-files").createSignedUrl(record.storage_path, 60);
    if (signedUrlError || !signedUrl?.signedUrl) {
      return res.json({ url: "#", name: record.name });
    }

    res.json({ url: signedUrl.signedUrl, name: record.name });
  });

  app.post("/api/dossier/archive/files/:fileId/rename", requireAuth, async (req: any, res) => {
    const { fileId } = req.params;
    const { name } = req.body;
    const user = req.user;
    if (user.role === "customer") return res.status(403).json({ error: "Klanten mogen archiefbestanden niet hernoemen." });
    if (!name || !name.trim()) return res.status(400).json({ error: "Bestandsnaam is verplicht." });

    if (!(await canAccessArchiveFileId(user, fileId))) {
      return res.status(404).json({ error: "Bestand niet gevonden." });
    }

    await supabase.from("archive_files").update({ name: name.trim() }).eq("id", fileId);
    res.json({ ok: true });
  });

  app.post("/api/dossier/archive/files/:fileId/delete", requireAuth, async (req: any, res) => {
    const { fileId } = req.params;
    const user = req.user;
    if (user.role === "customer") return res.status(403).json({ error: "Klanten mogen archiefbestanden niet verwijderen." });

    if (!(await canAccessArchiveFileId(user, fileId))) {
      return res.status(404).json({ error: "Bestand niet gevonden." });
    }

    const { data: fileRecord } = await supabase.from("archive_files").select("storage_path").eq("id", fileId).single();
    if (fileRecord) await supabase.storage.from("archive-files").remove([fileRecord.storage_path]);
    
    await supabase.from("archive_files").delete().eq("id", fileId);
    res.json({ ok: true });;
  });

  app.get("/api/dossier/archive/:scope/:scopeId/notes", requireAuth, async (req: any, res) => {
    const { scope, scopeId } = req.params;
    const user = req.user;
    if (user.role === "customer") return res.status(403).json({ error: "Klanten hebben geen toegang tot archiefnotities." });

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

    const { data, error } = await supabase.from("archive_notes").select("*").eq("scope", scope).eq("scope_id", scopeId).order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ notes: data });
  });

  app.post("/api/dossier/archive/:scope/:scopeId/notes", requireAuth, async (req: any, res) => {
    const { scope, scopeId } = req.params;
    const { body } = req.body;
    const user = req.user;
    if (user.role === "customer") return res.status(403).json({ error: "Klanten kunnen geen archiefnotities maken." });

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

    const { data, error } = await supabase.from("archive_notes").insert({
      scope, scope_id: scopeId, body, author_id: user.id
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ note: data });
  });

  app.delete("/api/dossier/archive/notes/:noteId", requireAuth, async (req: any, res) => {
    const { noteId } = req.params;
    const user = req.user;
    if (user.role === "customer") return res.status(403).json({ error: "Klanten mogen archiefnotities niet verwijderen." });

    const { data: note } = await supabase
      .from("archive_notes")
      .select("scope, scope_id")
      .eq("id", noteId)
      .single();
    if (!note) return res.status(404).json({ error: "Notitie niet gevonden." });

    if (note.scope === "folder") {
      if (!(await canAccessFolderId(user, note.scope_id))) {
        return res.status(404).json({ error: "Notitie niet gevonden." });
      }
    } else {
      if (!(await canAccessArchiveFileId(user, note.scope_id))) {
        return res.status(404).json({ error: "Notitie niet gevonden." });
      }
    }

    const { error } = await supabase.from("archive_notes").delete().eq("id", noteId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // ----- Communications & Status (Phase 2L) -----
  app.get("/api/dossier/:customerId/communications", requireAuth, async (req: any, res) => {
    const { customerId } = req.params;
    const user = req.user;
    
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }

    const { data, error = null } = await supabase.from("communications").select("*").eq("customer_id", customerId).order("sent_at", { ascending: false });
    if (error) return res.status(500).json({ error: (error as any).message });
    res.json({ communications: data });
  });

  app.post("/api/dossier/:customerId/communications", requireAuth, async (req: any, res) => {
    const { customerId } = req.params;
    const { subject, body, quarter, year, status } = req.body;
    const user = req.user;

    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }

    if (user.role === "customer") return res.status(403).json({ error: "Klanten kunnen geen dossier-communicatie loggen." });

    const { data, error } = await supabase.from("communications").insert({
      customer_id: customerId,
      user_id: user.id,
      subject,
      body,
      quarter,
      year,
      status: status || 'sent'
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ communication: data });
  });

  app.get("/api/dossier/:customerId/status", requireAuth, async (req: any, res) => {
    const { customerId } = req.params;
    const { year } = req.query;
    const user = req.user;
    
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }

    const y = year ? parseInt(year as string) : new Date().getFullYear();

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
    const quartersWithFiles = new Set<string>();
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
        supabase.from("admin_status").upsert({
          user_id: user.id,
          customer_id: customerId,
          year: y,
          quarter: q,
          status: "in_progress",
          updated_at: new Date().toISOString(),
        }, { onConflict: "customer_id,quarter,year" }).then(null, (e) => {
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

  const updateStatusHandler = async (req: any, res: any) => {
    const { customerId } = req.params;
    const { year, quarter, status } = req.body;
    const user = req.user;

    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }

    if (user.role === "customer") return res.status(403).json({ error: "Klanten kunnen statussen niet wijzigen." });

    const y = parseInt(year || new Date().getFullYear());

    try {
      await supabase.from("admin_status").upsert(
        {
          user_id: user.id,
          customer_id: customerId,
          year: y,
          quarter,
          status,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "customer_id,quarter,year" }
      );
    } catch (err) {
      console.error("Error upserting admin_status:", err);
    }

    res.json({ ok: true, data: updatedStore });
  };

  app.post("/api/dossier/:customerId/status", requireAuth, updateStatusHandler);
  app.put("/api/dossier/:customerId/status", requireAuth, updateStatusHandler);

  app.get("/api/customer/communications", requireAuth, async (req: any, res) => {
    const user = req.user;
    const { data, error } = await supabase.from("communications").select("*").eq("customer_id", user.id).order("sent_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ communications: data });
  });

  app.post("/api/communications/send", requireAuth, upload.single("file"), async (req: any, res) => {
    const { customerId, body = "", subject = "Chat" } = req.body || {};
    const user = req.user;
    const file = req.file;

    if (!customerId) {
      return res.status(400).json({ error: "Klant ID is verplicht." });
    }

    if (!body && !file) {
      return res.status(400).json({ error: "Bericht of bestand is verplicht." });
    }

    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Gesprek niet gevonden." });
    }

    let finalBody = body;

    // Handle file upload if present
    if (file) {
      const ext = path.extname(file.originalname);
      const fileName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
      const filePath = `chat/${customerId}/${fileName}`;

      const { error: storageError } = await supabase.storage
        .from("customer-files")
        .upload(filePath, file.buffer, { contentType: file.mimetype });

      if (storageError) {
        console.error("Storage upload error in chat:", storageError);
        return res.status(500).json({ error: "Bestand kon niet worden opgeslagen." });
      }

      // Insert DB record into files
      const { data: dbFileData, error: dbFileError } = await supabase
        .from("files")
        .insert([{
          customer_id: customerId,
          user_id: user.id,
          original_name: file.originalname,
          mime_type: file.mimetype,
          size_bytes: file.size,
          storage_path: filePath
        }])
        .select()
        .single();

      if (dbFileError) {
        console.error("DB error inserting file in chat:", dbFileError);
        return res.status(500).json({ error: "Fout bij opslaan bestandgegevens." });
      }

      // Format body to include attachment signature
      finalBody = `📎 [attachment:${dbFileData.id}:${file.originalname}:${file.size}:${file.mimetype}]${body}`;
    }

    const { data, error } = await supabase.from("communications").insert({
      customer_id: customerId,
      user_id: user.id,
      subject,
      body: finalBody,
      recipient: user.role === "customer" ? "Boekhouder" : "Klant",
      status: "sent"
    }).select().single();

    if (error) {
      console.error("Error sending communication:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ communication: data });
  });

  // ----- Notifications (Phase 2M) -----
  app.get("/api/customer/notifications", requireAuth, async (req: any, res) => {
    const user = req.user;
    try {
      const { data } = await supabase.from("notifications").select("*").eq("account_id", user.id).order("created_at", { ascending: false });
      res.json({ notifications: mergeNotificationsWithStore(data || [], user.id) });
    } catch {
      res.json({ notifications: mergeNotificationsWithStore([], user.id) });
    }
  });

  app.get("/api/notifications", requireAuth, async (req: any, res) => {
    const user = req.user;
    try {
      const { data } = await supabase.from("notifications").select("*").eq("account_id", user.id).order("created_at", { ascending: false });
      res.json({ notifications: mergeNotificationsWithStore(data || [], user.id), securityWarning: null });
    } catch {
      res.json({ notifications: mergeNotificationsWithStore([], user.id), securityWarning: null });
    }
  });

  app.post("/api/notifications/read", requireAuth, async (req: any, res) => {
    const { ids, all } = req.body;
    const user = req.user;

    try {
      let query = supabase.from("notifications").update({ read: true }).eq("account_id", user.id);
      if (!all && ids && ids.length > 0) {
        query = query.in("id", ids);
      }
      await query;
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });
  
  app.post("/api/customer/notifications/read", requireAuth, async (req: any, res) => {
    const { ids, all } = req.body;
    const user = req.user;

    try {
      let query = supabase.from("notifications").update({ read: true }).eq("account_id", user.id);
      if (!all && ids && ids.length > 0) {
        query = query.in("id", ids);
      }
      await query;
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });

  // ===== EMAIL TEMPLATE & CONFIG ROUTES =====
  app.get("/api/email-status", requireAuth, async (req: any, res) => {
    try {
      const status = isEmailConfigured();
      res.json(status);
    } catch {
      res.json({ configured: false, reason: "SMTP-instellingen niet leesbaar." });
    }
  });

  app.get("/api/email-template", requireAuth, async (req: any, res) => {
    try {
      const key = (req.query.key as string) || "reminder";
      let template = null;
      try {
        const { data } = await supabase.from("email_templates").select("*").eq("key", key).single();
        if (data) template = data;
      } catch {
        // ignore
      }

      if (!template) {
        template = { key: "reminder", subject: "Herinnering documenten voor {{kwartaal}}", body: "Beste {{klant_naam}},\n\nHerinnering om je documenten voor {{kwartaal}} aan te leveren.\n\nMet vriendelijke groet,\n{{boekhouder_naam}}" };
      }

      res.json({ template });
    } catch (err) {
      res.status(500).json({ error: "Kon e-mailtemplate niet ophalen." });
    }
  });

  app.post("/api/email-template", requireAuth, async (req: any, res) => {
    try {
      const { key = "reminder", subject, body } = req.body;
      if (!subject || !body || typeof subject !== "string" || typeof body !== "string") {
        return res.status(400).json({ error: "Onderwerp en e-mailtekst zijn verplicht." });
      }

      const { data: updated, error } = await supabase.from("email_templates").upsert({
        key,
        subject: subject.trim(),
        body: body.trim(),
        updated_at: new Date().toISOString(),
      }).select().single();

      if (error) {
        return res.status(500).json({ error: "Kon e-mailtemplate niet opslaan." });
      }

      res.json({ ok: true, template: updated });
    } catch (err) {
      res.status(500).json({ error: "Kon e-mailtemplate niet opslaan." });
    }
  });

  app.post("/api/dossier/send-reminders", requireAuth, async (req: any, res) => {
    try {
      const { customerIds, quarter, month, subject, body } = req.body;
      const user = req.user;

      if (user.role === "customer") return res.status(403).json({ error: "Geen toegang." });
      if (!customerIds || !Array.isArray(customerIds) || customerIds.length === 0) {
        return res.status(400).json({ error: "Selecteer minstens één klant." });
      }

      let templateSubject = subject;
      let templateBody = body;
      if (!templateSubject || !templateBody) {
        const { data: activeTpl } = await supabase.from("email_templates").select("subject, body").eq("key", "reminder").single();
        if (!templateSubject) templateSubject = activeTpl?.subject || "Herinnering documenten voor {{kwartaal}}";
        if (!templateBody) templateBody = activeTpl?.body || "Beste {{klant_naam}},\n\nHerinnering om je documenten voor {{kwartaal}} aan te leveren.";
      }

      let dbCustomers: any[] = [];
      try {
        const { data } = await supabase.from("accounts").select("id, number, name, email");
        if (data) dbCustomers = data;
      } catch {
        // ignore
      }

      let sentCount = 0;
      let noEmailCount = 0;
      let failedCount = 0;
      let firstFailureError = "";

      const dispatchResults: {
        customerId: string;
        customerName: string;
        email: string;
        status: "accepted" | "failed" | "no_email";
        error?: string;
      }[] = [];

      const currentYear = new Date().getFullYear().toString();

      for (const cid of customerIds) {
        const c = dbCustomers.find((a: any) => a.id === cid || a.number === cid) || {
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

        const render = (text: string) => {
          return text
            .replace(/\{\{klant_naam\}\}/gi, customerName)
            .replace(/\{\{klantnaam\}\}/gi, customerName)
            .replace(/\{\{bedrijfsnaam\}\}/gi, companyName)
            .replace(/\{\{boekhouder_naam\}\}/gi, user.name || "SafeVault Boekhouder")
            .replace(/\{\{kwartaal\}\}/gi, quarter || "Q1")
            .replace(/\{\{maand\}\}/gi, month || "april")
            .replace(/\{\{jaar\}\}/gi, currentYear)
            .replace(/\{\{openstaand_bedrag\}\}/gi, "€ 0,00");
        };

        const finalSubject = render(templateSubject);
        const finalBody = render(templateBody);

        const sendResult = await sendReminderEmail({
          to: customerEmail,
          subject: finalSubject,
          body: finalBody,
          fromName: user.name || "SafeVault Boekhouder",
        });

        if (!sendResult.success) {
          console.warn(`[REMINDER DISPATCH RESULT] For ${customerEmail}:`, sendResult.error);
          failedCount++;
          if (!firstFailureError) firstFailureError = sendResult.error || "E-mail niet geaccepteerd";

          dispatchResults.push({
            customerId: c.id,
            customerName,
            email: customerEmail,
            status: "failed",
            error: sendResult.error,
          });

          await supabase.from("communications").insert({
            customer_id: c.id,
            sender_id: user.id,
            subject: finalSubject,
            body: `[MISLUKT VERZONDEN] ${sendResult.error}\n\n${finalBody}`,
            quarter: quarter || null,
            status: "failed",
          }).catch(() => {});
          continue;
        }

        // Success - email ACCEPTED by provider!
        sentCount++;
        dispatchResults.push({
          customerId: c.id,
          customerName,
          email: customerEmail,
          status: "accepted",
        });

        await supabase.from("communications").insert({
          customer_id: c.id,
          sender_id: user.id,
          subject: finalSubject,
          body: finalBody,
          quarter: quarter || null,
          status: "accepted",
        }).catch(() => {});
      }

      res.json({
        sentCount,
        noEmailCount,
        failedCount,
        error: sentCount === 0 && failedCount > 0 ? firstFailureError : undefined,
        results: dispatchResults,
      });
    } catch (err) {
      console.error("[SERVER REMINDER ROUTE FATAL ERROR]", err);
      res.status(500).json({
        error: "De herinnering kon momenteel niet worden verzonden. Controleer de e-mailinstellingen of probeer het opnieuw."
      });
    }
  });

  // ===== OWNER ROUTES =====
  app.get("/api/owner/stats", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    const [
      { data: allUsers },
      { data: customers },
      { data: blocked },
      { data: files }
    ] = await Promise.all([
      supabase.from("accounts").select("id, number, name, status, role, owner_id, created_at, last_login_at").in("role", ["user", "organization"]),
      supabase.from("accounts").select("id, owner_id").eq("role", "customer"),
      supabase.from("accounts").select("id").eq("status", "blocked"),
      supabase.from("files").select("id, size_bytes")
    ]);

    let totalStorageBytes = 0;
    if (files) {
      totalStorageBytes = files.reduce((acc, f) => acc + (f.size_bytes || 0), 0);
    }

    const usersList = (allUsers || []).filter(u => u.role === "user" || String(u.number).startsWith("89"));
    const orgsList = (allUsers || []).filter(u => u.role === "organization" || String(u.number).startsWith("2"));

    const mappedUsers = (allUsers || []).map(u => {
      const uCusts = (customers || []).filter(c => c.owner_id === u.id);
      return {
        id: u.id,
        number: u.number,
        owner_id: u.owner_id,
        name: u.name,
        status: u.status,
        role: u.role,
        customerCount: uCusts.length,
        storageBytes: 0,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at
      };
    });

    res.json({
      userCount: usersList.length,
      organizationCount: orgsList.length,
      customerCount: customers?.length || 0,
      blockedCount: blocked?.length || 0,
      totalStorageBytes,
      fileCount: files?.length || 0,
      users: mappedUsers
    });
  });

  app.get("/api/owner/customers", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    const { data: customers, error } = await supabase
      .from("accounts")
      .select("id, number, name, status, owner_id, created_at, last_login_at")
      .eq("role", "customer");
    if (error) return res.status(500).json({ error: error.message });

    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, name, number, role");

    const accMap = new Map<string, any>();
    (accounts || []).forEach(a => accMap.set(a.id, a));

    const mappedCustomers = (customers || []).map(c => {
      const ownerAcc = c.owner_id ? accMap.get(c.owner_id) : null;
      return {
        ...c,
        ownerName: ownerAcc ? ownerAcc.name : "Ongekoppeld",
        ownerNumber: ownerAcc ? ownerAcc.number : null,
      };
    });

    res.json({ customers: mappedCustomers });
  });

  app.post("/api/owner/assign-customers", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    const { userId, customerIds } = req.body;
    if (!userId || !Array.isArray(customerIds)) {
      return res.status(400).json({ error: "Ongeldige parameters" });
    }

    // 1. Clear any current customer assignments pointing to this user
    const { error: clearErr } = await supabase
      .from("accounts")
      .update({ owner_id: null })
      .eq("owner_id", userId);

    if (clearErr) {
      return res.status(500).json({ error: "Fout bij ontkoppelen: " + clearErr.message });
    }

    // 2. Set new assignments for the checked customers
    if (customerIds.length > 0) {
      const { error: assignErr } = await supabase
        .from("accounts")
        .update({ owner_id: userId })
        .in("id", customerIds);

      if (assignErr) {
        return res.status(500).json({ error: "Fout bij koppelen: " + assignErr.message });
      }
    }

    res.json({ ok: true });
  });

  app.get("/api/owner/users", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    const { data: users } = await supabase.from("accounts").select("id, number, name, status, role, owner_id, created_at, last_login_at, two_factor_enabled, last_2fa_verified_at").in("role", ["user", "organization"]);
    const { data: customers } = await supabase.from("accounts").select("id, owner_id").eq("role", "customer");

    const userList = users || [];
    const customerList = customers || [];

    // Build org lookup map for organizations (number starting with 2 or role === organization)
    const orgMap = new Map<string, string>();
    userList.forEach(u => {
      if (u.role === "organization" || String(u.number).startsWith("2")) {
        orgMap.set(u.id, u.name);
      }
    });

    const mappedUsers = userList.map(u => {
      const isOrg = u.role === "organization" || String(u.number).startsWith("2");
      let userCount = 0;
      let customerCount = 0;

      if (isOrg) {
        const orgUsers = userList.filter(usr => usr.owner_id === u.id);
        userCount = orgUsers.length;
        const orgUserIds = new Set(orgUsers.map(usr => usr.id));
        customerCount = customerList.filter(c => orgUserIds.has(c.owner_id)).length;
      } else {
        customerCount = customerList.filter(c => c.owner_id === u.id).length;
      }

      const organizationName = u.owner_id && orgMap.has(u.owner_id) ? orgMap.get(u.owner_id) : null;

      return {
        id: u.id,
        number: u.number,
        name: u.name,
        status: u.status,
        role: u.role,
        owner_id: u.owner_id,
        organizationName,
        userCount: isOrg ? userCount : undefined,
        customerCount,
        storageBytes: 0,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at,
        twoFactorEnabled: (u as any).two_factor_enabled ?? false,
        last2faVerifiedAt: (u as any).last_2fa_verified_at ?? null
      };
    });

    res.json({ users: mappedUsers });
  });

  app.post("/api/owner/users/:id/reset-2fa", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    const userId = req.params.id;
    if (!userId) return res.status(400).json({ error: "userId is verplicht" });

    // Reset in Supabase
    try {
      await supabase.from("accounts").update({
        two_factor_enabled: false,
        totp_secret: null,
        last_2fa_verified_at: null,
      }).eq("id", userId);
    } catch (err) {
      console.warn("Supabase 2FA reset notice:", err);
    }

    // Clear active temp challenges for this user
    for (const [token, challenge] of twoFactorChallengeStore.entries()) {
      if (challenge.userId === userId) {
        twoFactorChallengeStore.delete(token);
      }
    }

    await supabase.from("access_logs").insert({
      account_id: userId,
      event: "user_2fa_reset",
      ip: req.ip || "127.0.0.1"
    });

    res.json({ ok: true, message: "De bestaande authenticator-koppeling is verwijderd. De gebruiker moet bij de volgende login opnieuw 2FA instellen." });
  });

  
  app.post("/api/owner/create-organization-bulk", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });

    const { org, users, ownerPassword } = req.body;
    if (!org || !org.number || !org.password || !ownerPassword) {
      return res.status(400).json({ error: "Ontbrekende velden." });
    }

    // Verify owner password
    const { data: ownerCreds } = await supabase.from("credentials").select("password_hash").eq("account_id", req.user.id).single();
    if (!ownerCreds) return res.status(500).json({ error: "Eigenaar inloggegevens niet gevonden." });
    const isMatch = await bcrypt.compare(ownerPassword, ownerCreds.password_hash);
    if (!isMatch) return res.status(401).json({ error: "Onjuist wachtwoord." });

    // Verify org number doesn't exist
    const { data: existingOrg } = await supabase.from("accounts").select("id").eq("number", org.number).single();
    if (existingOrg) return res.status(400).json({ error: "Organisatienummer is al in gebruik." });

    const createdAccountIds: string[] = [];
    try {
      // 1. Create Org
      const orgHash = await bcrypt.hash(org.password, 10);
      const { data: orgAccount, error: orgErr } = await supabase.from("accounts").insert({
        number: org.number, name: org.name, role: "organization", status: "active", owner_id: req.user.id
      }).select().single();
      if (orgErr || !orgAccount) throw new Error(orgErr?.message || "Fout bij aanmaken organisatie.");
      createdAccountIds.push(orgAccount.id);
      
      await supabase.from("credentials").insert({ account_id: orgAccount.id, password_hash: orgHash });

      // 2. Create Users and Customers
      for (const u of users || []) {
        const uHash = await bcrypt.hash(u.password, 10);
        const { data: userAcc, error: uErr } = await supabase.from("accounts").insert({
          number: u.number, name: u.name, role: "user", status: "active", owner_id: orgAccount.id
        }).select().single();
        if (uErr || !userAcc) throw new Error(uErr?.message || "Fout bij aanmaken gebruiker.");
        createdAccountIds.push(userAcc.id);
        
        await supabase.from("credentials").insert({ account_id: userAcc.id, password_hash: uHash });

        // 3. Create Customers
        for (const c of u.customers || []) {
          const cHash = await bcrypt.hash(c.password, 10);
          const { data: custAcc, error: cErr } = await supabase.from("accounts").insert({
            number: c.number, name: c.name, role: "customer", status: "active", owner_id: userAcc.id
          }).select().single();
          if (cErr || !custAcc) throw new Error(cErr?.message || "Fout bij aanmaken klant.");
          createdAccountIds.push(custAcc.id);
          
          await supabase.from("credentials").insert({ account_id: custAcc.id, password_hash: cHash });
        }
      }

      await supabase.from("access_logs").insert({
        account_id: req.user.id,
        event: "organization_bulk_created",
        ip: req.ip || "127.0.0.1",
        metadata: { orgNumber: org.number, usersCount: (users||[]).length }
      });

      res.json({ ok: true });
    } catch (err: any) {
      console.error("Rollback bulk creation due to error:", err);
      if (createdAccountIds.length > 0) {
        try {
          await supabase.from("credentials").delete().in("account_id", createdAccountIds);
          await supabase.from("accounts").delete().in("id", createdAccountIds);
        } catch (cleanupErr) {
          console.error("Error during rollback cleanup:", cleanupErr);
        }
      }
      res.status(500).json({ error: err.message || "Interne fout bij aanmaken organisatie." });
    }
  });

app.post("/api/owner/create-user", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    const { name, number, password } = req.body;
    if (!number || (!number.startsWith("89") && !number.startsWith("2"))) {
      return res.status(400).json({ error: "Nummer moet beginnen met 89 (boekhouder) of 2 (organisatie)" });
    }
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: "Naam is verplicht" });
    }
    if (name.length > 80) {
      return res.status(400).json({ error: "Naam mag maximaal 80 tekens lang zijn" });
    }
    
    const role = number.startsWith("2") ? "organization" : "user";
    const { data: existing } = await supabase.from("accounts").select("id").eq("number", number).single();
    if (existing) return res.status(400).json({ error: "Dit accountnummer is al in gebruik." });

    const hash = await bcrypt.hash(password, 10);
    
    const { data: account, error: accErr } = await supabase.from("accounts").insert({
      number, name, role, status: "active"
    }).select().single();
    
    if (accErr || !account) return res.status(500).json({ error: accErr?.message || "Fout bij aanmaken gebruiker." });

    await supabase.from("credentials").insert({ account_id: account.id, password_hash: hash });

    await supabase.from("access_logs").insert({
      account_id: account.id,
      account_number: number,
      event: "user_created",
      ip: req.ip || "127.0.0.1",
      metadata: { name }
    });

    res.json({ account: sanitizeAccount(account) });
  });

  app.post("/api/owner/create-customers", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    const { userId, count } = req.body;
    const targetOwnerId = userId || req.user.id;
    
    const created = [];
    
    for (let i = 0; i < (count || 1); i++) {
      const number = "6" + Math.floor(100000 + Math.random() * 900000).toString().slice(0, 7);
      const tempPassword = Math.random().toString(36).slice(-8);
      const hash = await bcrypt.hash(tempPassword, 10);
      
      const { data: account, error: accErr } = await supabase.from("accounts").insert({
        number, name: `Klant ${number}`, role: "customer", status: "active", owner_id: targetOwnerId
      }).select().single();
      
      if (!accErr && account) {
        await supabase.from("credentials").insert({ account_id: account.id, password_hash: hash });
        created.push({ number: account.number, name: account.name, tempPassword });
      }
    }
    
    res.json({ created, count: created.length });
  });

  app.post("/api/owner/reset-user-password", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is verplicht" });

    const tempPassword = Math.random().toString(36).slice(-8) + Math.floor(10 + Math.random() * 90);
    const hash = await bcrypt.hash(tempPassword, 10);

    const { error } = await supabase.from("credentials").upsert({
      account_id: userId,
      password_hash: hash
    }, { onConflict: "account_id" });

    if (error) return res.status(500).json({ error: error.message });

    await supabase.from("access_logs").insert({
      account_id: userId,
      event: "user_password_reset",
      ip: req.ip || "127.0.0.1"
    });

    res.json({ tempPassword });
  });

  app.post("/api/owner/delete-user", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is verplicht" });

    const { data: custs } = await supabase.from("accounts").select("id").eq("owner_id", userId);
    const custIds = (custs || []).map(c => c.id);

    const allTargetIds = [userId, ...custIds];

    await supabase.from("sessions").delete().in("account_id", allTargetIds);
    await supabase.from("credentials").delete().in("account_id", allTargetIds);
    await supabase.from("accounts").delete().in("id", allTargetIds);

    await supabase.from("access_logs").insert({
      account_id: userId,
      event: "user_deleted",
      ip: req.ip || "127.0.0.1"
    });

    res.json({ ok: true });
  });

  app.post("/api/owner/unblock", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    const { accountId } = req.body;
    if (!accountId) return res.status(400).json({ error: "accountId is verplicht" });

    const { error } = await supabase.from("accounts").update({
      status: "active",
      failed_attempts: 0
    }).eq("id", accountId);

    if (error) return res.status(500).json({ error: error.message });

    await supabase.from("access_logs").insert({
      account_id: accountId,
      event: "owner_unblock",
      ip: req.ip || "127.0.0.1"
    });

    res.json({ ok: true });
  });

  app.get("/api/owner/blocked", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    const { data: blockedAccs } = await supabase.from("accounts").select("id, number, name, role, created_at, updated_at, owner_id").eq("status", "blocked");
    const { data: owners } = await supabase.from("accounts").select("id, name");

    const mapped = (blockedAccs || []).map(a => {
      const ownerAcc = (owners || []).find(o => o.id === a.owner_id);
      return {
        id: a.id,
        number: a.number,
        name: a.name,
        role: (a.role === "user" || a.role === "bookkeeper") ? "user" : "customer",
        ownerName: ownerAcc?.name || "Systeem",
        blockedAt: a.updated_at || a.created_at
      };
    });

    res.json({ blocked: mapped });
  });

  app.get("/api/owner/warnings", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    const { data: logs } = await supabase.from("access_logs")
      .select("*")
      .in("event", ["login_failed", "login_blocked", "account_blocked", "customer_blocked", "owner_unblock"])
      .order("created_at", { ascending: false })
      .limit(50);

    const mapped = (logs || []).map(l => ({
      id: l.id,
      account_number: l.account_number || "—",
      event: l.event,
      ip: l.ip || "127.0.0.1",
      created_at: l.created_at,
      attempts: l.attempts || undefined
    }));

    res.json({ warnings: mapped });
  });

  app.get("/api/owner/logs", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    const { data: logs } = await supabase.from("access_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    const mapped = (logs || []).map(l => ({
      id: l.id,
      account_number: l.account_number || "—",
      event: l.event,
      ip: l.ip || "127.0.0.1",
      created_at: l.created_at,
      attempts: l.attempts || undefined
    }));

    res.json({ logs: mapped });
  });

  app.get("/api/owner/settings", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    const { data: set, error } = await supabase.from("settings").select("*").single();

    if (error || !set) {
      const defaultSettings = {
        id: 1,
        max_customer_accounts_per_batch: 50,
        max_upload_bytes: 52428800,
        session_lifetime_hours: 5,
        max_login_attempts: 5,
        retention_years: 7
      };
      await supabase.from("settings").insert(defaultSettings);
      return res.json(defaultSettings);
    }

    res.json({
      id: set.id,
      max_customer_accounts_per_batch: set.max_customer_accounts_per_batch ?? 50,
      max_upload_bytes: set.max_upload_bytes ?? 52428800,
      session_lifetime_hours: set.session_lifetime_hours ?? 5,
      max_login_attempts: set.max_login_attempts ?? 5,
      retention_years: set.retention_years ?? 7
    });
  });

  app.post("/api/owner/settings", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    const {
      max_customer_accounts_per_batch,
      max_upload_bytes,
      session_lifetime_hours,
      max_login_attempts,
      retention_years
    } = req.body;

    const payload = {
      id: 1,
      max_customer_accounts_per_batch: Number(max_customer_accounts_per_batch) || 50,
      max_upload_bytes: Number(max_upload_bytes) || 52428800,
      session_lifetime_hours: Number(session_lifetime_hours) || 5,
      max_login_attempts: Number(max_login_attempts) || 5,
      retention_years: Number(retention_years) || 7,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase.from("settings").upsert(payload, { onConflict: "id" }).select().single();

    if (error) {
      console.error("Error updating settings:", error);
      return res.status(500).json({ error: "Fout bij opslaan van instellingen." });
    }

    await supabase.from("access_logs").insert({
      account_id: req.user.id,
      event: "settings_updated",
      ip: req.ip || "127.0.0.1"
    });

    res.json({ ok: true, settings: data });
  });

  app.get("/api/owner/owner-count", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    const { data: owners } = await supabase.from("accounts").select("id").eq("role", "owner");
    res.json({ count: owners?.length || 0 });
  });

  app.post("/api/owner/delete-account", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    
    try {
      const { data: owners, error: ownersErr } = await supabase
        .from("accounts")
        .select("id")
        .eq("role", "owner");
        
      if (ownersErr || !owners) {
        return res.status(500).json({ error: "Kon eigenaarsstatus niet verifiëren." });
      }

      const isLastOwner = owners.length <= 1;
      const { newOwnerName, newOwnerNumber, newOwnerPassword } = req.body || {};

      if (isLastOwner && (!newOwnerName || !newOwnerNumber || !newOwnerPassword)) {
        return res.status(400).json({
          requiresNewOwner: true,
          error: "Je kunt het laatste eigenaar-account niet verwijderen. Maak eerst een nieuwe eigenaar aan."
        });
      }

      if (isLastOwner) {
        if (String(newOwnerPassword).length < 8) {
          return res.status(400).json({ error: "Wachtwoord van nieuwe eigenaar moet minimaal 8 tekens lang zijn." });
        }

        const hash = await bcrypt.hash(String(newOwnerPassword), 10);

        // 1. Insert new owner account
        const { data: newAccount, error: accErr } = await supabase
          .from("accounts")
          .insert({
            name: String(newOwnerName).trim(),
            number: String(newOwnerNumber).trim(),
            role: "owner",
            status: "active"
          })
          .select()
          .single();

        if (accErr || !newAccount) {
          return res.status(500).json({ error: accErr?.message || "Fout bij aanmaken van de nieuwe eigenaar." });
        }

        // 2. Insert new owner credentials
        const { error: credErr } = await supabase
          .from("credentials")
          .insert({
            account_id: newAccount.id,
            password_hash: hash
          });

        if (credErr) {
          await supabase.from("accounts").delete().eq("id", newAccount.id);
          return res.status(500).json({ error: "Fout bij opslaan inloggegevens van de nieuwe eigenaar." });
        }

        // 3. Verify new owner exists
        const { data: verifyAcc } = await supabase
          .from("accounts")
          .select("id")
          .eq("id", newAccount.id)
          .single();

        if (!verifyAcc) {
          return res.status(500).json({ error: "Nieuwe eigenaar kon niet geverifieerd worden. Verwijdering geannuleerd." });
        }
      }

      // 4. Delete old owner account & sessions safely
      const oldAccountId = req.user.id;
      await supabase.from("sessions").delete().eq("account_id", oldAccountId);
      await supabase.from("credentials").delete().eq("account_id", oldAccountId);
      await supabase.from("accounts").delete().eq("id", oldAccountId);

      res.json({ ok: true, message: "Eigenaar-account succesvol verwijderd." });
    } catch (err) {
      console.error("delete-account error:", err);
      res.status(500).json({ error: "Interne serverfout bij verwijderen van eigenaar-account." });
    }
  });

  // Helper for quarterly missing logic
  // Helper for quarterly status logic
  async function getQuarterStatusData(year?: number, allowedCustomerIds?: string[]) {
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

    // Fetch explicit status from admin_status
    const { data: statusRows } = await supabase
      .from("admin_status")
      .select("customer_id, quarter, status")
      .eq("year", targetYear);

    // Map of explicitly set statuses: explicitStatusMap[quarter][customerId] = "done" | "in_progress" | "not_submitted"
    const explicitStatusMap: Record<string, Record<string, string>> = {
      Q1: {}, Q2: {}, Q3: {}, Q4: {}
    };

    if (statusRows) {
      for (const row of statusRows) {
        if (explicitStatusMap[row.quarter]) {
          explicitStatusMap[row.quarter][row.customer_id] = row.status;
        }
      }
    }

    // Determine which customers uploaded files for each quarter
    const filesQuarterSets: Record<string, Set<string>> = {
      Q1: new Set(), Q2: new Set(), Q3: new Set(), Q4: new Set()
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
          const metaList = Array.isArray(f.file_metadata) ? f.file_metadata : (f.file_metadata ? [f.file_metadata] : []);
          for (const meta of metaList) {
            if (meta && custId) {
              const normQ = normalizeQuarter(meta.quarter);
              const yrNum = meta.year ? parseInt(String(meta.year), 10) : targetYear;

              if (yrNum === targetYear && normQ && filesQuarterSets[normQ]) {
                filesQuarterSets[normQ].add(custId);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("Error fetching filesWithMeta in getQuarterStatusData:", err);
    }

    // Classify every customer for every quarter into: not_submitted, in_progress, done
    const statusByQuarter: Record<string, { not_submitted: typeof allCustomers; in_progress: typeof allCustomers; done: typeof allCustomers }> = {
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

    // Legacy backwards compatibility map
    const missingByQuarter: Record<string, typeof allCustomers> = {
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

  // ===== USER ROUTES =====
  app.get("/api/user/stats", requireAuth, async (req: any, res) => {
    const user = req.user;
    if (user.role === "customer" || user.role === "organization") return res.status(403).json({ error: "Geen toegang" });

    const allowedIds = await getAccessibleCustomerIds(user);

    let custQuery = supabase.from("accounts").select("id, status").eq("role", "customer");
    if (user.role !== "owner") {
      if (allowedIds.length > 0) {
        custQuery = custQuery.in("id", allowedIds);
      } else {
        custQuery = custQuery.eq("id", "none");
      }
    }
    const { data: custs } = await custQuery;
    const customerCount = custs?.length || 0;
    const blockedCustomers = custs?.filter((c) => c.status === "blocked").length || 0;

    const quarterData = await getQuarterStatusData(undefined, user.role !== "owner" ? allowedIds : undefined);

    let filesQuery = supabase.from("files").select("id, size_bytes, created_at, customer_id");
    if (user.role !== "owner") {
      if (allowedIds.length > 0) {
        filesQuery = filesQuery.in("customer_id", allowedIds);
      } else {
        filesQuery = filesQuery.eq("customer_id", "none");
      }
    }
    const { data: files } = await filesQuery;

    const totalStorageBytes = files?.reduce((acc, f) => acc + (f.size_bytes || 0), 0) || 0;
    const newUploads = files?.length || 0;

    const today = new Date().toISOString().slice(0, 10);
    const newUploadsToday = files?.filter((f) => f.created_at?.startsWith(today)).length || 0;

    let doneDossiers = 0;
    let openDossiers = 0;
    for (const c of quarterData.allCustomers) {
      const isQ1Done = quarterData.statusByQuarter.Q1.done.some((m) => m.id === c.id);
      const isQ2Done = quarterData.statusByQuarter.Q2.done.some((m) => m.id === c.id);
      const isQ3Done = quarterData.statusByQuarter.Q3.done.some((m) => m.id === c.id);
      const isQ4Done = quarterData.statusByQuarter.Q4.done.some((m) => m.id === c.id);
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

  app.get("/api/user/customers", requireAuth, async (req: any, res) => {
    const user = req.user;
    if (user.role === "customer" || user.role === "organization") return res.status(403).json({ error: "Geen toegang" });

    const allowedIds = await getAccessibleCustomerIds(user);

    let query = supabase.from("accounts").select("id, number, name, status, created_at, last_login_at").eq("role", "customer");
    if (user.role !== "owner") {
      if (allowedIds.length > 0) {
        query = query.in("id", allowedIds);
      } else {
        query = query.eq("id", "none");
      }
    }
    const { data: customers } = await query;
    res.json({ customers: customers || [] });
  });

  app.get("/api/user/quarter-missing", requireAuth, async (req: any, res) => {
    const user = req.user;
    if (user.role === "customer" || user.role === "organization") return res.status(403).json({ error: "Geen toegang" });

    const quarter = (req.query.quarter as string) || "Q1";
    const yearParam = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
    const statusParam = (req.query.status as string) || "not_submitted";

    const allowedIds = await getAccessibleCustomerIds(user);
    const quarterData = await getQuarterStatusData(yearParam, user.role !== "owner" ? allowedIds : undefined);
    const qData = quarterData.statusByQuarter[quarter] || { not_submitted: [], in_progress: [], done: [] };

    const selectedCustomers = statusParam === "done"
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

  app.get("/api/user/storage", requireAuth, async (req: any, res) => {
    const user = req.user;
    if (user.role === "customer" || user.role === "organization") return res.status(403).json({ error: "Geen toegang" });

    try {
      const allowedIds = await getAccessibleCustomerIds(user);
      
      let query = supabase
        .from("files")
        .select("id, original_name, size_bytes, created_at, customer:accounts!files_customer_id_fkey(id, number, name)")
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

      const files = (dbFiles || []).map((f: any) => ({
        id: f.id,
        original_name: f.original_name,
        size_bytes: f.size_bytes || 0,
        created_at: f.created_at,
        customer: f.customer
      }));

      const totalBytes = files.reduce((acc: number, f: any) => acc + f.size_bytes, 0);

      res.json({
        totalBytes,
        fileCount: files.length,
        files
      });
    } catch (err: any) {
      console.error("User storage endpoint error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  // Profile endpoints
  app.get("/api/dossier/:customerId/profile", requireAuth, async (req: any, res) => {
    const { customerId } = req.params;
    const user = req.user;
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Profiel niet gevonden." });
    }

    const { data: account } = await supabase.from("accounts").select("id, number, name, email, role, status, created_at").eq("id", customerId).single();

    res.json({ profile: account || {} });
  });

  const saveDossierProfile = async (req: any, res: any) => {
    const { customerId } = req.params;
    const user = req.user;
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Profiel niet gevonden." });
    }

    if (user.role === "customer" || user.role === "organization") {
      return res.status(403).json({ error: "Klanten kunnen dossierprofielen niet bewerken." });
    }

    const profileData = (req.body && req.body.profile && typeof req.body.profile === "object") ? req.body.profile : req.body;
    const emailVal = profileData.email || profileData.emailaddress || profileData["E-mailadres"] || profileData["email_address"];
    const nameVal = profileData.name || profileData.first_name ? `${profileData.first_name || ""} ${profileData.last_name || ""}`.trim() : undefined;

    const updates: any = {};
    if (emailVal) updates.email = emailVal;
    if (nameVal) updates.name = nameVal;

    if (Object.keys(updates).length > 0) {
      await supabase.from("accounts").update(updates).eq("id", customerId);
    }

    const { data: updatedAccount } = await supabase.from("accounts").select("id, number, name, email, role, status, created_at").eq("id", customerId).single();

    res.json({ ok: true, profile: updatedAccount || {} });
  };

  app.post("/api/dossier/:customerId/profile", requireAuth, saveDossierProfile);
  app.put("/api/dossier/:customerId/profile", requireAuth, saveDossierProfile);

  app.get("/api/customer/profile", requireAuth, async (req: any, res) => {
    const user = req.user;
    const { data: account } = await supabase.from("accounts").select("id, number, name, email, role, status, created_at").eq("id", user.id).single();

    res.json({ profile: account || {} });
  });

  const saveCustomerProfile = async (req: any, res: any) => {
    const user = req.user;
    const profileData = (req.body && req.body.profile && typeof req.body.profile === "object") ? req.body.profile : req.body;

    const emailVal = profileData.email || profileData.emailaddress || profileData["E-mailadres"] || profileData["email_address"];
    const nameVal = profileData.name || (profileData.first_name ? `${profileData.first_name || ""} ${profileData.last_name || ""}`.trim() : undefined);

    const updates: any = {};
    if (emailVal) updates.email = emailVal;
    if (nameVal) updates.name = nameVal;

    if (Object.keys(updates).length > 0) {
      await supabase.from("accounts").update(updates).eq("id", user.id);
    }

    const { data: updatedAccount } = await supabase.from("accounts").select("id, number, name, email, role, status, created_at").eq("id", user.id).single();

    res.json({ ok: true, profile: updatedAccount || {} });
  };

  app.post("/api/customer/profile", requireAuth, saveCustomerProfile);
  app.put("/api/customer/profile", requireAuth, saveCustomerProfile);

  app.get("/api/customer/my-bookkeeper", requireAuth, async (req: any, res) => {
    const user = req.user;
    if (user.role !== "customer") {
      return res.status(403).json({ error: "Alleen klanten kunnen hun boekhouder opvragen." });
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

      res.json({ bookkeeper: { name: ownerAcc.name, number: ownerAcc.number } });
    } catch (err) {
      console.error("Error retrieving bookkeeper:", err);
      res.status(500).json({ error: "Interne serverfout bij ophalen van boekhouder." });
    }
  });

  // BTW calculation endpoints
  app.get("/api/dossier/:customerId/btw", requireAuth, async (req: any, res) => {
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
  
  app.post("/api/dossier/:customerId/btw", requireAuth, async (req: any, res) => {
    const { customerId } = req.params;
    const user = req.user;
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }

    if (user.role === "customer" || user.role === "organization") {
      return res.status(403).json({ error: "Klanten kunnen geen berekeningen opslaan." });
    }

    const bodyData = req.body;
    const { data: saved, error } = await supabase.from("btw_calculations").insert({
      customer_id: customerId,
      user_id: user.id,
      quarter: bodyData.quarter || "Q1",
      year: bodyData.year || new Date().getFullYear(),
      total_inc_21: bodyData.total_inc_21 || bodyData.totaal_incl_21 || 0,
      total_exc_21: bodyData.total_exc_21 || bodyData.totaal_excl_21 || 0,
      total_inc_9: bodyData.total_inc_9 || bodyData.totaal_incl_9 || 0,
      total_exc_9: bodyData.total_exc_9 || bodyData.totaal_excl_9 || 0,
      btw_to_reclaim: bodyData.btw_to_reclaim || bodyData.btw_eindsaldo || 0,
      explanation: bodyData.explanation || JSON.stringify(bodyData)
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, calculation: saved });
  });

  const deleteBtwHandler = async (req: any, res: any) => {
    const { calcId } = req.params;
    const user = req.user;

    if (!(await canAccessBtwCalcId(user, calcId))) {
      return res.status(404).json({ error: "Berekening niet gevonden." });
    }

    if (user.role === "customer" || user.role === "organization") {
      return res.status(403).json({ error: "Klanten kunnen geen berekeningen verwijderen." });
    }

    const { error } = await supabase.from("btw_calculations").delete().eq("id", calcId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  };

  app.post("/api/dossier/btw/:calcId/delete", requireAuth, deleteBtwHandler);
  app.delete("/api/dossier/btw/:calcId", requireAuth, deleteBtwHandler);

  app.post("/api/auth/system-init", async (req, res) => {
    console.log("system-init called");
    try {
      const { name, number, password } = req.body;
      if (!number || !password || !name) {
        return res.status(400).json({ error: "Naam, nummer en wachtwoord zijn verplicht." });
      }
      
      // Check if any accounts exist
      const { count, error: countError } = await supabase
        .from("accounts")
        .select("id", { count: "exact", head: true });
        
      if (countError) {
        console.error("system-init count error:", countError);
        return res.status(500).json({ error: "Interne serverfout tijdens initialisatie-check" });
      } else if (count !== null && count !== 0) {
        console.log("System already initialized, count:", count);
        return res.status(403).json({ error: "Systeem is al geïnitialiseerd." });
      }
      
      // Hash password
      const hash = await bcrypt.hash(password, 10);
      
      // Create owner account
      const { data: account, error: accError } = await supabase.from("accounts").insert({
        number: String(number),
        name: String(name),
        role: "owner",
        status: "active"
      }).select().single();
      
      if (accError || !account) {
        console.error("system-init insert error:", accError);
        return res.status(500).json({ error: accError?.message || "Fout bij aanmaken eigenaar." });
      }

      // Create credentials
      const { error: credError } = await supabase.from("credentials").insert({
        account_id: account.id,
        password_hash: hash
      });

      if (credError) {
        console.error("system-init credentials insert error:", credError);
        await supabase.from("accounts").delete().eq("id", account.id);
        return res.status(500).json({ error: "Fout bij opslaan van inloggegevens." });
      }
      
      console.log("Owner created successfully with ID:", account.id);

      // Create session for immediate auto-login
      const { token, expiresAt } = await createSession(account.id, 5);

      res.json({ 
        ok: true, 
        token, 
        account: { id: account.id, number: account.number, name: account.name, role: account.role, status: account.status },
        expires_at: expiresAt 
      });
    } catch (err) {
      console.error("system-init unexpected error:", err);
      res.status(500).json({ error: "Interne serverfout." });
    }
  });

  app.post("/api/purge", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Geen toegang" });
    
    try {
      await supabase.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("communications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("files").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("credentials").delete().neq("account_id", req.user.id);
      await supabase.from("sessions").delete().neq("account_id", req.user.id);
      await supabase.from("accounts").delete().neq("id", req.user.id);
      
      res.json({ purged: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Purge mislukt." });
    }
  });

  // VAT Engine / Analysis
  app.get("/api/dossier/:customerId/analysis", requireAuth, async (req: any, res) => {
    const { customerId } = req.params;
    const user = req.user;
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }
    res.json({ analysis: null });
  });

  app.post("/api/dossier/:customerId/analyze", requireAuth, async (req: any, res) => {
    const { customerId } = req.params;
    const user = req.user;
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }
    res.json({ analysis: null });
  });

  app.post("/api/dossier/:customerId/analyze-clarify", requireAuth, async (req: any, res) => {
    const { customerId } = req.params;
    const user = req.user;
    if (!(await canAccessCustomer(user, customerId))) {
      return res.status(404).json({ error: "Dossier niet gevonden." });
    }
    res.json({ analysis: null });
  });

  app.post("/api/dossier/analysis/items/:itemId/adjustments", requireAuth, async (req: any, res) => {
    res.json({ ok: true });
  });
  
  app.get("/api/dossier/analysis/items/:itemId/adjustments", requireAuth, async (req: any, res) => {
    res.json({ adjustments: [] });
  });

  // ===== ORGANIZATION & TRANSFER ENDPOINTS =====

  app.get("/api/organization/dashboard", requireAuth, async (req: any, res) => {
    if (req.user.role !== "organization") return res.status(403).json({ error: "Geen toegang" });

    // Users
    const { data: users } = await supabase.from("accounts").select("id, status").eq("role", "user").eq("owner_id", req.user.id);
    const activeUsers = users?.filter(u => u.status === "active").length || 0;
    const userIds = users?.map(u => u.id) || [];

    // Customers
    let custs: any[] = [];
    if (userIds.length > 0) {
      const { data } = await supabase.from("accounts").select("id, status, owner_id").eq("role", "customer").in("owner_id", userIds);
      custs = data || [];
    }
    const totalCustomers = custs.length;

    // Distribution
    const distributionMap: Record<string, number> = {};
    custs.forEach(c => {
      distributionMap[c.owner_id] = (distributionMap[c.owner_id] || 0) + 1;
    });

    const { data: userDetails } = await supabase.from("accounts").select("id, name").in("id", userIds);
    const customerDistribution = userDetails?.map(u => ({
      id: u.id,
      name: u.name,
      count: distributionMap[u.id] || 0
    })) || [];

    // Active Security Warnings count (Aandacht Vereist teller)
    const customerIds = custs.map(c => c.id);
    const orgAccountIds = [req.user.id, ...userIds, ...customerIds];

    const { data: warnings } = await supabase
      .from("access_logs")
      .select("id, metadata")
      .in("account_id", orgAccountIds)
      .in("event", ["login_failed", "login_blocked", "account_blocked", "customer_blocked", "unauthorized_access", "user_password_reset", "user_2fa_reset"]);

    const activeWarningsCount = (warnings || []).filter(w => {
      const meta = w.metadata || {};
      return meta.status !== "Opgelost";
    }).length;

    // Recent Activity (Access logs for organization's accounts)
    const { data: recentActivity } = await supabase
      .from("access_logs")
      .select("*")
      .in("account_id", orgAccountIds)
      .order("created_at", { ascending: false })
      .limit(20);

    res.json({
      totalCustomers,
      activeUsers,
      pendingActions: activeWarningsCount, // maps directly to StatCard for Aandacht Vereist count
      recentActivity: recentActivity || [],
      customerDistribution
    });
  });

  app.get("/api/organization/security-warnings", requireAuth, async (req: any, res) => {
    if (req.user.role !== "organization") return res.status(403).json({ error: "Geen toegang" });

    try {
      const { data: users } = await supabase.from("accounts").select("id, name, number, role").eq("owner_id", req.user.id).eq("role", "user");
      const userIds = users?.map(u => u.id) || [];

      let customers: any[] = [];
      let customerIds: string[] = [];
      if (userIds.length > 0) {
        const { data } = await supabase.from("accounts").select("id, name, number, role").eq("role", "customer").in("owner_id", userIds);
        customers = data || [];
        customerIds = customers.map(c => c.id);
      }

      const orgAccountIds = [req.user.id, ...userIds, ...customerIds];

      const { data: logs, error } = await supabase
        .from("access_logs")
        .select("*")
        .in("account_id", orgAccountIds)
        .in("event", ["login_failed", "login_blocked", "account_blocked", "customer_blocked", "unauthorized_access", "user_password_reset", "user_2fa_reset"])
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching security warnings:", error);
        return res.status(500).json({ error: "Fout bij ophalen van beveiligingswaarschuwingen." });
      }

      const accountMap = new Map<string, { name: string, number: string, role: string }>();
      accountMap.set(req.user.id, { name: req.user.name || "Mijn Organisatie", number: req.user.number || "—", role: "organization" });
      users?.forEach(u => accountMap.set(u.id, { name: u.name, number: u.number, role: "user" }));
      customers.forEach(c => accountMap.set(c.id, { name: c.name, number: c.number, role: "customer" }));

      const mappedWarnings = (logs || []).map(l => {
        const acc = accountMap.get(l.account_id) || { name: `Onbekend (${l.account_number || '—'})`, number: l.account_number || "—", role: "unknown" };
        const meta = l.metadata || {};
        const status = meta.status || "Nieuw";

        let severity = "Warning"; // 🟡
        if (["unauthorized_access", "account_blocked", "customer_blocked"].includes(l.event)) {
          severity = "Critical"; // 🔴
        } else if (l.event === "login_blocked" || (l.event === "login_failed" && meta.failed_attempts >= 5)) {
          severity = "High"; // 🟠
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
          metadata: meta
        };
      });

      res.json({ warnings: mappedWarnings });
    } catch (err: any) {
      console.error("Fout in GET /api/organization/security-warnings:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/organization/security-warnings/:id/status", requireAuth, async (req: any, res) => {
    if (req.user.role !== "organization") return res.status(403).json({ error: "Geen toegang" });

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
        return res.status(404).json({ error: "Beveiligingswaarschuwing niet gevonden." });
      }

      // Enforce organization isolation
      const { data: users } = await supabase.from("accounts").select("id").eq("owner_id", req.user.id).eq("role", "user");
      const userIds = users?.map(u => u.id) || [];

      let customerIds: string[] = [];
      if (userIds.length > 0) {
        const { data } = await supabase.from("accounts").select("id").eq("role", "customer").in("owner_id", userIds);
        customerIds = (data || []).map(c => c.id);
      }

      const orgAccountIds = [req.user.id, ...userIds, ...customerIds];

      if (!orgAccountIds.includes(log.account_id)) {
        return res.status(403).json({ error: "U heeft geen toegang tot deze beveiligingswaarschuwing." });
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
    } catch (err: any) {
      console.error("Fout in POST /api/organization/security-warnings/:id/status:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/organization/users", requireAuth, async (req: any, res) => {
    if (req.user.role !== "organization") return res.status(403).json({ error: "Geen toegang" });

    const { data: users } = await supabase.from("accounts").select("id, number, name, status, last_login_at").eq("role", "user").eq("owner_id", req.user.id);
    const userIds = users?.map(u => u.id) || [];
    
    let custs: any[] = [];
    if (userIds.length > 0) {
      const { data } = await supabase.from("accounts").select("id, owner_id").eq("role", "customer").in("owner_id", userIds);
      custs = data || [];
    }

    const enriched = users?.map(u => ({
      ...u,
      customerCount: custs.filter(c => c.owner_id === u.id).length
    })) || [];

    res.json({ users: enriched });
  });

  app.get("/api/organization/customers", requireAuth, async (req: any, res) => {
    if (req.user.role !== "organization") return res.status(403).json({ error: "Geen toegang" });

    const { data: orgUsers } = await supabase.from("accounts").select("id, name").eq("role", "user").eq("owner_id", req.user.id);
    const userIds = orgUsers?.map(u => u.id) || [];
    const userMap = new Map(orgUsers?.map(u => [u.id, u.name]));

    let customers: any[] = [];
    if (userIds.length > 0) {
      const { data } = await supabase.from("accounts").select("id, number, name, status, created_at, last_login_at, owner_id").eq("role", "customer").in("owner_id", userIds);
      const baseCustomers = data || [];
      const customerIds = baseCustomers.map(c => c.id);
      
      const quarterData = await getQuarterStatusData(undefined, customerIds.length > 0 ? customerIds : ["none"]);
      
      customers = baseCustomers.map(c => {
        const statuses = {
          Q1: quarterData.statusByQuarter.Q1.done.some(x => x.id === c.id) ? "done" : quarterData.statusByQuarter.Q1.in_progress.some(x => x.id === c.id) ? "in_progress" : "not_submitted",
          Q2: quarterData.statusByQuarter.Q2.done.some(x => x.id === c.id) ? "done" : quarterData.statusByQuarter.Q2.in_progress.some(x => x.id === c.id) ? "in_progress" : "not_submitted",
          Q3: quarterData.statusByQuarter.Q3.done.some(x => x.id === c.id) ? "done" : quarterData.statusByQuarter.Q3.in_progress.some(x => x.id === c.id) ? "in_progress" : "not_submitted",
          Q4: quarterData.statusByQuarter.Q4.done.some(x => x.id === c.id) ? "done" : quarterData.statusByQuarter.Q4.in_progress.some(x => x.id === c.id) ? "in_progress" : "not_submitted",
        };

        return {
          ...c,
          assignedUser: userMap.get(c.owner_id) || "Onbekend",
          statuses
        };
      });
    }

    res.json({ customers });
  });

  app.get("/api/organization/eligible-transfer-users", requireAuth, async (req: any, res) => {
    if (req.user.role !== "user") {
      return res.status(403).json({ error: "Geen toegang" });
    }

    const orgId = req.user.role === "organization" ? req.user.id : req.user.owner_id;
    if (!orgId) {
      return res.status(403).json({ error: "Geen toegang: u behoort niet tot een organisatie." });
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

    // Filter out any accounts that might be organizations (number starts with 2) just to be absolutely sure
    const validUsers = (users || []).filter(u => !String(u.number).startsWith("2"));

    res.json({ users: validUsers });
  });

  app.post("/api/user/customers/:customerId/transfer", requireAuth, async (req: any, res) => {
    if (req.user.role !== "user") {
      return res.status(403).json({ error: "Geen toegang" });
    }

    const { customerId } = req.params;
    const { receiverUserId } = req.body;

    if (!customerId || !receiverUserId) {
      return res.status(400).json({ error: "Klant en doelgebruiker zijn verplicht." });
    }

    if (receiverUserId === req.user.id) {
      return res.status(403).json({ error: "Overdracht geweigerd: u kunt een klant niet overdragen aan uzelf." });
    }

    // Step 1: Who is the requesting user and what is their org?
    const senderOrgId = req.user.role === "organization" ? req.user.id : req.user.owner_id;
    if (!senderOrgId) {
      return res.status(403).json({ error: "Overdracht geweigerd: de ingelogde gebruiker behoort niet tot een geregistreerde organisatie." });
    }

    // Step 2 & 3: Fetch customer and check their org
    const { data: customer, error: custErr } = await supabase
      .from("accounts")
      .select("id, number, name, owner_id, role")
      .eq("id", customerId)
      .single();

    if (custErr || !customer || customer.role !== "customer") {
      return res.status(404).json({ error: "Klant niet gevonden." });
    }

    let customerOrgId: string | null = null;
    if (customer.owner_id) {
      const { data: custOwner } = await supabase.from("accounts").select("id, owner_id, number").eq("id", customer.owner_id).single();
      if (custOwner) {
        if (String(custOwner.number).startsWith("2")) {
          customerOrgId = custOwner.id;
        } else {
          customerOrgId = custOwner.owner_id;
        }
      }
    }

    if (customerOrgId !== senderOrgId) {
      return res.status(403).json({ error: "Overdracht geweigerd: deze klant behoort niet tot uw organisatie." });
    }

    // Step 4, 5, 6: Target user checks
    const { data: targetUser, error: targetErr } = await supabase
      .from("accounts")
      .select("id, number, name, role, status, owner_id")
      .eq("id", receiverUserId)
      .single();

    if (targetErr || !targetUser) {
      return res.status(404).json({ error: "Doelgebruiker niet gevonden." });
    }

    if (targetUser.status !== "active") {
      return res.status(403).json({ error: "Overdracht geweigerd: de geselecteerde doelgebruiker is niet actief." });
    }

    if (targetUser.role !== "user" || String(targetUser.number).startsWith("2")) {
      return res.status(403).json({ error: "Overdracht geweigerd: een klant kan alleen aan een actieve boekhouder worden toegewezen, niet aan een organisatie, eigenaar of klant." });
    }

    // Step 7: Does target user belong to exact same organization?
    if (targetUser.owner_id !== senderOrgId) {
      return res.status(403).json({ error: "Overdracht geweigerd: de doelgebruiker behoort niet tot exact dezelfde organisatie als u en de klant." });
    }

    // Perform atomic owner_id update
    const { error: updateErr } = await supabase
      .from("accounts")
      .update({
        owner_id: receiverUserId,
        updated_at: new Date().toISOString()
      })
      .eq("id", customerId);

    if (updateErr) {
      return res.status(500).json({ error: "Fout bij bijwerken klantverantwoordelijke." });
    }

    // Audit log
    await supabase.from("access_logs").insert({
      account_id: customerId,
      account_number: customer.number,
      event: "customer_transferred",
      ip: req.ip || "127.0.0.1",
      metadata: {
        from_user_id: req.user.id,
        to_user_id: receiverUserId,
        previous_owner_id: customer.owner_id,
        organization_id: senderOrgId
      }
    });

    res.json({ ok: true, message: `Klant ${customer.name} is succesvol overgedragen aan ${targetUser.name}.` });
  });

  app.get("/api/organization/settings", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") {
      return res.status(403).json({ error: "Geen toegang: Uitsluitend de eigenaar heeft toegang tot deze instellingen." });
    }
    const { data: setRec } = await supabase.from("settings").select("*").eq("id", 1).single();
    res.json(setRec || {});
  });

  app.post("/api/organization/settings", requireAuth, async (req: any, res) => {
    if (req.user.role !== "owner") {
      return res.status(403).json({ error: "Geen toegang: Uitsluitend de eigenaar heeft toegang tot deze instellingen." });
    }
    const {
      max_customers_per_batch,
      max_upload_bytes,
      session_lifetime_hours,
      max_login_attempts,
      retention_years
    } = req.body;

    const { data: updated, error } = await supabase.from("settings").upsert({
      id: 1,
      max_customer_accounts_per_batch: Number(max_customers_per_batch) || 50,
      max_upload_bytes: Number(max_upload_bytes) || 52428800,
      session_lifetime_hours: Number(session_lifetime_hours) || 24,
      max_login_attempts: Number(max_login_attempts) || 5,
      retention_years: Number(retention_years) || 7,
      updated_at: new Date().toISOString()
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(updated);
  });

  app.post("/api/user/create-customers", requireAuth, async (req: any, res) => {
    if (req.user.role !== "user") {
      return res.status(403).json({ error: "Geen toegang" });
    }
    const { count } = req.body;
    const targetOwnerId = req.user.id;
    
    let maxAllowed = 50;
    const { data: platformSet } = await supabase.from("settings").select("max_customer_accounts_per_batch").eq("id", 1).single();
    if (platformSet && platformSet.max_customer_accounts_per_batch) {
      maxAllowed = platformSet.max_customer_accounts_per_batch;
    }

    if (count > maxAllowed) {
      return res.status(400).json({ error: `U mag maximaal ${maxAllowed} klanten per keer aanmaken.` });
    }

    const created = [];
    for (let i = 0; i < (count || 1); i++) {
      const number = "6" + Math.floor(100000 + Math.random() * 900000).toString().slice(0, 7);
      const tempPassword = Math.random().toString(36).slice(-8);
      const hash = await bcrypt.hash(tempPassword, 10);
      
      const { data: account, error: accErr } = await supabase.from("accounts").insert({
        number, name: `Klant ${number}`, role: "customer", status: "active", owner_id: targetOwnerId
      }).select().single();
      
      if (!accErr && account) {
        await supabase.from("credentials").insert({ account_id: account.id, password_hash: hash });
        created.push({ number: account.number, name: account.name, tempPassword });
      }
    }
    
    res.json({ created, count: created.length });
  });

  app.get("/api/transfers", requireAuth, async (req: any, res) => {
    if (req.user.role !== "user") {
      return res.status(403).json({ error: "Geen toegang" });
    }
    const { data: list } = await supabase.from("transfers").select("*").or(`sender_user_id.eq.${req.user.id},receiver_user_id.eq.${req.user.id}`);
    
    const enriched = [];
    for (const item of (list || [])) {
      const { data: customer } = await supabase.from("accounts").select("id, name, number").eq("id", item.customer_id).single();
      const { data: sender } = await supabase.from("accounts").select("id, name, number").eq("id", item.sender_user_id).single();
      const { data: receiver } = await supabase.from("accounts").select("id, name, number").eq("id", item.receiver_user_id).single();
      
      enriched.push({
        ...item,
        customer: customer || { id: item.customer_id, name: "Onbekend", number: "" },
        sender: sender || { id: item.sender_user_id, name: "Onbekend", number: "" },
        receiver: receiver || { id: item.receiver_user_id, name: "Onbekend", number: "" }
      });
    }
    res.json({ transfers: enriched });
  });

  app.post("/api/transfers", requireAuth, async (req: any, res) => {
    if (req.user.role !== "user") {
      return res.status(403).json({ error: "Geen toegang" });
    }
    const { customerId, receiverUserId } = req.body;
    if (!customerId || !receiverUserId) {
      return res.status(400).json({ error: "Ontbrekende velden" });
    }

    const hasAccess = await canAccessCustomer(req.user, customerId);
    if (!hasAccess) {
      return res.status(403).json({ error: "U heeft geen toestemming voor deze klant." });
    }

    const { data: customer } = await supabase.from("accounts").select("id, owner_id, role").eq("id", customerId).single();
    const { data: targetUser } = await supabase.from("accounts").select("id, status, role, owner_id").eq("id", receiverUserId).single();

    if (!customer || customer.role !== "customer") {
      return res.status(404).json({ error: "Klant niet gevonden." });
    }
    if (!targetUser || targetUser.status !== "active") {
      return res.status(404).json({ error: "Doelgebruiker niet gevonden of niet actief." });
    }

    const senderOrgId = req.user.role === "organization" ? req.user.id : req.user.owner_id;
    const targetOrgId = targetUser.role === "organization" ? targetUser.id : targetUser.owner_id;

    if (!senderOrgId || ((targetOrgId !== senderOrgId) && (targetUser.id !== senderOrgId))) {
      return res.status(403).json({ error: "Overdracht geweigerd: doelgebruiker behoort niet tot dezelfde organisatie." });
    }

    const { data: request, error: insErr } = await supabase.from("transfers").insert({
      sender_user_id: req.user.id,
      receiver_user_id: receiverUserId,
      customer_id: customerId,
      status: "pending_receiver"
    }).select().single();

    if (insErr) return res.status(500).json({ error: insErr.message });
    res.json({ ok: true, transfer: request });
  });

  app.post("/api/transfers/:id/action", requireAuth, async (req: any, res) => {
    if (req.user.role !== "user") {
      return res.status(403).json({ error: "Geen toegang" });
    }
    const { id } = req.params;
    const { action } = req.body;

    const { data: request } = await supabase.from("transfers").select("*").eq("id", id).single();
    if (!request) {
      return res.status(404).json({ error: "Overdrachtsverzoek niet gevonden" });
    }

    if (action === "cancel") {
      if (request.sender_user_id !== req.user.id) {
        return res.status(403).json({ error: "Alleen de verzender kan dit verzoek annuleren." });
      }
      await supabase.from("transfers").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id);
      return res.json({ ok: true });
    }

    if (action === "approve") {
      if (request.receiver_user_id !== req.user.id) {
        return res.status(403).json({ error: "Alleen de ontvanger kan dit verzoek goedkeuren." });
      }
      await supabase.from("transfers").update({ status: "pending_customer", updated_at: new Date().toISOString() }).eq("id", id);
      return res.json({ ok: true });
    }

    if (action === "decline") {
      if (request.receiver_user_id !== req.user.id) {
        return res.status(403).json({ error: "Alleen de ontvanger kan dit verzoek afwijzen." });
      }
      await supabase.from("transfers").update({ status: "declined_receiver", updated_at: new Date().toISOString() }).eq("id", id);
      return res.json({ ok: true });
    }

    res.status(400).json({ error: "Ongeldige actie" });
  });

  app.get("/api/customer/transfers", requireAuth, async (req: any, res) => {
    if (req.user.role !== "customer") {
      return res.status(403).json({ error: "Geen toegang" });
    }
    const { data: list } = await supabase.from("transfers").select("*").eq("customer_id", req.user.id).eq("status", "pending_customer");
    
    const enriched = [];
    for (const item of (list || [])) {
      const { data: sender } = await supabase.from("accounts").select("id, name, number").eq("id", item.sender_user_id).single();
      const { data: receiver } = await supabase.from("accounts").select("id, name, number").eq("id", item.receiver_user_id).single();
      enriched.push({
        ...item,
        sender: sender || { id: item.sender_user_id, name: "Onbekend", number: "" },
        receiver: receiver || { id: item.receiver_user_id, name: "Onbekend", number: "" }
      });
    }
    res.json({ transfers: enriched });
  });

  app.post("/api/customer/transfers/:id/action", requireAuth, async (req: any, res) => {
    if (req.user.role !== "customer") {
      return res.status(403).json({ error: "Geen toegang" });
    }
    const { id } = req.params;
    const { action } = req.body;

    const { data: request } = await supabase.from("transfers").select("*").eq("id", id).single();
    if (!request || request.customer_id !== req.user.id || request.status !== "pending_customer") {
      return res.status(404).json({ error: "Geen lopend overdrachtsverzoek gevonden." });
    }

    if (action === "decline") {
      await supabase.from("transfers").update({ status: "declined_customer", updated_at: new Date().toISOString() }).eq("id", id);
      return res.json({ ok: true });
    }

    if (action === "approve") {
      const { data: receiverUser } = await supabase.from("accounts").select("id, status, role, owner_id").eq("id", request.receiver_user_id).single();
      const { data: senderUser } = await supabase.from("accounts").select("id, role, owner_id").eq("id", request.sender_user_id).single();

      if (!receiverUser || receiverUser.status !== "active") {
        return res.status(400).json({ error: "Doelgebruiker is niet meer actief." });
      }

      const senderOrgId = senderUser?.role === "organization" ? senderUser.id : senderUser?.owner_id;
      const receiverOrgId = receiverUser.role === "organization" ? receiverUser.id : receiverUser.owner_id;

      if (!senderOrgId || ((receiverOrgId !== senderOrgId) && (receiverUser.id !== senderOrgId))) {
        return res.status(403).json({ error: "Overdracht geweigerd: de ontvanger behoort niet tot de organisatie van deze klant." });
      }

      const { error } = await supabase
        .from("accounts")
        .update({ owner_id: request.receiver_user_id, updated_at: new Date().toISOString() })
        .eq("id", request.customer_id);

      if (error) {
        return res.status(500).json({ error: "Fout bij bijwerken van de eigenaar: " + error.message });
      }

      await supabase.from("transfers").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", id);
      return res.json({ ok: true });
    }

    res.status(400).json({ error: "Ongeldige actie" });
  });

  // API 404 catch-all
  app.use("/api", (req, res) => {
    res.status(404).json({ error: "Route niet gevonden." });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Server startup error:", err);
});
