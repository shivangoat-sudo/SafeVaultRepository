import fs from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), ".data_store.json");

interface StoreNote {
  id: string;
  customer_id: string;
  author_id: string;
  title: string;
  body: string;
  visible_to_customer: boolean;
  file_path?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  created_at: string;
  updated_at: string;
}

interface StoreVatCalc {
  id: string;
  customer_id: string;
  year: number;
  quarter: string;
  subtotal: number;
  vat21: number;
  vat9: number;
  total_vat: number;
  grand_total: number;
  notes: string;
  created_at: string;
}

interface StoreFile {
  id: string;
  customer_id: string;
  user_id?: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path?: string;
  category?: string;
  quarter?: string;
  year?: number;
  created_at?: string;
}

interface StoreNotification {
  id: string;
  account_id: string;
  kind: string;
  message: string;
  read: boolean;
  created_at: string;
}

interface StoreTemplate {
  key: string;
  subject: string;
  body: string;
  updated_at: string;
}

interface StoreCommunication {
  id: string;
  customer_id: string;
  sender_id: string;
  subject: string;
  body: string;
  quarter?: string;
  status: string;
  sent_at: string;
}

interface StoreArchiveFolder {
  id: string;
  customer_id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

interface StoreArchiveFile {
  id: string;
  customer_id: string;
  user_id: string;
  folder_id: string | null;
  name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
}

interface StoreTwoFactor {
  account_id: string;
  two_factor_enabled: boolean;
  totp_secret: string | null;
  last_2fa_verified_at: string | null;
}

export interface StoreOrganizationSettings {
  id: string;
  max_customers_per_batch: number;
  max_upload_bytes: number;
  session_lifetime_hours: number;
  max_login_attempts: number;
  retention_years: number;
}

export interface StoreTransferRequest {
  id: string;
  sender_user_id: string;
  receiver_user_id: string;
  customer_id: string;
  status: "pending_customer" | "pending_receiver" | "completed" | "declined_customer" | "declined_receiver" | "cancelled";
  created_at: string;
  updated_at: string;
}

export interface StoreChangeHistory {
  nameChanges: string[];
  passwordChanges: string[];
}

interface DataStoreSchema {
  customerProfiles: Record<string, Record<string, unknown>>;
  dossierStatuses: Record<string, Record<string, unknown>>;
  notes: Record<string, StoreNote>;
  vatCalculations: Record<string, StoreVatCalc>;
  uploadedFiles: Record<string, StoreFile>;
  notifications: Record<string, StoreNotification>;
  templates: Record<string, StoreTemplate>;
  communications: Record<string, StoreCommunication>;
  archiveFolders: Record<string, StoreArchiveFolder>;
  archiveFiles: Record<string, StoreArchiveFile>;
  twoFactorAccounts: Record<string, StoreTwoFactor>;
  organizationSettings: Record<string, StoreOrganizationSettings>;
  transferRequests: Record<string, StoreTransferRequest>;
  changeHistory: Record<string, StoreChangeHistory>;
  tempPlaintextPasswords: Record<string, string>;
}

let store: DataStoreSchema = {
  customerProfiles: {},
  dossierStatuses: {},
  notes: {},
  vatCalculations: {},
  uploadedFiles: {},
  notifications: {},
  templates: {},
  communications: {},
  archiveFolders: {},
  archiveFiles: {},
  twoFactorAccounts: {},
  organizationSettings: {},
  transferRequests: {},
  changeHistory: {},
  tempPlaintextPasswords: {},
};

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(content);
      store = {
        customerProfiles: parsed.customerProfiles || {},
        dossierStatuses: parsed.dossierStatuses || {},
        notes: parsed.notes || {},
        vatCalculations: parsed.vatCalculations || {},
        uploadedFiles: parsed.uploadedFiles || {},
        notifications: parsed.notifications || {},
        templates: parsed.templates || {},
        communications: parsed.communications || {},
        archiveFolders: parsed.archiveFolders || {},
        archiveFiles: parsed.archiveFiles || {},
        twoFactorAccounts: parsed.twoFactorAccounts || {},
        organizationSettings: parsed.organizationSettings || {},
        transferRequests: parsed.transferRequests || {},
        changeHistory: parsed.changeHistory || {},
        tempPlaintextPasswords: parsed.tempPlaintextPasswords || {},
      };
    }
  } catch (err) {
    console.error("Error loading data store:", err);
  }
}

function saveStore() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving data store:", err);
  }
}

loadStore();

export const dataStore = {
  // Profiles
  getProfile(customerId: string) {
    const raw = store.customerProfiles[customerId] || {};
    if (raw && typeof raw === "object" && (raw as any).profile && typeof (raw as any).profile === "object") {
      return { ...raw, ...(raw as any).profile };
    }
    return raw;
  },
  setProfile(customerId: string, profile: Record<string, unknown>) {
    const flatProfile = (profile && typeof profile === "object" && (profile as any).profile && typeof (profile as any).profile === "object")
      ? { ...profile, ...(profile as any).profile }
      : profile;

    const existing = store.customerProfiles[customerId] || {};
    const existingUnwrapped = (existing as any).profile ? { ...existing, ...(existing as any).profile } : existing;

    store.customerProfiles[customerId] = {
      ...existingUnwrapped,
      ...flatProfile,
      updated_at: new Date().toISOString(),
    };
    saveStore();
    return store.customerProfiles[customerId];
  },

  // Dossier Status
  getStoreStatuses() {
    return Object.values(store.dossierStatuses || {});
  },
  getStatus(customerId: string, year: number) {
    const quarters = ["Q1", "Q2", "Q3", "Q4"];
    return quarters.map((q) => {
      const key = `${customerId}_${year}_${q}`;
      const existing = store.dossierStatuses[key];
      return existing || { quarter: q, year, status: "not_submitted", updated_at: null };
    });
  },
  setStatus(customerId: string, year: number, quarter: string, status: string) {
    const key = `${customerId}_${year}_${quarter}`;
    const record = {
      id: key,
      customer_id: customerId,
      year,
      quarter,
      status,
      updated_at: new Date().toISOString(),
    };
    store.dossierStatuses[key] = record;
    saveStore();
    return record;
  },

  // Notes
  getNotes(customerId: string, visibleOnly: boolean = false) {
    return Object.values(store.notes)
      .filter((n) => n.customer_id === customerId)
      .filter((n) => !visibleOnly || n.visible_to_customer)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },
  createNote(
    customerId: string,
    authorId: string,
    title: string,
    body: string,
    visibleToCustomer: boolean,
    file_path?: string | null,
    file_name?: string | null,
    file_size?: number | null,
    mime_type?: string | null
  ) {
    const id = "note_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const note = {
      id,
      customer_id: customerId,
      author_id: authorId,
      title,
      body,
      visible_to_customer: visibleToCustomer,
      file_path: file_path || null,
      file_name: file_name || null,
      file_size: file_size || null,
      mime_type: mime_type || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    store.notes[id] = note;
    saveStore();
    return note;
  },
  updateNote(
    noteId: string,
    title: string,
    body: string,
    visibleToCustomer: boolean,
    file_path?: string | null,
    file_name?: string | null,
    file_size?: number | null,
    mime_type?: string | null
  ) {
    const note = store.notes[noteId];
    if (!note) return null;
    note.title = title;
    note.body = body;
    note.visible_to_customer = visibleToCustomer;
    if (file_path !== undefined) note.file_path = file_path;
    if (file_name !== undefined) note.file_name = file_name;
    if (file_size !== undefined) note.file_size = file_size;
    if (mime_type !== undefined) note.mime_type = mime_type;
    note.updated_at = new Date().toISOString();
    saveStore();
    return note;
  },
  deleteNote(noteId: string) {
    if (store.notes[noteId]) {
      delete store.notes[noteId];
      saveStore();
      return true;
    }
    return false;
  },

  // VAT Calculations
  getBtwCalculations(customerId: string) {
    return Object.values(store.vatCalculations)
      .filter((c) => c.customer_id === customerId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },
  saveBtwCalculation(customerId: string, calc: Partial<StoreVatCalc>) {
    const id = calc.id || "btw_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const record: StoreVatCalc = {
      id,
      customer_id: customerId,
      year: calc.year || new Date().getFullYear(),
      quarter: calc.quarter || "Q1",
      subtotal: calc.subtotal || 0,
      vat21: calc.vat21 || 0,
      vat9: calc.vat9 || 0,
      total_vat: calc.total_vat || 0,
      grand_total: calc.grand_total || 0,
      notes: calc.notes || "",
      created_at: new Date().toISOString(),
    };
    store.vatCalculations[id] = record;
    saveStore();
    return record;
  },
  deleteBtwCalculation(calcId: string) {
    if (store.vatCalculations[calcId]) {
      delete store.vatCalculations[calcId];
      saveStore();
      return true;
    }
    return false;
  },

  // Uploaded Files
  addFile(file: {
    id: string;
    customer_id: string;
    user_id?: string;
    original_name: string;
    mime_type: string;
    size_bytes: number;
    storage_path?: string;
    category?: string;
    quarter?: string;
    year?: number;
    created_at?: string;
  }) {
    if (!store.uploadedFiles) store.uploadedFiles = {};
    const record = {
      ...file,
      created_at: file.created_at || new Date().toISOString(),
    };
    store.uploadedFiles[file.id] = record;
    saveStore();
    return record;
  },
  getFiles(customerId?: string) {
    if (!store.uploadedFiles) return [];
    const list = Object.values(store.uploadedFiles);
    if (customerId) return list.filter((f) => f.customer_id === customerId);
    return list;
  },

  // Notifications
  addNotification(accountId: string, kind: string, message: string) {
    if (!store.notifications) store.notifications = {};
    const id = "notif_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const notif = {
      id,
      account_id: accountId,
      kind,
      message,
      read: false,
      created_at: new Date().toISOString(),
    };
    store.notifications[id] = notif;
    saveStore();
    return notif;
  },
  getNotifications(accountId: string) {
    if (!store.notifications) return [];
    return Object.values(store.notifications)
      .filter((n) => n.account_id === accountId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },
  markNotificationsRead(accountId: string, ids?: string[]) {
    if (!store.notifications) return;
    for (const n of Object.values(store.notifications)) {
      if (n.account_id === accountId && (!ids || ids.length === 0 || ids.includes(n.id))) {
        n.read = true;
      }
    }
    saveStore();
  },

  // Templates
  getTemplate(key: string = "reminder") {
    if (!store.templates) store.templates = {};
    if (store.templates[key]) return store.templates[key];

    const defaultReminder = {
      key: "reminder",
      subject: "Herinnering: aanleveren documenten {{kwartaal}} {{jaar}}",
      body: "Beste {{klant_naam}},\n\nDit is een vriendelijke herinnering om uw boekhoudkundige stukken voor {{kwartaal}} {{jaar}} aan te leveren. De uiterste inleverdatum is {{maand}}.\n\nBedrijfsnaam: {{bedrijfsnaam}}\nBoekhouder: {{boekhouder_naam}}\n\nMet vriendelijke groet,\n{{boekhouder_naam}}",
      updated_at: new Date().toISOString(),
    };
    return defaultReminder;
  },
  setTemplate(key: string, subject: string, body: string) {
    if (!store.templates) store.templates = {};
    const t = {
      key,
      subject,
      body,
      updated_at: new Date().toISOString(),
    };
    store.templates[key] = t;
    saveStore();
    return t;
  },

  // Communications
  addCommunication(comm: {
    customer_id: string;
    sender_id: string;
    subject: string;
    body: string;
    quarter?: string;
    status?: string;
  }) {
    if (!store.communications) store.communications = {};
    const id = "comm_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const record: StoreCommunication = {
      id,
      customer_id: comm.customer_id,
      sender_id: comm.sender_id,
      subject: comm.subject,
      body: comm.body,
      quarter: comm.quarter,
      status: comm.status || "sent",
      sent_at: new Date().toISOString(),
    };
    store.communications[id] = record;
    saveStore();
    return record;
  },
  getCommunications(customerId: string) {
    if (!store.communications) return [];
    return Object.values(store.communications)
      .filter((c) => c.customer_id === customerId)
      .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
  },

  // Archive
  getArchive(customerId: string, folderId?: string | null) {
    if (!store.archiveFolders) store.archiveFolders = {};
    if (!store.archiveFiles) store.archiveFiles = {};

    const targetFolderId = folderId || null;

    const folders = Object.values(store.archiveFolders).filter(
      (f) => f.customer_id === customerId && (f.parent_id || null) === targetFolderId
    );

    const files = Object.values(store.archiveFiles).filter(
      (f) => f.customer_id === customerId && (f.folder_id || null) === targetFolderId
    );

    return { folders, files };
  },

  addArchiveFolder(customerId: string, userId: string, name: string, parentId?: string | null) {
    if (!store.archiveFolders) store.archiveFolders = {};
    const id = "folder_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const folder: StoreArchiveFolder = {
      id,
      customer_id: customerId,
      user_id: userId || customerId,
      name,
      parent_id: parentId || null,
      created_at: new Date().toISOString(),
    };
    store.archiveFolders[id] = folder;
    saveStore();
    return folder;
  },

  renameArchiveFolder(folderId: string, name: string) {
    if (!store.archiveFolders) store.archiveFolders = {};
    if (store.archiveFolders[folderId]) {
      store.archiveFolders[folderId].name = name;
      saveStore();
      return true;
    }
    return false;
  },

  deleteArchiveFolder(folderId: string) {
    if (!store.archiveFolders) store.archiveFolders = {};
    if (store.archiveFolders[folderId]) {
      delete store.archiveFolders[folderId];
      saveStore();
      return true;
    }
    return false;
  },

  addArchiveFile(file: {
    customerId: string;
    userId: string;
    folderId?: string | null;
    name: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
  }) {
    if (!store.archiveFiles) store.archiveFiles = {};
    const id = "archfile_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const archFile: StoreArchiveFile = {
      id,
      customer_id: file.customerId,
      user_id: file.userId || file.customerId,
      folder_id: file.folderId || null,
      name: file.name,
      mime_type: file.mimeType,
      size_bytes: file.sizeBytes,
      storage_path: file.storagePath,
      created_at: new Date().toISOString(),
    };
    store.archiveFiles[id] = archFile;
    saveStore();
    return archFile;
  },

  getArchiveFile(fileId: string) {
    if (!store.archiveFiles) store.archiveFiles = {};
    return store.archiveFiles[fileId] || null;
  },

  renameArchiveFile(fileId: string, name: string) {
    if (!store.archiveFiles) store.archiveFiles = {};
    if (store.archiveFiles[fileId]) {
      store.archiveFiles[fileId].name = name;
      saveStore();
      return true;
    }
    return false;
  },

  deleteArchiveFile(fileId: string) {
    if (!store.archiveFiles) store.archiveFiles = {};
    if (store.archiveFiles[fileId]) {
      delete store.archiveFiles[fileId];
      saveStore();
      return true;
    }
    return false;
  },

  // 2FA Management
  get2FA(accountId: string) {
    if (!store.twoFactorAccounts) store.twoFactorAccounts = {};
    return store.twoFactorAccounts[accountId] || {
      account_id: accountId,
      two_factor_enabled: false,
      totp_secret: null,
      last_2fa_verified_at: null,
    };
  },

  set2FA(accountId: string, data: { two_factor_enabled?: boolean; totp_secret?: string | null; last_2fa_verified_at?: string | null }) {
    if (!store.twoFactorAccounts) store.twoFactorAccounts = {};
    const existing = store.twoFactorAccounts[accountId] || {
      account_id: accountId,
      two_factor_enabled: false,
      totp_secret: null,
      last_2fa_verified_at: null,
    };

    store.twoFactorAccounts[accountId] = {
      account_id: accountId,
      two_factor_enabled: data.two_factor_enabled ?? existing.two_factor_enabled,
      totp_secret: data.totp_secret !== undefined ? data.totp_secret : existing.totp_secret,
      last_2fa_verified_at: data.last_2fa_verified_at !== undefined ? data.last_2fa_verified_at : existing.last_2fa_verified_at,
    };
    saveStore();
    return store.twoFactorAccounts[accountId];
  },

  reset2FA(accountId: string) {
    if (!store.twoFactorAccounts) store.twoFactorAccounts = {};
    store.twoFactorAccounts[accountId] = {
      account_id: accountId,
      two_factor_enabled: false,
      totp_secret: null,
      last_2fa_verified_at: null,
    };
    saveStore();
    return true;
  },

  // Organization Settings
  getOrgSettings(orgId: string): StoreOrganizationSettings {
    if (!store.organizationSettings) store.organizationSettings = {};
    if (!store.organizationSettings[orgId]) {
      store.organizationSettings[orgId] = {
        id: orgId,
        max_customers_per_batch: 500,
        max_upload_bytes: 52428800,
        session_lifetime_hours: 5,
        max_login_attempts: 5,
        retention_years: 7,
      };
      saveStore();
    }
    return store.organizationSettings[orgId];
  },

  setOrgSettings(orgId: string, settings: Partial<StoreOrganizationSettings>): StoreOrganizationSettings {
    const existing = this.getOrgSettings(orgId);
    store.organizationSettings[orgId] = {
      ...existing,
      ...settings,
    };
    saveStore();
    return store.organizationSettings[orgId];
  },

  // Change History Limits (Max 2 times per 14 days)
  trackNameChange(accountId: string): boolean {
    if (!store.changeHistory) store.changeHistory = {};
    if (!store.changeHistory[accountId]) {
      store.changeHistory[accountId] = { nameChanges: [], passwordChanges: [] };
    }
    const history = store.changeHistory[accountId];
    const now = new Date().toISOString();
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    
    // Filter active changes in the last 14 days
    history.nameChanges = (history.nameChanges || []).filter(
      (ts) => new Date(ts).getTime() > fourteenDaysAgo
    );

    if (history.nameChanges.length >= 2) {
      return false;
    }

    history.nameChanges.push(now);
    saveStore();
    return true;
  },

  trackPasswordChange(accountId: string): boolean {
    if (!store.changeHistory) store.changeHistory = {};
    if (!store.changeHistory[accountId]) {
      store.changeHistory[accountId] = { nameChanges: [], passwordChanges: [] };
    }
    const history = store.changeHistory[accountId];
    const now = new Date().toISOString();
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    
    // Filter active changes in the last 14 days
    history.passwordChanges = (history.passwordChanges || []).filter(
      (ts) => new Date(ts).getTime() > fourteenDaysAgo
    );

    if (history.passwordChanges.length >= 2) {
      return false;
    }

    history.passwordChanges.push(now);
    saveStore();
    return true;
  },

  // Temporary Plaintext Passwords (for PDF generation)
  setTempPassword(accountId: string, password: string) {
    if (!store.tempPlaintextPasswords) store.tempPlaintextPasswords = {};
    store.tempPlaintextPasswords[accountId] = password;
    saveStore();
  },

  getTempPassword(accountId: string): string | null {
    if (!store.tempPlaintextPasswords) return null;
    return store.tempPlaintextPasswords[accountId] || null;
  },

  clearTempPassword(accountId: string) {
    if (store.tempPlaintextPasswords && store.tempPlaintextPasswords[accountId]) {
      delete store.tempPlaintextPasswords[accountId];
      saveStore();
    }
  },

  // Transfer Requests
  createTransferRequest(senderUserId: string, receiverUserId: string, customerId: string): StoreTransferRequest {
    if (!store.transferRequests) store.transferRequests = {};
    const id = "trans_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const request: StoreTransferRequest = {
      id,
      sender_user_id: senderUserId,
      receiver_user_id: receiverUserId,
      customer_id: customerId,
      status: "pending_receiver",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    store.transferRequests[id] = request;
    saveStore();
    return request;
  },

  getTransferRequest(id: string): StoreTransferRequest | null {
    if (!store.transferRequests) return null;
    return store.transferRequests[id] || null;
  },

  getTransferRequests(): StoreTransferRequest[] {
    if (!store.transferRequests) return [];
    return Object.values(store.transferRequests);
  },

  updateTransferRequestStatus(id: string, status: StoreTransferRequest["status"]): StoreTransferRequest | null {
    if (!store.transferRequests) return null;
    const req = store.transferRequests[id];
    if (!req) return null;
    req.status = status;
    req.updated_at = new Date().toISOString();
    saveStore();
    return req;
  },
};


