import type {
  LoginResponse,
  AuthAccount,
  OwnerStats,
  OwnerOrganization,
  OwnerUser,
  WarningLog,
  BlockedAccount,
  SettingsData,
  UserStats,
  CustomerRow,
  FileRow,
  Notification,
  SecurityWarning,
  StorageFile,
  ProfileData,
  ArchiveFolder,
  ArchiveFile,
  ArchiveNote,
  BtwCalculation,
  UserNote,
  Communication,
  AdminStatusRow,
  AnalysisResult,
  ItemAdjustment,
  ReminderResult,
} from "@/types";

export const FN_BASE = "/api";

const TOKEN_KEY = "boekhoud_session_token";
const ACCOUNT_KEY = "boekhoud_session_account";

let sessionToken: string | null = null;
let sessionAccount: AuthAccount | null = null;

function loadPersistedSession() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const accountJson = localStorage.getItem(ACCOUNT_KEY);
    if (token && accountJson) {
      sessionToken = token;
      sessionAccount = JSON.parse(accountJson) as AuthAccount;
    }
  } catch {
    // localStorage may be unavailable (private mode) — fall back to in-memory only
  }
}

loadPersistedSession();

export function setSession(token: string, account: AuthAccount) {
  sessionToken = token;
  sessionAccount = account;
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  } catch {
    // ignore storage errors
  }
}

export function clearSession() {
  sessionToken = null;
  sessionAccount = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    // ignore storage errors
  }
}

export function getSessionToken(): string | null {
  return sessionToken;
}

export function getSessionAccount(): AuthAccount | null {
  return sessionAccount;
}

function authHeaders(extra?: HeadersInit): Record<string, string> {
  const h: Record<string, string> = {};
  if (sessionToken) h["Authorization"] = `Bearer ${sessionToken}`;
  return { ...h, ...((extra as Record<string, string> | undefined) ?? {}) };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const headers: Record<string, string> = { ...authHeaders() };
  if (!isFormData) headers["Content-Type"] = "application/json";
  Object.assign(headers, (init?.headers as Record<string, string> | undefined) ?? {});
  let res: Response;
  try {
    res = await fetch(`${FN_BASE}${path}`, { ...init, headers });
  } catch {
    // Network-level failure: server unreachable, CORS blocked, or timeout.
    // Surface a clear message instead of a raw "Failed to fetch".
    throw new Error("Kan geen verbinding maken met de server. Controleer uw internetverbinding en probeer het opnieuw.");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (res.status === 401) {
    const serverErr = (data as { error?: string })?.error;
    if (path === "/auth/login") {
      throw new Error(serverErr || "Onjuist nummer of wachtwoord.");
    }
    clearSession();
    if (typeof window !== "undefined" && window.location.pathname !== "/") {
      window.location.href = "/";
    }
    throw new Error(serverErr || "Uw sessie is verlopen. Log opnieuw in.");
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `Fout (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

// ===== Auth =====
export const api = {
  setupStatus: async () => {
    const res = await request<{ initialized: boolean }>("/auth/setup-status");
    return res;
  },
  systemInit: (name: string, number: string, password: string) =>
    request<LoginResponse & { ok: boolean }>("/auth/system-init", {
      method: "POST",
      body: JSON.stringify({ name, number, password }),
    }),
  login: (name: string, number: string, password: string) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ name, number, password }),
    }),
  verify2fa: (tempToken: string, code: string) =>
    request<LoginResponse>("/auth/verify-2fa", {
      method: "POST",
      body: JSON.stringify({ tempToken, code }),
    }),
  setup2faInit: (tempToken: string) =>
    request<{ qrCodeUrl: string; accountName: string; number: string }>("/auth/2fa/setup-init", {
      method: "POST",
      body: JSON.stringify({ tempToken }),
    }),
  setup2faVerify: (tempToken: string, code: string) =>
    request<LoginResponse>("/auth/2fa/setup-verify", {
      method: "POST",
      body: JSON.stringify({ tempToken, code }),
    }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  me: () => request<AuthAccount>("/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  changeName: (newName: string) =>
    request<{ ok: boolean; name: string }>("/auth/change-name", {
      method: "POST",
      body: JSON.stringify({ newName }),
    }),

  // ===== Organization & User Extra =====
  orgDashboard: () => request<any>("/organization/dashboard"),
  orgUsers: () => request<{ users: any[] }>("/organization/users"),
  orgCustomers: () => request<{ customers: any[] }>("/organization/customers"),
  orgSettings: () => request<SettingsData>("/organization/settings"),
  updateOrgSettings: (data: Partial<SettingsData>) =>
    request<{ ok: boolean }>("/organization/settings", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  orgSecurityWarnings: () => request<{ warnings: any[] }>("/organization/security-warnings"),
  updateOrgSecurityWarningStatus: (id: string, status: string) =>
    request<{ ok: boolean; status: string }>(`/organization/security-warnings/${id}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
  userCreateCustomers: (count: number) =>
    request<{ created: { number: string; name: string; tempPassword: string }[]; count: number }>(
      "/user/create-customers",
      { method: "POST", body: JSON.stringify({ count }) },
    ),

  // ===== Owner =====
  ownerStats: () => request<OwnerStats>("/owner/stats"),
  ownerOrganizations: () => request<{ organizations: OwnerOrganization[] }>("/owner/organizations"),
  ownerUsers: () => request<{ users: OwnerUser[] }>("/owner/users"),
  ownerCustomers: () => request<{ customers: { id: string; number: string; name: string; status: string; owner_id: string | null }[] }>("/owner/customers"),
  ownerAssignCustomers: (userId: string, customerIds: string[]) =>
    request<{ ok: boolean }>("/owner/assign-customers", {
      method: "POST",
      body: JSON.stringify({ userId, customerIds }),
    }),
  ownerCreateOrganizationBulk: (data: any) =>
    request<{ ok: boolean }>("/owner/create-organization-bulk", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  ownerCreateUser: (name: string, number: string, password: string) =>
    request<{ account: { id: string; number: string; name: string; role: string } }>(
      "/owner/create-user",
      { method: "POST", body: JSON.stringify({ name, number, password }) },
    ),
  ownerCreateCustomers: (userId: string, count: number) =>
    request<{ created: { number: string; name: string; tempPassword: string }[]; count: number }>(
      "/owner/create-customers",
      { method: "POST", body: JSON.stringify({ userId, count }) },
    ),
  ownerResetUserPassword: (userId: string) =>
    request<{ tempPassword: string }>("/owner/reset-user-password", {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),
  ownerReset2fa: (userId: string) =>
    request<{ ok: boolean; message: string }>(`/owner/users/${userId}/reset-2fa`, {
      method: "POST",
    }),
  ownerDeleteUser: (userId: string) =>
    request<{ ok: boolean }>("/owner/delete-user", {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),
  ownerUnblock: (accountId: string) =>
    request<{ ok: boolean }>("/owner/unblock", {
      method: "POST",
      body: JSON.stringify({ accountId }),
    }),
  ownerResolveWarning: (id: string) =>
    request<{ ok: boolean }>(`/owner/warnings/${id}/resolve`, {
      method: "POST"
    }),
  ownerResolveAllWarnings: () =>
    request<{ ok: boolean }>("/owner/warnings/resolve-all", {
      method: "POST"
    }),
  ownerBlocked: () => request<{ blocked: BlockedAccount[] }>("/owner/blocked"),
  ownerWarnings: () => request<{ warnings: WarningLog[] }>("/owner/warnings"),
  ownerLogs: () => request<{ logs: WarningLog[] }>("/owner/logs"),
  ownerGetSettings: () => request<SettingsData>("/owner/settings"),
  ownerUpdateSettings: (settings: Partial<SettingsData>) =>
    request<{ ok: boolean }>("/owner/settings", {
      method: "POST",
      body: JSON.stringify(settings),
    }),
  ownerCount: () => request<{ count: number }>("/owner/owner-count"),
  deleteOwnerAccount: (payload?: { password?: string; newOwnerName?: string; newOwnerNumber?: string; newOwnerPassword?: string }) =>
    request<{ ok: boolean; message?: string; requiresNewOwner?: boolean }>("/owner/delete-account", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    }),

  // ===== User =====
  userStats: () => request<UserStats>("/user/stats"),
  userCustomers: (query?: string) =>
    request<{ customers: CustomerRow[] }>(`/user/customers${query ? `?${query}` : ""}`),
  userFiles: () => request<{ files: FileRow[] }>("/user/files"),
  userCustomerFiles: (customerId: string) =>
    request<{ customer: CustomerRow; files: FileRow[] }>(`/user/customers/${customerId}/files`),
  userFileDownload: (fileId: string) =>
    request<{ url: string; mimeType: string; originalName: string }>(`/user/files/${fileId}/download`),
  userFileView: (fileId: string) =>
    request<{ url: string; mimeType: string; originalName: string }>(`/user/files/${fileId}/view`),
  userFileDelete: (fileId: string) =>
    request<{ ok: boolean }>(`/user/files/${fileId}/delete`, { method: "POST" }),
  userUnblockCustomer: (customerId: string) =>
    request<{ ok: boolean }>("/user/unblock-customer", {
      method: "POST",
      body: JSON.stringify({ customerId }),
    }),
  userDeleteCustomer: (customerId: string) =>
    request<{ ok: boolean }>("/user/delete-customer", {
      method: "POST",
      body: JSON.stringify({ customerId }),
    }),
  userStorage: () =>
    request<{ totalBytes: number; fileCount: number; files: StorageFile[] }>("/user/storage"),
  userQuarterMissing: (quarter: string, year?: number, status?: string) =>
    request<{
      customers: CustomerRow[];
      quarter: string;
      year: number;
      status: string;
      totalCount: number;
      submittedCount: number;
      missingCount: number;
      notSubmittedCount?: number;
      inProgressCount?: number;
      doneCount?: number;
    }>(
      `/user/quarter-missing?quarter=${quarter}&year=${year ?? new Date().getFullYear()}${status ? `&status=${status}` : ""}`,
    ),

  // ===== Dossier =====
  dossierProfile: (customerId: string) =>
    request<{ customer: CustomerRow; profile: ProfileData }>(`/dossier/${customerId}/profile`),
  dossierUpdateProfile: (customerId: string, profile: ProfileData) =>
    request<{ ok: boolean }>(`/dossier/${customerId}/profile`, { method: "PUT", body: JSON.stringify({ profile }) }),
  dossierUploads: (customerId: string) =>
    request<{ files: FileRow[] }>(`/dossier/${customerId}/uploads`),
  dossierUpdateFileMetadata: (fileId: string, data: { category: string; quarter: string | null; year: number | null }) =>
    request<{ ok: boolean }>(`/dossier/files/${fileId}/metadata`, { method: "PUT", body: JSON.stringify(data) }),
  dossierArchive: (customerId: string, folderId?: string | null) =>
    request<{ folders: ArchiveFolder[]; files: ArchiveFile[]; notes: UserNote[] }>(`/dossier/${customerId}/archive${folderId ? `?folderId=${folderId}` : ""}`),
  dossierArchiveAllFolders: (customerId: string) =>
    request<{ folders: ArchiveFolder[] }>(`/dossier/${customerId}/archive/all-folders`),
  dossierMoveNoteToArchive: (noteId: string, folderId: string) =>
    request<{ ok: boolean; note: UserNote }>(`/dossier/notes/${noteId}/move-to-archive`, {
      method: "POST",
      body: JSON.stringify({ folderId }),
    }),
  dossierRestoreNoteFromArchive: (noteId: string) =>
    request<{ ok: boolean; note: UserNote }>(`/dossier/notes/${noteId}/restore-to-notes`, {
      method: "POST",
    }),
  dossierCreateFolder: (customerId: string, name: string, parentId?: string | null) =>
    request<{ folder: ArchiveFolder }>(`/dossier/${customerId}/archive/folders`, { method: "POST", body: JSON.stringify({ name, parentId: parentId ?? null }) }),
  dossierRenameFolder: (folderId: string, name: string) =>
    request<{ ok: boolean }>(`/dossier/archive/folders/${folderId}/rename`, { method: "POST", body: JSON.stringify({ name }) }),
  dossierDeleteFolder: (folderId: string) =>
    request<{ ok: boolean }>(`/dossier/archive/folders/${folderId}/delete`, { method: "POST" }),
  dossierUploadArchiveFile: (customerId: string, file: File, folderId?: string | null) => {
    const form = new FormData();
    form.append("file", file);
    if (folderId) form.append("folderId", folderId);
    return request<{ file: ArchiveFile }>(`/dossier/${customerId}/archive/files`, { method: "POST", body: form });
  },
  dossierDownloadArchiveFile: (fileId: string) =>
    request<{ url: string; name: string }>(`/dossier/archive/files/${fileId}/download`),
  dossierRenameArchiveFile: (fileId: string, name: string) =>
    request<{ ok: boolean }>(`/dossier/archive/files/${fileId}/rename`, { method: "POST", body: JSON.stringify({ name }) }),
  dossierDeleteArchiveFile: (fileId: string) =>
    request<{ ok: boolean }>(`/dossier/archive/files/${fileId}/delete`, { method: "POST" }),
  dossierArchiveNotes: (scope: "folder" | "file", scopeId: string) =>
    request<{ notes: ArchiveNote[] }>(`/dossier/archive/${scope}/${scopeId}/notes`),
  dossierAddArchiveNote: (scope: "folder" | "file", scopeId: string, body: string) =>
    request<{ note: ArchiveNote }>(`/dossier/archive/${scope}/${scopeId}/notes`, { method: "POST", body: JSON.stringify({ body }) }),
  dossierDeleteArchiveNote: (noteId: string) =>
    request<{ ok: boolean }>(`/dossier/archive/notes/${noteId}`, { method: "DELETE" }),
  dossierBtw: (customerId: string) =>
    request<{ calculations: BtwCalculation[] }>(`/dossier/${customerId}/btw`),
  dossierSaveBtw: (customerId: string, calc: Partial<BtwCalculation>) =>
    request<{ calculation: BtwCalculation }>(`/dossier/${customerId}/btw`, { method: "POST", body: JSON.stringify({ calc }) }),
  dossierDeleteBtw: (calcId: string) =>
    request<{ ok: boolean }>(`/dossier/btw/${calcId}`, { method: "DELETE" }),
  dossierNotes: (customerId: string) =>
    request<{ notes: UserNote[] }>(`/dossier/${customerId}/notes`),
  dossierSaveNote: (
    customerId: string,
    title: string,
    body: string,
    filePath?: string | null,
    fileName?: string | null,
    fileSize?: number | null,
    mimeType?: string | null,
    visibleToCustomer?: boolean,
    attachments?: any[]
  ) =>
    request<{ note: UserNote }>(`/dossier/${customerId}/notes`, {
      method: "POST",
      body: JSON.stringify({ title, body, filePath, fileName, fileSize, mimeType, visibleToCustomer, attachments }),
    }),
  dossierUpdateNote: (
    noteId: string,
    title: string,
    body: string,
    filePath?: string | null,
    fileName?: string | null,
    fileSize?: number | null,
    mimeType?: string | null,
    visibleToCustomer?: boolean,
    attachments?: any[]
  ) =>
    request<{ ok: boolean }>(`/dossier/notes/${noteId}`, {
      method: "PUT",
      body: JSON.stringify({ title, body, filePath, fileName, fileSize, mimeType, visibleToCustomer, attachments }),
    }),
  dossierDeleteNote: (noteId: string) =>
    request<{ ok: boolean }>(`/dossier/notes/${noteId}`, { method: "DELETE" }),
  dossierUploadNoteAttachment: (customerId: string, formData: FormData) =>
    request<{ filePath: string; fileName: string; fileSize: number; mimeType: string }>(
      `/dossier/${customerId}/notes/upload`,
      { method: "POST", body: formData }
    ),
  dossierNoteAttachmentView: (filePath: string) =>
    request<{ url: string }>(`/dossier/notes/attachment/view?path=${encodeURIComponent(filePath)}`),
  sendChatMessage: (customerId: string, body: string, subject: string = "Chat") =>
    request<{ communication: Communication }>("/communications/send", {
      method: "POST",
      body: JSON.stringify({ customerId, body, subject }),
    }),
  sendChatMessageMultipart: (formData: FormData) =>
    request<{ communication: Communication }>("/communications/send", {
      method: "POST",
      body: formData,
    }),
  dossierUploadCommunicationAttachment: (customerId: string, formData: FormData) =>
    request<{ filePath: string; fileName: string; fileSize: number; mimeType: string }>(
      `/dossier/${customerId}/communications/upload`,
      { method: "POST", body: formData },
    ),
  dossierCommunicationAttachmentView: (filePath: string) =>
    request<{ url: string }>(`/dossier/communications/attachment/view?path=${encodeURIComponent(filePath)}`),
  dossierCommunications: (customerId: string) =>
    request<{ communications: Communication[] }>(`/dossier/${customerId}/communications`),
  dossierLogCommunication: (
    customerId: string,
    data: {
      id?: string;
      subject: string;
      body: string;
      quarter?: string | null;
      year?: number | null;
      status?: string;
      attachments?: import("./types").CommunicationAttachment[];
    },
  ) =>
    request<{ communication: Communication; warning?: string }>(`/dossier/${customerId}/communications`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  dossierSendDraftCommunication: (customerId: string, commId: string) =>
    request<{ ok: boolean; communication: Communication }>(`/dossier/${customerId}/communications/${commId}/send`, { method: "POST" }),
  dossierDeleteCommunication: (customerId: string, commId: string) =>
    request<{ ok: boolean }>(`/dossier/${customerId}/communications/${commId}`, { method: "DELETE" }),
  dossierStatus: (customerId: string, year?: number) =>
    request<{ year: number; quarters: AdminStatusRow[] }>(`/dossier/${customerId}/status${year ? `?year=${year}` : ""}`),
  dossierUpdateStatus: (customerId: string, year: number, quarter: string, status: string) =>
    request<{ ok: boolean }>(`/dossier/${customerId}/status`, { method: "PUT", body: JSON.stringify({ year, quarter, status }) }),
  dossierAnalyze: (customerId: string, quarter?: string, year?: number) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    return request<{ analysis: AnalysisResult }>(`/dossier/${customerId}/analyze`, {
      method: "POST",
      body: JSON.stringify({ quarter, year }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
  },
  dossierAnalyzeClarify: (customerId: string, quarter: string, year: number, answers: Array<{ questionId: string; answer: string }>) =>
    request<{ analysis: AnalysisResult }>(`/dossier/${customerId}/analyze-clarify`, {
      method: "POST",
      body: JSON.stringify({ quarter, year, answers }),
    }),
  dossierGetAnalysis: (customerId: string, quarter: string, year: number) =>
    request<{ analysis: AnalysisResult | null }>(`/dossier/${customerId}/analysis?quarter=${quarter}&year=${year}`),
  dossierAdjustItem: (itemId: string, data: { vatRate: number; amountIncl: number; reason?: string }) =>
    request<{ ok: boolean; item: { id: string; adjusted: boolean; vatRate: number; vatAmount: number; amountExcl: number; amountIncl: number; reason: string; delta: number } }>(
      `/dossier/analysis/items/${itemId}/adjust`,
      { method: "POST", body: JSON.stringify(data) },
    ),
  dossierItemAdjustments: (itemId: string) =>
    request<{ adjustments: ItemAdjustment[] }>(`/dossier/analysis/items/${itemId}/adjustments`),
  getEmailStatus: () =>
    request<{ configured: boolean; reason?: string }>("/email-status"),
  getEmailTemplate: (key?: string) =>
    request<{ template: { key: string; subject: string; body: string; updated_at: string } }>(`/email-template?key=${key || "reminder"}`),
  saveEmailTemplate: (subject: string, body: string, key?: string) =>
    request<{ ok: boolean; template: { key: string; subject: string; body: string; updated_at: string } }>("/email-template", {
      method: "POST",
      body: JSON.stringify({ key: key || "reminder", subject, body }),
    }),
  dossierSendReminders: (customerIds: string[], quarter: string, month: string, subject?: string, body?: string) =>
    request<ReminderResult>("/dossier/send-reminders", {
      method: "POST",
      body: JSON.stringify({ customerIds, quarter, month, subject, body }),
    }),

  // ===== Customer archive (read-only) =====
  customerArchive: (folderId?: string | null) =>
    request<{ folders: ArchiveFolder[]; files: ArchiveFile[]; notes: UserNote[] }>(`/customer/archive${folderId ? `?folderId=${folderId}` : ""}`),
  customerArchiveDownload: (fileId: string) =>
    request<{ url: string; name: string }>(`/customer/archive/files/${fileId}/download`),
  customerCommunications: () =>
    request<{ communications: Communication[] }>("/customer/communications"),

  // ===== Customer =====
  customerFiles: () => request<{ files: FileRow[] }>("/customer/files"),
  customerUpload: (formData: FormData) =>
    request<{ uploaded: { id: string; name: string; size: number; mimeType: string }[]; count: number }>(
      "/customer/upload",
      { method: "POST", body: formData },
    ),
  customerGetProfile: () =>
    request<{ profile: ProfileData }>("/customer/profile"),
  customerGetBookkeeper: () =>
    request<{ bookkeeper: { name: string; number: string } | null }>("/customer/my-bookkeeper"),
  customerUpdateProfile: (profile: ProfileData) =>
    request<{ ok: boolean }>("/customer/profile", { method: "PUT", body: JSON.stringify({ profile }) }),
  customerNotifications: () => request<{ notifications: Notification[] }>("/customer/notifications"),
  customerMarkRead: (ids?: string[], all?: boolean) =>
    request<{ ok: boolean }>("/customer/notifications/read", {
      method: "POST",
      body: JSON.stringify({ ids, all }),
    }),
  customerTransfers: () =>
    request<{ transfers: Array<{ id: string; sender_name: string; sender_number: string; receiver_name: string; receiver_number: string; created_at: string }> }>("/customer/transfers"),
  customerTransferAction: (id: string, action: "approve" | "decline") =>
    request<{ ok: boolean }>(`/customer/transfers/${id}/action`, { method: "POST", body: JSON.stringify({ action }) }),

  // ===== Shared =====
  notifications: () =>
    request<{ notifications: Notification[]; securityWarning: SecurityWarning }>("/notifications"),
  markRead: (ids?: string[], all?: boolean) =>
    request<{ ok: boolean }>("/notifications/read", {
      method: "POST",
      body: JSON.stringify({ ids, all }),
    }),
  purge: () => request<{ purged: number }>("/purge"),

  // ===== Accounting (professional bookkeeping) =====
  accountingCreateInvoice: (data: {
    companyId: string;
    customerId?: string;
    supplierId?: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate?: string;
    invoiceType: "sales" | "purchase";
    lines: Array<{ description: string; quantity: number; unitPrice: number; vatRate: 21 | 9 | 0 }>;
  }) =>
    request<{ invoice: {
      invoiceId: string;
      subtotal: number;
      vat21: number;
      vat9: number;
      totalVat: number;
      grandTotal: number;
      ledgerEntries: Array<{ account: string; debit: number; credit: number }>;
    } }>("/accounting/invoices", { method: "POST", body: JSON.stringify(data) }),

  accountingListInvoices: (companyId: string) =>
    request<{ invoices: unknown[] }>(`/accounting/invoices?companyId=${companyId}`),


  accountingGetLedger: (companyId: string) =>
    request<{ entries: unknown[]; totals: { totalDebit: number; totalCredit: number; balanced: boolean } }>(
      `/accounting/ledger?companyId=${companyId}`,
    ),

  // ===== Transfers =====
  getEligibleTransferUsers: () =>
    request<{ users: Array<{ id: string; name: string; number: string; role: string }> }>("/organization/eligible-transfer-users"),
  transferCustomer: (customerId: string, receiverUserId: string) =>
    request<{ ok: boolean; message: string }>(`/user/customers/${customerId}/transfer`, {
      method: "POST",
      body: JSON.stringify({ receiverUserId }),
    }),
};
