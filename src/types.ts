export type Role = "owner" | "user" | "customer";

export type AuthAccount = {
  id: string;
  number: string;
  name: string;
  role: Role;
  status: "active" | "blocked";
};

export type LoginResponse = {
  token: string;
  account: AuthAccount;
  expires_at: string;
  requires_2fa?: false;
  requires_2fa_setup?: false;
} | {
  requires_2fa: true;
  requires_2fa_setup?: boolean;
  temp_token: string;
};

export type TwoFaSetupInitResponse = {
  qrCodeUrl: string;
  accountName: string;
  number: string;
};

export type OwnerStats = {
  userCount: number;
  organizationCount: number;
  customerCount: number;
  blockedCount: number;
  totalStorageBytes: number;
  fileCount: number;
  users: {
    id: string;
    number: string;
    name: string;
    status: "active" | "blocked";
    storageBytes: number;
    createdAt: string;
  }[];
};

export type OwnerUser = {
  id: string;
  number: string;
  name: string;
  status: "active" | "blocked";
  storageBytes: number;
  customerCount: number;
  createdAt: string;
  lastLoginAt: string | null;
  twoFactorEnabled?: boolean;
  last2faVerifiedAt?: string | null;
  owner_id?: string | null;
  organizationName?: string | null;
  userCount?: number;
};

export type BlockedAccount = {
  id: string;
  number: string;
  name: string;
  role: "user" | "customer";
  createdAt: string;
  blockedAt: string;
  ownerName: string | null;
};

export type WarningLog = {
  id: string;
  account_number: string;
  event: string;
  ip: string | null;
  user_agent: string | null;
  attempts: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type SettingsData = {
  id: number;
  max_customer_accounts_per_batch: number;
  max_upload_bytes: number;
  session_lifetime_hours: number;
  max_login_attempts: number;
  retention_years: number;
};

export type UserStats = {
  customerCount: number;
  blockedCustomers: number;
  newUploads: number;
  newUploadsToday: number;
  storageBytes: number;
  notSubmittedQ1: number;
  notSubmittedQ2: number;
  notSubmittedQ3: number;
  notSubmittedQ4: number;
  inProgressQ1?: number;
  inProgressQ2?: number;
  inProgressQ3?: number;
  inProgressQ4?: number;
  doneQ1?: number;
  doneQ2?: number;
  doneQ3?: number;
  doneQ4?: number;
  doneDossiers: number;
  openDossiers: number;
  lastActivity: string | null;
};

export type CustomerRow = {
  id: string;
  number: string;
  name: string;
  status: "active" | "blocked";
  created_at: string;
  last_login_at: string | null;
};

export type FileRow = {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  expires_at: string;
  customer_id?: string;
  customer?: { id: string; number: string; name: string } | null;
  category?: "income_overview" | "proof";
  quarter?: string | null;
  year?: number | null;
};

export type ProfileData = Record<string, string>;

export type ArchiveFolder = {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
};

export type ArchiveFile = {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  folder_id: string | null;
  created_at: string;
};

export type ArchiveNote = {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export type BtwCalculation = {
  id: string;
  customer_id: string;
  user_id: string;
  calc_date: string;
  quarter: string;
  year: number;
  total_inc_21: number;
  total_exc_21: number;
  total_inc_9: number;
  total_exc_9: number;
  btw_to_reclaim: number;
  explanation: string;
  created_at: string;
};

export type UserNote = {
  id: string;
  title: string;
  body: string;
  visible_to_customer: boolean;
  file_path?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  created_at: string;
  updated_at: string;
};

export type Communication = {
  id: string;
  sent_at: string;
  quarter: string | null;
  year: number | null;
  subject: string;
  recipient: string;
  status: "draft" | "sent";
  body: string;
  sender_id?: string;
  customer_id?: string;
};

export type AdminStatusRow = {
  id?: string;
  quarter: string;
  year: number;
  status: "not_submitted" | "in_progress" | "done";
  updated_at: string | null;
};

export type Notification = {
  id: string;
  kind: string;
  message: string;
  read: boolean;
  created_at: string;
};

export type SecurityWarning = {
  date: string;
  time: string;
  accountNumber: string;
  ip: string;
  attempts: number;
} | null;

export type StorageFile = {
  id: string;
  original_name: string;
  size_bytes: number;
  created_at: string;
  customer?: { id: string; number: string; name: string } | null;
};

export type StorageFileWithUser = StorageFile & {
  user?: { id: string; number: string; name: string } | null;
};

export type ApiError = {
  error: string;
};

export type VatSource = "expliciet_gevonden" | "berekend" | "standaardregel" | "geen";

export type ClarificationQuestion = {
  id: string;
  question: string;
  context: string;
  options?: string[];
};

export type ValidationResult = {
  passed: boolean;
  errors: string[];
  warnings: string[];
};

export type EndCheck = { id: string; label: string; passed: boolean; detail: string };

export type ReportSection = {
  id: string;
  title: string;
  items: { label: string; value: string }[];
};

export type AnalysisTransaction = {
  id: string;
  fileId: string | null;
  fileName: string;
  docType: string;
  docTypeLabel: string;
  date: string | null;
  counterparty: string | null;
  description: string;
  invoiceNumber: string | null;
  direction: "income" | "expense";
  amount: number;
  amountBasis: "incl" | "excl" | "unknown";
  vatRate: number | null;
  vatAmount: number;
  amountExcl: number;
  amountIncl: number;
  reason: string;
  confidence: number;
  warnings: string[];
  assumptions: string[];
  adjusted: boolean;
  vatStatus: "normal" | "none" | "exempt" | "reverse_charge" | "correction" | "uncertain";
  txnCategory: "normal" | "no_vat" | "correction" | "correction_vat" | "eu_verlegd" | "private" | "deposit" | "tax" | "unknown";
  btwGevonden: boolean;
  btwAftrekbaar: "volledig" | "beperkt" | "niet";
  btwAftrekbaarReden: string;
  reverseChargeVat: number;
  docReadability: number;
  isBankFlow: boolean;
  isVatRevenue: boolean;
  vatSource: VatSource;
  needsClarification: boolean;
  ai: {
    vatRate: number | null;
    vatAmount: number;
    amountExcl: number;
    amountIncl: number;
    reason: string;
  };
};

export type AnalysisTotals = {
  totalIncome: number;
  totalExpense: number;
  totalIncomeVat: number;
  totalExpenseVat: number;
  totalIncomeExcl: number;
  totalExpenseExcl: number;
  vatEndBalance: number;
  reverseChargeVatPayable: number;
  reverseChargeVatReclaim: number;
  nonDeductibleVat: number;
  correctionVat: number;
};

export type AnalysisResult = {
  runId?: string;
  quarter?: string;
  year?: number;
  transactions: AnalysisTransaction[];
  totals: AnalysisTotals;
  reportSections: ReportSection[];
  endChecks: EndCheck[];
  documentConfidence: number;
  clarificationQuestions: ClarificationQuestion[];
  validation: ValidationResult;
  explanation: string;
  filesAnalyzed: number;
  filesWithText: number;
  filesViaOcr: number;
  // Legacy compat
  total_inc_21: number;
  total_exc_21: number;
  total_inc_9: number;
  total_exc_9: number;
  btw_to_reclaim: number;
  amountsFound: { value: number; context: string; rate: number; type: string }[];
  extractionErrors: string[];
};

export type ItemAdjustment = {
  id: string;
  changedAt: string;
  before: { vatRate: number; vatAmount: number; amountExcl: number; reason: string };
  after: { vatRate: number; vatAmount: number; amountExcl: number; amountIncl: number; reason: string };
  deltaVatAmount: number;
};

export type ReminderResult = {
  results: { customerId: string; customerName: string; email: string; status: "sent" | "no_email" | "failed" }[];
  sentCount: number;
  noEmailCount: number;
  failedCount: number;
};
