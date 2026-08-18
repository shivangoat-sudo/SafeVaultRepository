import { useState, useEffect, useCallback } from "react";
import { api } from "@/api";
import { useAuth } from "@/auth";
import { useToast } from "@/components/Toast";
import { DashboardShell, NotificationBell } from "@/components/DashboardShell";
import { Modal } from "@/components/Modal";
import { AccountSettingsModal } from "@/components/AccountSettingsModal";
import { CustomerDossier } from "@/components/CustomerDossier";
import { UserMessagesTab } from "@/components/UserMessagesTab";
import { StatCard, formatBytes, formatDate, formatDateTime, Spinner, EmptyState, PageHeader, CsvViewer } from "@/components/ui";
import type { UserStats, CustomerRow, FileRow, Notification, SecurityWarning, StorageFile } from "@/types";
import {
  LayoutDashboard, Users, FileText, Settings as SettingsIcon,
  Search, Unlock, Download, Eye, HardDrive, Upload, Ban, ShieldCheck, ScrollText, FileImage, FileType,
  Trash2, AlertTriangle as TriangleAlert, CheckCircle2, FolderOpen, Activity, Send, Edit3, ArrowRightLeft,
} from "lucide-react";
import { EmailTemplateEditor, type EmailTemplate } from "@/components/EmailTemplateEditor";
import { TransferCustomerModal } from "@/components/TransferCustomerModal";

type Tab = "overview" | "customers" | "files" | "storage" | "messages";
type SearchFilters = { search: string; year: string; quarter: string; status: string };

export function UserDashboard() {
  const { account } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<UserStats | null>(null);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<SearchFilters>({ search: "", year: "", quarter: "", status: "all" });
  const [dossierCustomer, setDossierCustomer] = useState<CustomerRow | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showReminders, setShowReminders] = useState(false);
  const [quarterModal, setQuarterModal] = useState<{ quarter: string; count: number; status?: 'not_submitted' | 'in_progress' | 'done' } | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [, setSecurityWarning] = useState<SecurityWarning>(null);
  const [purgeNotice, setPurgeNotice] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, n] = await Promise.all([api.userStats(), api.notifications()]);
      setStats(s);
      setNotifications(n.notifications);
      setSecurityWarning(n.securityWarning);
      const hasPurge = n.notifications.some((x) => x.kind === "file_purged" && !x.read);
      setPurgeNotice(hasPurge);
      // Mark purge notices read after showing
      if (hasPurge) {
        const purgeIds = n.notifications.filter((x) => x.kind === "file_purged" && !x.read).map((x) => x.id);
        await api.markRead(purgeIds);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filters.search) params.set("search", filters.search);
      if (filters.year) params.set("year", filters.year);
      if (filters.quarter) params.set("quarter", filters.quarter);
      if (filters.status && filters.status !== "all") params.set("status", filters.status);
      const res = await api.userCustomers(params.toString());
      setCustomers(res.customers);
    } catch {
      // ignore
    }
  }, [filters]);

  const loadFiles = useCallback(async () => {
    try {
      const res = await api.userFiles();
      setFiles(res.files);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { if (tab === "customers") loadCustomers(); }, [tab, loadCustomers]);
  useEffect(() => { if (tab === "files") loadFiles(); }, [tab, loadFiles]);

  const nav = [
    { label: "Overzicht", icon: LayoutDashboard, active: tab === "overview", onClick: () => setTab("overview") },
    { label: "Klanten", icon: Users, active: tab === "customers", onClick: () => setTab("customers") },
    { label: "Bestanden", icon: FileText, active: tab === "files", onClick: () => setTab("files") },
    { label: "Opslag", icon: HardDrive, active: tab === "storage", onClick: () => setTab("storage") },
    { label: "Berichten", icon: Send, active: tab === "messages", onClick: () => setTab("messages") },
  ];


  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <DashboardShell
      nav={nav}
      roleLabel={account?.role === "organization" ? "Organisatie" : "Gebruiker"}
      notifications={
        <>
          <NotificationBell count={unreadCount} onClick={() => setNotifOpen(true)} />
          <button onClick={() => setShowSettings(true)} className="btn-ghost px-2.5" title="Accountinstellingen">
            <SettingsIcon className="h-5 w-5" />
          </button>
        </>
      }
    >
      {loading && !stats ? (
        <div className="flex justify-center py-20"><Spinner className="h-6 w-6 text-ink-400" /></div>
      ) : (
        <>
          {purgeNotice && (
            <div className="mb-4 rounded-lg border border-warning-500/20 bg-warning-50 px-4 py-3 text-sm text-warning-700 animate-fade-in">
              Een of meer bestanden zijn automatisch verwijderd na de bewaartermijn van 2 jaar.
            </div>
          )}
          {tab === "overview" && stats && (
            <UserOverview stats={stats} recentFiles={files.slice(0, 5)} onTab={setTab} onRefreshFiles={loadFiles} onOpenDossier={(c) => { setDossierCustomer(c); setTab("customers"); }} onOpenReminders={() => { setShowReminders(true); loadCustomers(); }} onQuarterClick={setQuarterModal} />
          )}
          {tab === "customers" && (
            dossierCustomer ? (
              <CustomerDossier customer={dossierCustomer} onBack={() => setDossierCustomer(null)} />
            ) : (
              <UserCustomersTab customers={customers} filters={filters} onFilters={setFilters} onRefresh={loadCustomers} onBack={() => setTab("overview")} onOpenDossier={setDossierCustomer} />
            )
          )}
          {tab === "files" && <UserFilesTab files={files} onRefresh={loadFiles} onBack={() => setTab("overview")} />}
          {tab === "storage" && <UserStorageTab onRefresh={loadFiles} onBack={() => setTab("overview")} />}
          {tab === "messages" && <UserMessagesTab onBack={() => setTab("overview")} />}
        </>
      )}

      <AccountSettingsModal open={showSettings} onClose={() => setShowSettings(false)} canChangeName={true} />
      <ReminderModal open={showReminders} onClose={() => setShowReminders(false)} customers={customers} onRefreshCustomers={loadCustomers} />
      <QuarterMissingModal
        target={quarterModal}
        onClose={() => setQuarterModal(null)}
        onOpenDossier={(c) => { setQuarterModal(null); setDossierCustomer(c); setTab("customers"); }}
      />
      <NotificationsPanel open={notifOpen} onClose={() => setNotifOpen(false)} notifications={notifications} onRead={loadAll} />
      <PurgeNoticeModal open={purgeNotice} onClose={() => setPurgeNotice(false)} />
    </DashboardShell>
  );
}

function UserOverview({ stats, recentFiles, onTab, onRefreshFiles, onOpenReminders, onQuarterClick }: {
  stats: UserStats; recentFiles: FileRow[]; onTab: (t: Tab) => void; onRefreshFiles: () => void; onOpenDossier: (c: CustomerRow) => void; onOpenReminders: () => void; onQuarterClick: (q: { quarter: string; count: number; status: 'not_submitted' | 'in_progress' | 'done' }) => void;
}) {
  const [quarterStatusFilter, setQuarterStatusFilter] = useState<'not_submitted' | 'in_progress' | 'done'>('not_submitted');
  useEffect(() => { onRefreshFiles(); }, [onRefreshFiles]);

  const getQuarterCount = (q: 'Q1' | 'Q2' | 'Q3' | 'Q4') => {
    if (quarterStatusFilter === 'in_progress') {
      return q === 'Q1' ? (stats.inProgressQ1 ?? 0) : q === 'Q2' ? (stats.inProgressQ2 ?? 0) : q === 'Q3' ? (stats.inProgressQ3 ?? 0) : (stats.inProgressQ4 ?? 0);
    }
    if (quarterStatusFilter === 'done') {
      return q === 'Q1' ? (stats.doneQ1 ?? 0) : q === 'Q2' ? (stats.doneQ2 ?? 0) : q === 'Q3' ? (stats.doneQ3 ?? 0) : (stats.doneQ4 ?? 0);
    }
    return q === 'Q1' ? stats.notSubmittedQ1 : q === 'Q2' ? stats.notSubmittedQ2 : q === 'Q3' ? stats.notSubmittedQ3 : stats.notSubmittedQ4;
  };

  const statusBadgeLabel = quarterStatusFilter === 'done' ? 'Afgerond' : quarterStatusFilter === 'in_progress' ? 'In behandeling' : 'Nog niet ingeleverd';

  return (
    <div className="space-y-6">
      <PageHeader title="Overzicht" subtitle="Uw dossiers en statistieken" action={
        <button onClick={onOpenReminders} className="btn-primary"><Send className="h-4 w-4" /> Herinnering versturen</button>
      } />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Totaal klanten" value={String(stats.customerCount)} icon={Users} tone="brand" onClick={() => onTab("customers")} />
        <StatCard label="Nieuwe uploads vandaag" value={String(stats.newUploadsToday)} sub={`${stats.newUploads} afgelopen 7 dagen`} icon={Upload} tone="success" onClick={() => onTab("files")} />
        <StatCard label="Open dossiers" value={String(stats.openDossiers)} icon={FolderOpen} tone="neutral" onClick={() => onTab("customers")} />
        <StatCard label="Afgeronde dossiers" value={String(stats.doneDossiers)} sub="Dit jaar" icon={CheckCircle2} tone="success" onClick={() => onTab("customers")} />
      </div>

      <div className="card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-ink-900">Kwartaalstatus — dit jaar</h3>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
              quarterStatusFilter === 'done' ? 'bg-success-50 text-success-700 border-success-200' :
              quarterStatusFilter === 'in_progress' ? 'bg-brand-50 text-brand-700 border-brand-200' :
              'bg-warning-50 text-warning-700 border-warning-200'
            }`}>
              {statusBadgeLabel}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-500 font-medium whitespace-nowrap">Filter op status:</label>
            <select
              value={quarterStatusFilter}
              onChange={(e) => setQuarterStatusFilter(e.target.value as 'not_submitted' | 'in_progress' | 'done')}
              className="input py-1.5 px-3 text-xs font-medium w-auto border-ink-300 focus:ring-brand-500 cursor-pointer"
            >
              <option value="not_submitted">Nog niet ingeleverd</option>
              <option value="in_progress">In behandeling</option>
              <option value="done">Afgerond</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {(['Q1', 'Q2', 'Q3', 'Q4'] as const).map((q) => {
            const count = getQuarterCount(q);
            return (
              <QuarterCard
                key={q}
                quarter={q}
                count={count}
                statusFilter={quarterStatusFilter}
                onClick={() => onQuarterClick({ quarter: q, count, status: quarterStatusFilter })}
              />
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <StatCard label="Geblokkeerd" value={String(stats.blockedCustomers)} icon={Ban} tone={stats.blockedCustomers > 0 ? "danger" : "neutral"} onClick={() => onTab("customers")} />
        <StatCard label="Opslag" value={formatBytes(stats.storageBytes)} icon={HardDrive} tone="neutral" onClick={() => onTab("storage")} />
        <StatCard label="Laatste activiteit" value={stats.lastActivity ? formatDate(stats.lastActivity) : "—"} icon={Activity} tone="neutral" />
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-ink-900">Recente bestanden</h3>
          <button onClick={() => onTab("files")} className="text-xs font-medium text-brand-600 hover:text-brand-700">Alle bestanden</button>
        </div>
        {recentFiles.length === 0 ? (
          <EmptyState icon={FileText} title="Nog geen bestanden" subtitle="Wanneer klanten uploaden, verschijnen hier de bestanden." />
        ) : (
          <div className="space-y-2">
            {recentFiles.map((f) => <FileRowItem key={f.id} file={f} compact />)}
          </div>
        )}
      </div>
    </div>
  );
}

function QuarterCard({ quarter, count, statusFilter, onClick }: {
  quarter: string; count: number; statusFilter: 'not_submitted' | 'in_progress' | 'done'; onClick: () => void
}) {
  let tone = "bg-success-50 text-success-700 border-success-200";
  let statusText = "afgerond";

  if (statusFilter === "not_submitted") {
    statusText = "niet ingeleverd";
    tone = count === 0 ? "bg-success-50 text-success-700 border-success-200" : count > 5 ? "bg-danger-50 text-danger-700 border-danger-200" : "bg-warning-50 text-warning-700 border-warning-200";
  } else if (statusFilter === "in_progress") {
    statusText = "in behandeling";
    tone = count === 0 ? "bg-ink-50 text-ink-600 border-ink-200" : "bg-brand-50 text-brand-700 border-brand-200";
  } else {
    statusText = "afgerond";
    tone = count === 0 ? "bg-ink-50 text-ink-600 border-ink-200" : "bg-success-50 text-success-700 border-success-200";
  }

  return (
    <button
      onClick={onClick}
      className={`rounded-lg border p-4 text-left transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-300 ${tone}`}
    >
      <p className="text-xs font-medium opacity-80">{quarter}</p>
      <p className="text-2xl font-semibold tabular-nums mt-1">{count}</p>
      <p className="text-xs opacity-70 mt-0.5">{statusText}</p>
      {count > 0 && <p className="text-[10px] opacity-60 mt-1 underline">Bekijk klanten</p>}
    </button>
  );
}

function UserCustomersTab({ customers, filters, onFilters, onRefresh, onBack, onOpenDossier }: {
  customers: CustomerRow[]; filters: SearchFilters; onFilters: (f: SearchFilters) => void; onRefresh: () => void; onBack: () => void; onOpenDossier: (c: CustomerRow) => void;
}) {
  const { account } = useAuth();
  const [unblockTarget, setUnblockTarget] = useState<CustomerRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerRow | null>(null);
  const [transferTarget, setTransferTarget] = useState<CustomerRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showCreateCustomers, setShowCreateCustomers] = useState(false);
  const { push } = useToast();

  const handleUnblock = async () => {
    if (!unblockTarget) return;
    try {
      await api.userUnblockCustomer(unblockTarget.id);
      push("success", `${unblockTarget.name} is gedeblokkeerd.`);
      setUnblockTarget(null);
      onRefresh();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Deblokkeren mislukt.");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.userDeleteCustomer(deleteTarget.id);
      push("success", `${deleteTarget.name} is verwijderd.`);
      setDeleteTarget(null);
      onRefresh();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Verwijderen mislukt.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Klanten" 
        subtitle="Uw klantaccounts" 
        onBack={onBack} 
        action={
          account?.role === "organization" ? (
            <button onClick={() => setShowCreateCustomers(true)} className="btn-primary">
              Nieuwe klanten aanmaken
            </button>
          ) : undefined
        }
      />
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => onFilters({ ...filters, search: e.target.value })}
              className="input pl-10"
              placeholder="Zoek op naam, nummer, gebruikersnaam, BSN, e-mail, telefoon..."
            />
          </div>
          <select value={filters.year} onChange={(e) => onFilters({ ...filters, year: e.target.value })} className="input sm:w-28">
            <option value="">Jaar</option>
            {[new Date().getFullYear(), new Date().getFullYear() - 1].map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
          <select value={filters.quarter} onChange={(e) => onFilters({ ...filters, quarter: e.target.value })} className="input sm:w-28">
            <option value="">Kwartaal</option>
            {["Q1", "Q2", "Q3", "Q4"].map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
          <select value={filters.status} onChange={(e) => onFilters({ ...filters, status: e.target.value })} className="input sm:w-40">
            <option value="all">Alle statussen</option>
            <option value="active">Actief</option>
            <option value="blocked">Geblokkeerd</option>
            <option value="not_submitted">Nog niet ingeleverd</option>
            <option value="in_progress">In behandeling</option>
            <option value="done">Afgerond</option>
          </select>
        </div>
        <p className="mt-2 text-xs text-ink-400">Resultaten filteren direct zonder de pagina te herladen.</p>
      </div>
      <div className="card overflow-hidden">
        {customers.length === 0 ? (
          <EmptyState icon={Users} title="Geen klanten gevonden" subtitle={filters.search ? "Probeer een andere zoekterm of filter." : "Nog geen klantaccounts."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50/50 text-left text-xs font-medium text-ink-500 uppercase tracking-wide">
                  <th className="px-5 py-3">Naam</th>
                  <th className="px-5 py-3">Nummer</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Laatste aanmelding</th>
                  <th className="px-5 py-3 text-right">Acties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-ink-50/50 transition-colors cursor-pointer" onClick={() => onOpenDossier(c)}>
                    <td className="px-5 py-3 font-medium text-ink-900">{c.name}</td>
                    <td className="px-5 py-3 tabular-nums text-ink-600">{c.number}</td>
                    <td className="px-5 py-3">
                      {c.status === "active" ? <span className="badge-active">Actief</span> : <span className="badge-blocked">Geblokkeerd</span>}
                    </td>
                    <td className="px-5 py-3 text-ink-500">{formatDateTime(c.last_login_at)}</td>
                    <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => onOpenDossier(c)} className="btn-ghost px-2 py-1 text-xs" title="Dossier openen">
                          <Eye className="h-3.5 w-3.5" /> Dossier
                        </button>
                        <button onClick={() => setTransferTarget(c)} className="btn-ghost px-2 py-1 text-xs text-brand-600 hover:text-brand-700" title="Klant overdragen">
                          <ArrowRightLeft className="h-3.5 w-3.5" /> Overdragen
                        </button>
                        {c.status === "blocked" && (
                          <button onClick={() => setUnblockTarget(c)} className="btn-ghost px-2 py-1 text-xs" title="Deblokkeren">
                            <Unlock className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button onClick={() => setDeleteTarget(c)} className="btn-ghost px-2 py-1 text-xs text-danger-600 hover:text-danger-700" title="Verwijderen">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmUnblockModal name={unblockTarget?.name ?? null} onCancel={() => setUnblockTarget(null)} onConfirm={handleUnblock} />
      <ConfirmDeleteCustomerModal customer={deleteTarget} deleting={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={handleDelete} />
      <TransferCustomerModal
        customer={transferTarget}
        onClose={() => setTransferTarget(null)}
        onTransferred={() => {
          onRefresh();
        }}
      />
      <CreateCustomersModal 
        open={showCreateCustomers} 
        onClose={() => setShowCreateCustomers(false)} 
        onCreated={() => {
          onRefresh();
        }} 
      />
    </div>
  );
}

function UserFilesTab({ files, onRefresh, onBack }: { files: FileRow[]; onRefresh: () => void; onBack: () => void }) {
  const [viewer, setViewer] = useState<FileRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { push } = useToast();

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.userFileDelete(deleteTarget.id);
      push("success", `"${deleteTarget.original_name}" is verwijderd. De klant ontvangt een melding.`);
      setDeleteTarget(null);
      onRefresh();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Verwijderen mislukt.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Bestanden" subtitle="Alle geüploade documenten" onBack={onBack} action={
        <button onClick={onRefresh} className="btn-secondary"><FileText className="h-4 w-4" /> Vernieuwen</button>
      } />
      <div className="card overflow-hidden">
        {files.length === 0 ? (
          <EmptyState icon={FileText} title="Geen bestanden" subtitle="Nog geen documenten geüpload door uw klanten." />
        ) : (
          <div className="divide-y divide-ink-100">
            {files.map((f) => (
              <FileRowItem key={f.id} file={f} onView={() => setViewer(f)} onDelete={() => setDeleteTarget(f)} />
            ))}
          </div>
        )}
      </div>

      <FileViewerModal file={viewer} onClose={() => setViewer(null)} />
      <ConfirmDeleteFileModal file={deleteTarget} deleting={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={handleDelete} />
    </div>
  );
}

function FileRowItem({ file, onView, onDelete, compact }: { file: FileRow; onView?: () => void; onDelete?: () => void; compact?: boolean }) {
  const isPdf = file.mime_type === "application/pdf";
  const isImage = file.mime_type.startsWith("image/");
  return (
    <div className="flex items-center justify-between py-3 px-4 hover:bg-ink-50/50 transition-colors">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0 ${isPdf ? "bg-danger-50 text-danger-600" : isImage ? "bg-brand-50 text-brand-600" : "bg-ink-100 text-ink-500"}`}>
          {isPdf ? <FileType className="h-4.5 w-4.5" /> : isImage ? <FileImage className="h-4.5 w-4.5" /> : <FileText className="h-4.5 w-4.5" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-900 truncate">{file.original_name}</p>
          <p className="text-xs text-ink-400">
            {formatBytes(file.size_bytes)} · {formatDate(file.created_at)}
            {file.customer && !compact && ` · ${file.customer.name}`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {onView && (
          <button onClick={onView} className="btn-ghost px-2.5 py-1.5 text-xs">
            <Eye className="h-3.5 w-3.5" /> Bekijken
          </button>
        )}
        {onDelete && (
          <button onClick={onDelete} className="btn-ghost px-2 py-1 text-xs text-danger-600 hover:text-danger-700" title="Verwijderen">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function FileViewerModal({ file, onClose }: { file: FileRow | null; onClose: () => void }) {
  const { push } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!file) { setUrl(null); return; }
    setLoading(true);
    setUrl(null);
    let objectUrl: string | null = null;
    api.userFileView(file.id)
      .then(async (res) => {
        setMimeType(res.mimeType);
        const resp = await fetch(res.url);
        if (!resp.ok) throw new Error("fetch failed");
        const blob = await resp.blob();
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => push("error", "Kan bestand niet weergeven."))
      .finally(() => setLoading(false));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file, push]);

  const handleDownload = async () => {
    if (!file) return;
    try {
      const res = await api.userFileDownload(file.id);
      const a = document.createElement("a");
      a.href = res.url;
      a.download = file.original_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Download mislukt.");
    }
  };

  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/");
  const isCsv = mimeType === "text/csv" || mimeType === "text/plain" || (file?.original_name?.toLowerCase().match(/\.(csv|txt)$/) !== null);

  return (
    <Modal open={!!file} onClose={onClose} title={file?.original_name ?? ""} size="xl"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Sluiten</button>
          <button onClick={handleDownload} className="btn-primary"><Download className="h-4 w-4" /> Downloaden</button>
        </>
      }
    >
      <div className={`${isCsv ? "min-h-[50vh] max-h-[70vh] overflow-auto" : "h-[70vh]"} flex items-start justify-start bg-ink-50 rounded-lg overflow-hidden`}>
        {loading ? (
          <div className="flex w-full h-full items-center justify-center"><Spinner className="h-6 w-6 text-ink-400" /></div>
        ) : url && isPdf ? (
          <iframe src={url} className="pdf-frame" title="PDF viewer" />
        ) : url && isImage ? (
          <img src={url} alt={file?.original_name ?? ""} className="max-h-full max-w-full object-contain" />
        ) : url && isCsv ? (
          <CsvViewer url={url} fileName={file?.original_name} />
        ) : (
          <div className="flex w-full h-full items-center justify-center">
            <EmptyState icon={FileText} title="Bestand kan niet worden weergegeven" subtitle="Gebruik de downloadknop." />
          </div>
        )}
      </div>
    </Modal>
  );
}

function ConfirmUnblockModal({ name, onCancel, onConfirm }: { name: string | null; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal open={!!name} onClose={onCancel} title="Klant deblokkeren" size="sm"
      footer={
        <>
          <button onClick={onCancel} className="btn-secondary">Annuleren</button>
          <button onClick={onConfirm} className="btn-primary"><Unlock className="h-4 w-4" /> Deblokkeren</button>
        </>
      }
    >
      <p className="text-sm text-ink-600">Weet u zeker dat u <span className="font-medium text-ink-800">{name}</span> wilt deblokkeren?</p>
    </Modal>
  );
}

function ConfirmDeleteCustomerModal({ customer, deleting, onCancel, onConfirm }: {
  customer: CustomerRow | null; deleting: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <Modal open={!!customer} onClose={onCancel} title="Klant verwijderen" size="sm"
      footer={
        <>
          <button onClick={onCancel} className="btn-secondary" disabled={deleting}>Annuleren</button>
          <button onClick={onConfirm} disabled={deleting} className="btn-danger">
            {deleting ? <Spinner /> : <Trash2 className="h-4 w-4" />} Verwijderen
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-danger-50 text-danger-600 flex-shrink-0">
            <TriangleAlert className="h-5 w-5" />
          </span>
          <p className="text-sm text-ink-600">
            Weet u zeker dat u <span className="font-medium text-ink-800">{customer?.name}</span> (nr. {customer?.number}) wilt verwijderen?
          </p>
        </div>
        <div className="rounded-lg border border-danger-200 bg-danger-50/50 p-3 text-xs text-danger-700">
          Alle geüploade bestanden, inlogsessies en meldingen van deze klant worden permanent verwijderd. Deze actie kan niet ongedaan worden gemaakt.
        </div>
      </div>
    </Modal>
  );
}

function ConfirmDeleteFileModal({ file, deleting, onCancel, onConfirm }: {
  file: FileRow | null; deleting: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <Modal open={!!file} onClose={onCancel} title="Bestand verwijderen" size="sm"
      footer={
        <>
          <button onClick={onCancel} className="btn-secondary" disabled={deleting}>Annuleren</button>
          <button onClick={onConfirm} disabled={deleting} className="btn-danger">
            {deleting ? <Spinner /> : <Trash2 className="h-4 w-4" />} Verwijderen
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-danger-50 text-danger-600 flex-shrink-0">
            <TriangleAlert className="h-5 w-5" />
          </span>
          <p className="text-sm text-ink-600">
            Weet u zeker dat u <span className="font-medium text-ink-800">{file?.original_name}</span> wilt verwijderen?
          </p>
        </div>
        <div className="rounded-lg border border-warning-200 bg-warning-50/50 p-3 text-xs text-warning-700">
          De klant ontvangt een melding dat dit bestand is verwijderd. Deze actie kan niet ongedaan worden gemaakt.
        </div>
      </div>
    </Modal>
  );
}

function UserStorageTab({ onRefresh, onBack }: { onRefresh: () => void; onBack: () => void }) {
  const { push } = useToast();
  const [data, setData] = useState<{ totalBytes: number; fileCount: number; files: StorageFile[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.userStorage();
      setData(res);
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Laden mislukt.");
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Opslag"
        subtitle="Per bestand hoeveel opslagruimte in gebruik is"
        onBack={onBack}
        action={<button onClick={() => { load(); onRefresh(); }} className="btn-secondary"><HardDrive className="h-4 w-4" /> Vernieuwen</button>}
      />
      {loading ? (
        <div className="flex justify-center py-20"><Spinner className="h-6 w-6 text-ink-400" /></div>
      ) : data && data.files.length > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StatCard label="Totale opslag" value={formatBytes(data.totalBytes)} icon={HardDrive} tone="brand" />
            <StatCard label="Aantal bestanden" value={String(data.fileCount)} icon={FileText} tone="neutral" />
          </div>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-100 bg-ink-50/50 text-left text-xs font-medium text-ink-500 uppercase tracking-wide">
                    <th className="px-5 py-3">Bestandsnaam</th>
                    <th className="px-5 py-3">Klant</th>
                    <th className="px-5 py-3 text-right">Grootte</th>
                    <th className="px-5 py-3">Geüpload op</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {data.files.map((f) => (
                    <tr key={f.id} className="hover:bg-ink-50/50 transition-colors">
                      <td className="px-5 py-3 font-medium text-ink-900 truncate max-w-xs">{f.original_name}</td>
                      <td className="px-5 py-3 text-ink-600">
                        {f.customer ? <span>{f.customer.name} <span className="text-ink-400 tabular-nums">({f.customer.number})</span></span> : <span className="text-ink-400">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium text-ink-800">{formatBytes(f.size_bytes)}</td>
                      <td className="px-5 py-3 text-ink-500">{formatDate(f.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="card">
          <EmptyState icon={HardDrive} title="Geen opslag in gebruik" subtitle="Er zijn nog geen bestanden geüpload." />
        </div>
      )}
    </div>
  );
}

function NotificationsPanel({ open, onClose, notifications, onRead }: {
  open: boolean; onClose: () => void; notifications: Notification[]; onRead: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Meldingen" size="md"
      footer={notifications.some((n) => !n.read) ? (
        <button onClick={async () => { await api.markRead(undefined, true); onRead(); }} className="btn-secondary">Alles markeren als gelezen</button>
      ) : undefined}
    >
      {notifications.length === 0 ? (
        <EmptyState icon={ScrollText} title="Geen meldingen" />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div key={n.id} className={`flex items-start gap-3 rounded-lg p-3 ${n.read ? "bg-ink-50" : "bg-brand-50/50"}`}>
              <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${n.read ? "bg-ink-300" : "bg-brand-500"}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink-800">{n.message}</p>
                <p className="text-xs text-ink-400 mt-0.5">{formatDateTime(n.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ===== Reminder Modal =====
function QuarterMissingModal({ target, onClose, onOpenDossier }: {
  target: { quarter: string; count: number; status?: 'not_submitted' | 'in_progress' | 'done' } | null;
  onClose: () => void;
  onOpenDossier: (c: CustomerRow) => void;
}) {
  const { push } = useToast();
  const [loading, setLoading] = useState(false);
  const [activeStatus, setActiveStatus] = useState<'not_submitted' | 'in_progress' | 'done'>('not_submitted');
  const [data, setData] = useState<{
    customers: CustomerRow[];
    totalCount: number;
    notSubmittedCount: number;
    inProgressCount: number;
    doneCount: number;
  } | null>(null);

  useEffect(() => {
    if (target?.status) {
      setActiveStatus(target.status);
    }
  }, [target?.status, target?.quarter]);

  useEffect(() => {
    if (!target) return;
    setLoading(true);
    api.userQuarterMissing(target.quarter, undefined, activeStatus)
      .then((res) => setData({
        customers: Array.isArray(res?.customers) ? res.customers : [],
        totalCount: res?.totalCount ?? 0,
        notSubmittedCount: res?.notSubmittedCount ?? res?.missingCount ?? 0,
        inProgressCount: res?.inProgressCount ?? 0,
        doneCount: res?.doneCount ?? 0,
      }))
      .catch((err) => push("error", err instanceof Error ? err.message : "Kon gegevens niet laden."))
      .finally(() => setLoading(false));
  }, [target, activeStatus, push]);

  const customerList = data?.customers || [];
  const statusTitle = activeStatus === 'done' ? 'Afgerond' : activeStatus === 'in_progress' ? 'In behandeling' : 'Nog niet ingeleverd';

  return (
    <Modal open={!!target} onClose={onClose} title={target ? `${target.quarter} — ${statusTitle}` : ""} size="md"
      footer={<button onClick={onClose} className="btn-secondary">Sluiten</button>}
    >
      {loading && !data ? (
        <div className="flex justify-center py-8"><Spinner className="h-6 w-6 text-ink-400" /></div>
      ) : data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <button
              type="button"
              onClick={() => setActiveStatus('not_submitted')}
              className={`rounded-lg border p-2.5 transition-all cursor-pointer text-left sm:text-center ${
                activeStatus === 'not_submitted' ? 'border-warning-400 bg-warning-50 ring-2 ring-warning-200' : 'border-ink-200 bg-white hover:bg-ink-50'
              }`}
            >
              <p className="text-[11px] text-warning-800 font-medium">Nog niet ingeleverd</p>
              <p className="text-lg font-bold tabular-nums text-warning-900">{data.notSubmittedCount}</p>
            </button>

            <button
              type="button"
              onClick={() => setActiveStatus('in_progress')}
              className={`rounded-lg border p-2.5 transition-all cursor-pointer text-left sm:text-center ${
                activeStatus === 'in_progress' ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-200' : 'border-ink-200 bg-white hover:bg-ink-50'
              }`}
            >
              <p className="text-[11px] text-brand-800 font-medium">In behandeling</p>
              <p className="text-lg font-bold tabular-nums text-brand-900">{data.inProgressCount}</p>
            </button>

            <button
              type="button"
              onClick={() => setActiveStatus('done')}
              className={`rounded-lg border p-2.5 transition-all cursor-pointer text-left sm:text-center ${
                activeStatus === 'done' ? 'border-success-400 bg-success-50 ring-2 ring-success-200' : 'border-ink-200 bg-white hover:bg-ink-50'
              }`}
            >
              <p className="text-[11px] text-success-800 font-medium">Afgerond</p>
              <p className="text-lg font-bold tabular-nums text-success-900">{data.doneCount}</p>
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Spinner className="h-6 w-6 text-ink-400" /></div>
          ) : customerList.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Geen klanten gevonden" subtitle={`Er zijn geen klanten met status '${statusTitle}' voor ${target?.quarter}.`} />
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {customerList.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-lg border border-ink-200 p-3 hover:bg-ink-50 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900 truncate">{c.name}</p>
                    <p className="text-xs text-ink-400 tabular-nums">{c.number}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-ink-400">Laatste login: {c.last_login_at ? formatDate(c.last_login_at) : "nooit"}</span>
                    <button onClick={() => onOpenDossier(c)} className="btn-ghost px-2 py-1 text-xs" title="Dossier openen">
                      <FolderOpen className="h-3.5 w-3.5" /> Openen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function ReminderModal({ open, onClose, customers, onRefreshCustomers }: {
  open: boolean; onClose: () => void; customers: CustomerRow[]; onRefreshCustomers: () => void;
}) {
  const { push } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quarter, setQuarter] = useState<string>("Q1");
  const [month, setMonth] = useState<string>("april");
  const [sending, setSending] = useState(false);
  const [viewMode, setViewMode] = useState<"overview" | "edit-template">("overview");
  const [template, setTemplate] = useState<EmailTemplate | null>(null);
  const [results, setResults] = useState<{ sent: number; noEmail: number; failed: number; error?: string } | null>(null);
  const [smtpConfig, setSmtpConfig] = useState<{ configured: boolean; reason?: string } | null>(null);

  const MONTHS = [
    { key: "april", label: "15 april" },
    { key: "juli", label: "15 juli" },
    { key: "oktober", label: "15 oktober" },
    { key: "januari", label: "15 januari" },
  ];
  const Q_DEADLINES: Record<string, string> = { Q1: "april", Q2: "juli", Q3: "oktober", Q4: "januari" };

  const loadTemplate = async () => {
    try {
      const res = await api.getEmailTemplate("reminder");
      if (res.template) setTemplate(res.template);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setResults(null);
      setViewMode("overview");
      loadTemplate();
      api.getEmailStatus().then(setSmtpConfig).catch(() => setSmtpConfig({ configured: false, reason: "SMTP status kan niet worden opgehaald." }));
      onRefreshCustomers();
    }
  }, [open, onRefreshCustomers]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
      } else {
        n.add(id);
      }
      return n;
    });
  };
  const selectAll = () => setSelected(new Set(customers.map((c) => c.id)));
  const selectNone = () => setSelected(new Set());

  const handleSend = async () => {
    if (sending) return; // Prevent double trigger
    if (selected.size === 0) { push("error", "Selecteer minstens één klant."); return; }
    setSending(true);
    setResults(null);
    try {
      const deadlineLabel = MONTHS.find((m) => m.key === month)?.label || month;
      const res = await api.dossierSendReminders(
        Array.from(selected),
        quarter,
        deadlineLabel,
        template?.subject,
        template?.body
      );

      setResults({
        sent: res.sentCount,
        noEmail: res.noEmailCount,
        failed: res.failedCount,
        error: res.error,
      });

      if (res.sentCount > 0) {
        push("success", `${res.sentCount} herinnering(en) succesvol geaccepteerd door e-mailprovider.`);
        if (res.noEmailCount > 0) push("warning", `${res.noEmailCount} klant(en) hebben geen e-mailadres.`);
        if (res.failedCount > 0) push("error", `${res.failedCount} herinnering(en) niet kunnen verzenden.`);
      } else if (res.failedCount > 0) {
        push("error", res.error || `E-mail verzenden mislukt voor ${res.failedCount} klant(en). Controleer de e-mailinstellingen.`);
      } else if (res.noEmailCount > 0) {
        push("warning", `${res.noEmailCount} geselecteerde klant(en) hebben geen e-mailadres.`);
      }
    } catch (err) {
      console.error("[REMINDER SEND ERROR]", err);
      const msg = err instanceof Error ? err.message : "E-mail kon niet worden verzonden. Controleer de e-mailinstellingen.";
      push("error", msg);
      setResults({ sent: 0, noEmail: 0, failed: selected.size, error: msg });
    } finally {
      setSending(false);
    }
  };

  const sampleName = selected.size === 1
    ? (customers.find((c) => selected.has(c.id))?.name || "[klantnaam]")
    : "[klantnaam]";

  const currentYear = new Date().getFullYear().toString();
  const deadlineLabel = MONTHS.find((m) => m.key === month)?.label || month;

  const rawSubject = template?.subject || "Herinnering: aanleveren documenten {{kwartaal}} {{jaar}}";
  const rawBody = template?.body || "Beste {{klant_naam}},\n\nDit is een vriendelijke herinnering om uw boekhoudkundige stukken voor {{kwartaal}} {{jaar}} aan te leveren. De uiterste inleverdatum is {{maand}}.\n\nBedrijfsnaam: {{bedrijfsnaam}}\nBoekhouder: {{boekhouder_naam}}\n\nMet vriendelijke groet,\n{{boekhouder_naam}}";

  const previewSubject = rawSubject
    .replace(/\{\{klant_naam\}\}/gi, sampleName)
    .replace(/\{\{klantnaam\}\}/gi, sampleName)
    .replace(/\{\{bedrijfsnaam\}\}/gi, "Uw Onderneming B.V.")
    .replace(/\{\{boekhouder_naam\}\}/gi, "Uw Boekhouder")
    .replace(/\{\{kwartaal\}\}/gi, quarter)
    .replace(/\{\{maand\}\}/gi, deadlineLabel)
    .replace(/\{\{jaar\}\}/gi, currentYear)
    .replace(/\{\{openstaand_bedrag\}\}/gi, "€ 0,00");

  const previewBody = rawBody
    .replace(/\{\{klant_naam\}\}/gi, sampleName)
    .replace(/\{\{klantnaam\}\}/gi, sampleName)
    .replace(/\{\{bedrijfsnaam\}\}/gi, "Uw Onderneming B.V.")
    .replace(/\{\{boekhouder_naam\}\}/gi, "Uw Boekhouder")
    .replace(/\{\{kwartaal\}\}/gi, quarter)
    .replace(/\{\{maand\}\}/gi, deadlineLabel)
    .replace(/\{\{jaar\}\}/gi, currentYear)
    .replace(/\{\{openstaand_bedrag\}\}/gi, "€ 0,00");

  return (
    <Modal open={open} onClose={onClose} title={viewMode === "edit-template" ? "E-mailformat beheren & bewerken" : "Herinnering versturen"} size="lg"
      footer={
        viewMode === "overview" ? (
          <div className="flex items-center justify-between w-full">
            <span className="text-sm text-ink-500">{selected.size} klant(en) geselecteerd</span>
            <button onClick={handleSend} disabled={sending || selected.size === 0} className="btn-primary min-w-[200px]">
              {sending ? (
                <>
                  <Spinner /> Herinnering wordt verzonden...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" /> Herinnering versturen
                </>
              )}
            </button>
          </div>
        ) : null
      }
    >
      {viewMode === "edit-template" ? (
        <EmailTemplateEditor
          activeQuarter={quarter}
          activeMonthLabel={deadlineLabel}
          onBack={() => setViewMode("overview")}
          onSaved={(updatedTpl) => {
            setTemplate(updatedTpl);
            setViewMode("overview");
          }}
        />
      ) : (
        <div className="space-y-5">
          {smtpConfig && !smtpConfig.configured && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 space-y-1">
              <div className="flex items-center gap-2 font-semibold text-amber-800">
                <TriangleAlert className="h-4 w-4 text-amber-600 shrink-0" />
                <span>SMTP-e-mailservice instelling vereist</span>
              </div>
              <p className="text-amber-800/90 leading-relaxed">
                {smtpConfig.reason || "SMTP_PASSWORD is niet ingesteld in de omgevingsvariabelen."}
              </p>
              <p className="text-[11px] text-amber-700/80 pt-1 border-t border-amber-200/60">
                💡 Om e-mails naar klanten te versturen, voegt u de <code className="font-mono bg-amber-100/80 px-1 py-0.5 rounded text-amber-900 font-semibold">SMTP_PASSWORD</code> omgevingsvariabele toe via het <strong>Settings</strong> menu in AI Studio.
              </p>
            </div>
          )}

          {results && (
            <div className={`rounded-lg border p-4 animate-fade-in ${
              results.sent > 0
                ? "border-success-200 bg-success-50 text-success-800"
                : "border-danger-200 bg-danger-50 text-danger-800"
            }`}>
              <div className="flex items-center gap-2 font-medium">
                {results.sent > 0 ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-success-600" />
                    <span>{results.sent} herinnering(en) succesvol geaccepteerd door e-mailprovider</span>
                  </>
                ) : (
                  <>
                    <TriangleAlert className="h-5 w-5 text-danger-600" />
                    <span>Verzending mislukt ({results.failed} van de {results.failed + results.noEmail} mislukt)</span>
                  </>
                )}
              </div>
              {results.error && (
                <p className="text-xs text-danger-700 mt-1 font-mono bg-danger-100/50 p-2 rounded">
                  Details: {results.error}
                </p>
              )}
              {results.noEmail > 0 && (
                <p className="text-xs text-ink-600 mt-1">
                  • {results.noEmail} klant(en) hebben geen e-mailadres en konden niet worden benaderd.
                </p>
              )}
            </div>
          )}

          {/* Quarter + Month selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-2">Kwartaal</label>
              <div className="grid grid-cols-4 gap-2">
                {["Q1", "Q2", "Q3", "Q4"].map((q) => (
                  <button key={q} type="button" onClick={() => { setQuarter(q); setMonth(Q_DEADLINES[q]); }}
                    className={`rounded-lg border py-2.5 text-sm font-medium transition-all ${
                      quarter === q ? "border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-200" : "border-ink-200 text-ink-600 hover:border-ink-300"
                    }`}>{q}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-2">Uiterste inleverdatum</label>
              <div className="grid grid-cols-2 gap-2">
                {MONTHS.map((m) => (
                  <button key={m.key} type="button" onClick={() => setMonth(m.key)}
                    className={`rounded-lg border py-2.5 text-sm font-medium transition-all ${
                      month === m.key ? "border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-200" : "border-ink-200 text-ink-600 hover:border-ink-300"
                    }`}>{m.label}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Email preview card with 'Bekijk/wijzig format' button */}
          <div className="rounded-lg border border-ink-200 bg-ink-50/50 p-4 space-y-2">
            <div className="flex items-center justify-between border-b border-ink-200/60 pb-2">
              <span className="text-xs font-semibold text-ink-500 uppercase tracking-wider">Voorvertoning e-mail</span>
              <button
                type="button"
                onClick={() => setViewMode("edit-template")}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline cursor-pointer"
              >
                <Edit3 className="h-3.5 w-3.5" /> Bekijk/wijzig format
              </button>
            </div>
            <p className="text-sm text-ink-800">
              <strong className="text-ink-600 font-medium">Onderwerp:</strong> {previewSubject}
            </p>
            <div className="text-xs text-ink-600 whitespace-pre-wrap leading-relaxed pt-1 bg-white dark:bg-ink-900/40 p-3 rounded border border-ink-100">
              {previewBody}
            </div>
          </div>

          {/* Customer selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-ink-700">Klanten selecteren</label>
              <div className="flex gap-2 text-xs">
                <button onClick={selectAll} className="text-brand-600 hover:text-brand-700 font-medium">Alles selecteren</button>
                <span className="text-ink-300">|</span>
                <button onClick={selectNone} className="text-ink-500 hover:text-ink-700 font-medium">Deselecteren</button>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-ink-200 divide-y divide-ink-100">
              {customers.length === 0 ? (
                <p className="p-4 text-sm text-ink-400 text-center">Geen klanten gevonden.</p>
              ) : customers.map((c) => (
                <label key={c.id} className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${selected.has(c.id) ? "bg-brand-50/50" : "hover:bg-ink-50/50"}`}>
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink-800 truncate">{c.name}</p>
                    <p className="text-xs text-ink-400 tabular-nums">{c.number}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function PurgeNoticeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="Bestanden verwijderd" size="sm"
      footer={<button onClick={onClose} className="btn-primary">Begrepen</button>}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-warning-50 text-warning-600 flex-shrink-0">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <p className="text-sm text-ink-600">Een of meer bestanden zijn automatisch verwijderd na de bewaartermijn van 2 jaar, conform het privacybeleid.</p>
      </div>
    </Modal>
  );
}

function CreateCustomersModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { push } = useToast();
  const [count, setCount] = useState(1);
  const [creating, setCreating] = useState(false);
  const [createdCustomers, setCreatedCustomers] = useState<{ number: string; name: string; tempPassword: string }[] | null>(null);

  useEffect(() => {
    if (open) {
      setCount(1);
      setCreatedCustomers(null);
    }
  }, [open]);

  const handleCreate = async () => {
    if (count < 1) return;
    try {
      setCreating(true);
      const res = await api.userCreateCustomers(count);
      setCreatedCustomers(res.created);
      push("success", `${res.count} klanten succesvol aangemaakt.`);
      onCreated();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Fout bij aanmaken klanten.");
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = () => {
    if (!createdCustomers) return;
    const csvContent = "data:text/csv;charset=utf-8," 
      + "Inlognummer,Naam,Tijdelijk Wachtwoord\n"
      + createdCustomers.map(c => `${c.number},"${c.name}",${c.tempPassword}`).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `nieuwe_klanten_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Modal open={open} onClose={onClose} title={createdCustomers ? "Klanten Aangemaakt" : "Nieuwe Klanten Aanmaken"} size="md">
      <div className="space-y-4 py-4">
        {createdCustomers ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-success-200 bg-success-50 p-4 text-success-800 text-sm">
              Er zijn {createdCustomers.length} nieuwe klanten aangemaakt. Download de inloggegevens hieronder. 
              Let op: het tijdelijke wachtwoord wordt eenmalig getoond en daarna veilig gehasht opgeslagen.
            </div>
            <div className="max-h-60 overflow-y-auto rounded-lg border border-ink-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-ink-50">
                  <tr>
                    <th className="px-4 py-2 font-medium text-ink-600">Nummer</th>
                    <th className="px-4 py-2 font-medium text-ink-600">Naam</th>
                    <th className="px-4 py-2 font-medium text-ink-600">Wachtwoord</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {createdCustomers.map((c) => (
                    <tr key={c.number}>
                      <td className="px-4 py-2 text-ink-900">{c.number}</td>
                      <td className="px-4 py-2 text-ink-900">{c.name}</td>
                      <td className="px-4 py-2 font-mono text-xs text-ink-600">{c.tempPassword}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-ink-100">
              <button onClick={onClose} className="btn-ghost">Sluiten</button>
              <button onClick={handleDownload} className="btn-primary">
                <Download className="mr-2 h-4 w-4" /> Download CSV
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-ink-600 mb-4">
              Hoeveel nieuwe klantaccounts wilt u in één keer aanmaken?
            </p>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1.5">Aantal klanten (max o.b.v. instellingen)</label>
              <input type="number" min="1" max="500" value={count} onChange={(e) => setCount(Number(e.target.value))} className="input" autoFocus />
            </div>
            <div className="flex justify-end gap-3 pt-4 mt-6 border-t border-ink-100">
              <button onClick={onClose} disabled={creating} className="btn-ghost">Annuleren</button>
              <button onClick={handleCreate} disabled={creating || count < 1} className="btn-primary">
                {creating ? <Spinner /> : "Aanmaken"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

