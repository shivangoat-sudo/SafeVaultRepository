import express from "express";
import { supabase } from "./lib/supabase.js";
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
} from "../auth.js";
import bcrypt from "bcryptjs";
import multer from "multer";
import {
  sendReminderEmail,
  isEmailConfigured,
} from "./lib/email.js";

export const app = express();
app.use(express.json());

// Routes (copy from server.ts later)
