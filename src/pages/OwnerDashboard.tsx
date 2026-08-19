import { CreateOrganizationModal } from "@/components/CreateOrganizationModal";
import { useState, useEffect, useCallback } from "react";
import { api } from "@/api";
import { useAuth } from "@/auth";
import { useToast } from "@/components/Toast";
import { DashboardShell, NotificationBell } from "@/components/DashboardShell";
import { Modal } from "@/components/Modal";
import { AccountSettingsModal } from "@/components/AccountSettingsModal";
import { StatCard, formatBytes, formatDate, formatDateTime, Spinner, EmptyState, PageHeader } from "@/components/ui";
import type { OwnerStats, OwnerUser, WarningLog, BlockedAccount, SettingsData, Notification, SecurityWarning } from "@/types";
import {
  LayoutDashboard, Users, AlertTriangle, ScrollText, Settings as SettingsIcon,
  UserPlus, Lock, ShieldCheck, ShieldAlert, HardDrive, FileText, Ban, Unlock, Copy,
  CheckCircle2, AlertTriangle as TriangleAlert, BarChart3, Download, Trash2,
  Building2, Search, User, X,
} from "lucide-react";

type Tab = "overview" | "organizations" | "users" | "customers" | "warnings" | "blocked" | "logs" | "settings";

export function OwnerDashboard() {
  const { account } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<OwnerStats | null>(null);
  const [users, setUsers] = useState<OwnerUser[]>([]);
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [warnings, setWarnings] = useState<WarningLog[]>([]);
  const [blocked, setBlocked] = useState<BlockedAccount[]>([]);
  const [logs, setLogs] = useState<WarningLog[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showCreateCustomers, setShowCreateCustomers] = useState<OwnerUser | null>(null);
  const [showManageCustomers, setShowManageCustomers] = useState<OwnerUser | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [securityWarning, setSecurityWarning] = useState<SecurityWarning>(null);
  const [showSecurityWarning, setShowSecurityWarning] = useState(false);

  const [selectedOrgFilter, setSelectedOrgFilter] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, u, custRes, w, b, l, st, n] = await Promise.all([
        api.ownerStats().catch(() => null),
        api.ownerUsers().catch(() => ({ users: [] })),
        api.ownerCustomers().catch(() => ({ customers: [] })),
        api.ownerWarnings().catch(() => ({ warnings: [] })),
        api.ownerBlocked().catch(() => ({ blocked: [] })),
        api.ownerLogs().catch(() => ({ logs: [] })),
        api.ownerGetSettings().catch(() => null),
        api.notifications().catch(() => ({ notifications: [], securityWarning: null })),
      ]);

      const usersList = u?.users || [];
      const customersList = custRes?.customers || [];
      const warningsList = w?.warnings || [];
      const blockedList = b?.blocked || [];
      const logsList = l?.logs || [];
      const notifsList = n?.notifications || [];

      setStats(s || {
        userCount: usersList.filter((u: OwnerUser) => String(u.number).startsWith("89")).length,
        organizationCount: usersList.filter((u: OwnerUser) => String(u.number).startsWith("2")).length,
        customerCount: customersList.length,
        blockedCount: blockedList.length,
        totalStorageBytes: 0,
        fileCount: 0,
        users: usersList
      });

      setUsers(usersList);
      setCustomers(customersList);
      setWarnings(warningsList);
      setBlocked(blockedList);
      setLogs(logsList);

      setSettings(st || {
        id: 1,
        max_customer_accounts_per_batch: 50,
        max_upload_bytes: 52428800,
        session_lifetime_hours: 5,
        max_login_attempts: 5,
        retention_years: 7
      });

      setNotifications(notifsList);
      setSecurityWarning(n?.securityWarning || null);

      if (n?.securityWarning && !sessionStorage.getItem("sw_shown")) {
        setShowSecurityWarning(true);
        sessionStorage.setItem("sw_shown", "1");
      }
    } catch (err) {
      console.error("OwnerDashboard loadAll error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const nav = [
    { label: "Overzicht", icon: LayoutDashboard, active: tab === "overview", onClick: () => setTab("overview") },
    { label: "Organisaties", icon: Building2, active: tab === "organizations", onClick: () => setTab("organizations") },
    { label: "Gebruikers", icon: Users, active: tab === "users", onClick: () => setTab("users") },
    { label: "Klanten", icon: UserPlus, active: tab === "customers", onClick: () => setTab("customers") },
    { label: "Waarschuwingen", icon: AlertTriangle, active: tab === "warnings", onClick: () => setTab("warnings") },
    { label: "Geblokkeerd", icon: Ban, active: tab === "blocked", onClick: () => setTab("blocked") },
    { label: "Logboek", icon: ScrollText, active: tab === "logs", onClick: () => setTab("logs") },
    { label: "Instellingen", icon: SettingsIcon, active: tab === "settings", onClick: () => setTab("settings") },
  ];

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <DashboardShell
      nav={nav}
      roleLabel="Eigenaar"
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
          {tab === "overview" && stats && (
            <OwnerOverview stats={stats} warnings={warnings} settings={settings} onTab={setTab} />
          )}
          {tab === "organizations" && (
            <OwnerOrganizationsTab
              users={users}
              onCreateOrg={() => setShowCreateOrg(true)}
              onSelectOrgUsers={(orgId) => {
                setSelectedOrgFilter(orgId);
                setTab("users");
              }}
              onRefresh={loadAll}
              onBack={() => setTab("overview")}
            />
          )}
          {tab === "users" && (
            <OwnerUsersTab
              users={users}
              selectedOrgId={selectedOrgFilter}
              onClearOrgFilter={() => setSelectedOrgFilter(null)}
              onCreateUser={() => setShowCreateUser(true)}
              onCreateOrg={() => setShowCreateOrg(true)}
              onCreateCustomers={(u) => setShowCreateCustomers(u)}
              onManageCustomers={(u) => setShowManageCustomers(u)}
              onRefresh={loadAll}
              onBack={() => setTab("overview")}
            />
          )}
          {tab === "customers" && (
            <OwnerCustomersTab
              customers={customers}
              onRefresh={loadAll}
              onBack={() => setTab("overview")}
            />
          )}
          {tab === "warnings" && <OwnerWarningsTab warnings={warnings} onRefresh={loadAll} onBack={() => setTab("overview")} />}
          {tab === "blocked" && (
            <OwnerBlockedTab blocked={blocked} onRefresh={loadAll} onBack={() => setTab("overview")} />
          )}
          {tab === "logs" && <OwnerLogsTab logs={logs} onBack={() => setTab("overview")} />}
          {tab === "settings" && settings && (
            <OwnerSettingsTab settings={settings} onUpdated={loadAll} onBack={() => setTab("overview")} />
          )}
        </>
      )}

      {/* Modals */}
      <CreateOrganizationModal open={showCreateOrg} onClose={() => setShowCreateOrg(false)} onCreated={loadAll} />
      <CreateUserModal open={showCreateUser} onClose={() => setShowCreateUser(false)} onCreated={loadAll} />
      <CreateCustomersModal user={showCreateCustomers} onClose={() => setShowCreateCustomers(null)} onCreated={loadAll} />
      <ManageCustomersModal user={showManageCustomers} users={users} onClose={() => setShowManageCustomers(null)} onUpdated={loadAll} />
      <AccountSettingsModal open={showSettings} onClose={() => setShowSettings(false)} canChangeName={true} />
      <NotificationsPanel open={notifOpen} onClose={() => setNotifOpen(false)} notifications={notifications} onRead={loadAll} />
      <SecurityWarningModal open={showSecurityWarning} onClose={() => setShowSecurityWarning(false)} warning={securityWarning} accountNumber={account?.number ?? ""} />
    </DashboardShell>
  );
}

// ===== Overview =====
function OwnerOverview({ stats, warnings, settings, onTab }: {
  stats: OwnerStats;
  warnings: WarningLog[];
  settings: SettingsData | null;
  onTab: (t: Tab) => void;
}) {
  const recentWarnings = warnings.slice(0, 5);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Overzicht"
        subtitle="Platformstatus en statistieken"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Organisaties" value={String(stats.organizationCount || 0)} icon={Building2} tone="brand" onClick={() => onTab("organizations")} />
        <StatCard label="Gebruikers" value={String(stats.userCount)} icon={Users} tone="brand" onClick={() => onTab("users")} />
        <StatCard label="Klanten" value={String(stats.customerCount)} icon={UserPlus} tone="brand" onClick={() => onTab("customers")} />
        <StatCard label="Bestanden" value={String(stats.fileCount)} icon={FileText} tone="neutral" />
        <StatCard label="Totale opslag" value={formatBytes(stats.totalStorageBytes)} icon={HardDrive} tone="neutral" />
        <StatCard label="Geblokkeerd" value={String(stats.blockedCount)} icon={Ban} tone={stats.blockedCount > 0 ? "danger" : "neutral"} onClick={() => onTab("blocked")} />
        <StatCard label="Waarschuwingen" value={String(warnings.length)} icon={AlertTriangle} tone={warnings.length > 0 ? "warning" : "neutral"} onClick={() => onTab("warnings")} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-ink-900">Recente waarschuwingen</h3>
            <button onClick={() => onTab("warnings")} className="text-xs font-medium text-brand-600 hover:text-brand-700">
              Alles bekijken
            </button>
          </div>
          {recentWarnings.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Geen waarschuwingen" subtitle="Alles lijkt in orde." />
          ) : (
            <div className="space-y-2">
              {recentWarnings.map((w) => (
                <WarningRow key={w.id} w={w} />
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink-900 mb-4">Platformstatus</h3>
          <div className="space-y-3">
            <StatusRow label="Systeem" value="Operationeel" ok />
            <StatusRow label="Beveiliging" value="Actief" ok />
            <StatusRow label="Bewaartermijn" value={`${settings?.retention_years ?? 2} jaar`} />
            <StatusRow label="Max. upload" value={formatBytes(settings?.max_upload_bytes ?? 52428800)} />
            <StatusRow label="Sessie-duur" value={`${settings?.session_lifetime_hours ?? 12} uur`} />
            <StatusRow label="Max. loginpogingen" value={String(settings?.max_login_attempts ?? 5)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-500">{label}</span>
      <span className="flex items-center gap-2 font-medium text-ink-800">
        {ok && <span className="h-2 w-2 rounded-full bg-success-500" />}
        {value}
      </span>
    </div>
  );
}

function WarningRow({ w }: { w: WarningLog }) {
  const isBlock = w.event === "account_blocked" || w.event === "customer_blocked";
  const label = w.event === "account_blocked" ? "Account geblokkeerd"
    : w.event === "customer_blocked" ? "Klant geblokkeerd"
    : w.event === "login_failed" ? "Mislukte aanmelding"
    : w.event === "owner_unblock" ? "Account gedeblokkeerd"
    : w.event;
  return (
    <div className="flex items-center justify-between py-2 border-b border-ink-100 last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0 ${isBlock ? "bg-danger-50 text-danger-600" : "bg-warning-50 text-warning-600"}`}>
          {isBlock ? <Ban className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-800 truncate">{label}</p>
          <p className="text-xs text-ink-400 truncate">Nr. {w.account_number} · {w.ip}</p>
        </div>
      </div>
      <span className="text-xs text-ink-400 flex-shrink-0">{formatDateTime(w.created_at)}</span>
    </div>
  );
}

interface CustomerItem {
  id: string;
  number: string;
  name: string;
  status: string;
  owner_id: string | null;
  ownerName?: string;
  ownerNumber?: string;
  created_at?: string;
  last_login_at?: string;
}

// ===== Customers tab =====
function OwnerCustomersTab({
  customers,
  onRefresh,
  onBack,
}: {
  customers: CustomerItem[];
  onRefresh: () => void;
  onBack: () => void;
}) {
  const { push } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "blocked">("all");
  const [resetTarget, setResetTarget] = useState<CustomerItem | null>(null);
  const [unblockTarget, setUnblockTarget] = useState<CustomerItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = customers.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      String(c.number).includes(search) ||
      (c.ownerName && c.ownerName.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus =
      statusFilter === "all" ? true : c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const pwd = window.prompt("Vul uw wachtwoord in ter bevestiging van de verwijdering:");
    if (!pwd) return;
    setDeleting(true);
    try {
      await api.ownerDeleteUser(deleteTarget.id, pwd);
      push("success", `Klant ${deleteTarget.name} is verwijderd.`);
      setDeleteTarget(null);
      onRefresh();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Verwijderen mislukt.");
    } finally {
      setDeleting(false);
    }
  };

  const handleUnblock = async () => {
    if (!unblockTarget) return;
    try {
      await api.ownerUnblock(unblockTarget.id);
      push("success", `Klant ${unblockTarget.name} is gedeblokkeerd.`);
      setUnblockTarget(null);
      onRefresh();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Deblokkeren mislukt.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Klanten"
        subtitle="Overzicht van alle klantaccounts in het systeem"
        onBack={onBack}
      />

      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
          <input
            type="text"
            placeholder="Zoek op klantnaam, nummer of boekhouder..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9 w-full text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-500 font-medium">Status:</span>
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === "all" ? "bg-ink-200 text-ink-900" : "bg-ink-50 text-ink-600 hover:bg-ink-100"
            }`}
          >
            Alle ({customers.length})
          </button>
          <button
            onClick={() => setStatusFilter("active")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === "active" ? "bg-emerald-100 text-emerald-800" : "bg-ink-50 text-ink-600 hover:bg-ink-100"
            }`}
          >
            Actief ({customers.filter((c) => c.status === "active").length})
          </button>
          <button
            onClick={() => setStatusFilter("blocked")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === "blocked" ? "bg-red-100 text-red-800" : "bg-ink-50 text-ink-600 hover:bg-ink-100"
            }`}
          >
            Geblokkeerd ({customers.filter((c) => c.status === "blocked").length})
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="Geen klanten gevonden"
            subtitle={search ? "Geen klanten voldoen aan de zoekopdracht." : "Er zijn nog geen klanten in het systeem."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50/50 text-left text-xs font-medium text-ink-500 uppercase tracking-wide">
                  <th className="px-5 py-3">Klantnaam</th>
                  <th className="px-5 py-3">Nummer</th>
                  <th className="px-5 py-3">Toegewezen Boekhouder / Organisatie</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Aangemaakt</th>
                  <th className="px-5 py-3 text-right">Acties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-ink-50/50 transition-colors">
                    <td className="px-5 py-3 font-medium text-ink-900">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-md bg-brand-50 text-brand-600">
                          <User className="h-4 w-4" />
                        </div>
                        <span>{c.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 tabular-nums font-mono text-xs text-ink-600">{c.number}</td>
                    <td className="px-5 py-3 text-ink-700">{c.ownerName || "Ongekoppeld"}</td>
                    <td className="px-5 py-3">
                      {c.status === "active" ? <span className="badge-active">Actief</span> : <span className="badge-blocked">Geblokkeerd</span>}
                    </td>
                    <td className="px-5 py-3 text-ink-500">{formatDate(c.created_at ?? null)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setResetTarget(c)} className="btn-ghost px-2 py-1 text-xs" title="Wachtwoord resetten">
                          <Lock className="h-3.5 w-3.5" />
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

      <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />
      <ConfirmUnblockModal name={unblockTarget?.name ?? null} onCancel={() => setUnblockTarget(null)} onConfirm={handleUnblock} />
      <ConfirmDeleteModal user={deleteTarget} deleting={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={handleDelete} />
    </div>
  );
}

// ===== Organizations tab =====
function OwnerOrganizationsTab({
  users,
  onCreateOrg,
  onSelectOrgUsers,
  onRefresh,
  onBack,
}: {
  users: OwnerUser[];
  onCreateOrg: () => void;
  onSelectOrgUsers: (orgId: string) => void;
  onRefresh: () => void;
  onBack: () => void;
}) {
  const { push } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "blocked">("all");
  const [resetTarget, setResetTarget] = useState<OwnerUser | null>(null);
  const [reset2faTarget, setReset2faTarget] = useState<OwnerUser | null>(null);
  const [resetting2fa, setResetting2fa] = useState(false);
  const [unblockTarget, setUnblockTarget] = useState<OwnerUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OwnerUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Filter accounts starting with '2' (Organizations)
  const orgs = users.filter((u) => String(u.number).startsWith("2"));

  const filteredOrgs = orgs.filter((o) => {
    const matchesSearch =
      o.name.toLowerCase().includes(search.toLowerCase()) ||
      String(o.number).includes(search);
    const matchesStatus =
      statusFilter === "all" ? true : o.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const pwd = window.prompt("Vul uw wachtwoord in ter bevestiging van de verwijdering:");
    if (!pwd) return;
    setDeleting(true);
    try {
      await api.ownerDeleteUser(deleteTarget.id, pwd);
      push("success", `Organisatie ${deleteTarget.name} is verwijderd.`);
      setDeleteTarget(null);
      onRefresh();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Verwijderen mislukt.");
    } finally {
      setDeleting(false);
    }
  };

  const handleUnblock = async () => {
    if (!unblockTarget) return;
    try {
      await api.ownerUnblock(unblockTarget.id);
      push("success", `Organisatie ${unblockTarget.name} is gedeblokkeerd.`);
      setUnblockTarget(null);
      onRefresh();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Deblokkeren mislukt.");
    }
  };

  const handleReset2fa = async () => {
    if (!reset2faTarget) return;
    setResetting2fa(true);
    try {
      const res = await api.ownerReset2fa(reset2faTarget.id);
      push("success", res.message || "2FA succesvol gereset.");
      setReset2faTarget(null);
      onRefresh();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "2FA reset mislukt.");
    } finally {
      setResetting2fa(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organisaties"
        subtitle="Overzicht van alle geregistreerde organisaties"
        onBack={onBack}
        action={
          <button onClick={onCreateOrg} className="btn-primary">
            <Building2 className="h-4 w-4 mr-2" /> Organisatie aanmaken
          </button>
        }
      />

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
          <input
            type="text"
            placeholder="Zoek op organisatienaam of nummer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9 w-full text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-500 font-medium">Status:</span>
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === "all" ? "bg-ink-200 text-ink-900" : "bg-ink-50 text-ink-600 hover:bg-ink-100"
            }`}
          >
            Alle ({orgs.length})
          </button>
          <button
            onClick={() => setStatusFilter("active")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === "active" ? "bg-emerald-100 text-emerald-800" : "bg-ink-50 text-ink-600 hover:bg-ink-100"
            }`}
          >
            Actief ({orgs.filter((o) => o.status === "active").length})
          </button>
          <button
            onClick={() => setStatusFilter("blocked")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === "blocked" ? "bg-red-100 text-red-800" : "bg-ink-50 text-ink-600 hover:bg-ink-100"
            }`}
          >
            Geblokkeerd ({orgs.filter((o) => o.status === "blocked").length})
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        {filteredOrgs.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Geen organisaties gevonden"
            subtitle={search ? "Geen organisaties voldoen aan de zoekopdracht." : "Maak de eerste organisatie aan."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50/50 text-left text-xs font-medium text-ink-500 uppercase tracking-wide">
                  <th className="px-5 py-3">Organisatienaam</th>
                  <th className="px-5 py-3">Nummer</th>
                  <th className="px-5 py-3 text-center">Boekhouders</th>
                  <th className="px-5 py-3 text-center">Klanten</th>
                  <th className="px-5 py-3">Opslag</th>
                  <th className="px-5 py-3">2FA Status</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Aangemaakt</th>
                  <th className="px-5 py-3 text-right">Acties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filteredOrgs.map((o) => (
                  <tr key={o.id} className="hover:bg-ink-50/50 transition-colors">
                    <td className="px-5 py-3 font-medium text-ink-900">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-md bg-brand-50 text-brand-600">
                          <Building2 className="h-4 w-4" />
                        </div>
                        <span>{o.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 tabular-nums font-mono text-xs text-ink-600">{o.number}</td>
                    <td className="px-5 py-3 tabular-nums text-center font-medium text-ink-800">
                      {o.userCount ?? 0}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-center text-ink-600">
                      {o.customerCount ?? 0}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-ink-600">{formatBytes(o.storageBytes)}</td>
                    <td className="px-5 py-3">
                      {o.twoFactorEnabled ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                          <ShieldCheck className="h-3 w-3" /> Ingesteld
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
                          <ShieldAlert className="h-3 w-3" /> Niet ingesteld
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {o.status === "active" ? <span className="badge-active">Actief</span> : <span className="badge-blocked">Geblokkeerd</span>}
                    </td>
                    <td className="px-5 py-3 text-ink-500">{formatDate(o.createdAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => onSelectOrgUsers(o.id)}
                          className="btn-secondary px-2.5 py-1 text-xs text-brand-600 hover:text-brand-700"
                          title="Bekijk boekhouders in deze organisatie"
                        >
                          <Users className="h-3.5 w-3.5 mr-1" /> Gebruikers
                        </button>
                        <button onClick={() => setResetTarget(o)} className="btn-ghost px-2 py-1 text-xs" title="Wachtwoord resetten">
                          <Lock className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setReset2faTarget(o)} className="btn-ghost px-2 py-1 text-xs text-amber-600 hover:text-amber-700" title="2FA resetten">
                          <ShieldAlert className="h-3.5 w-3.5" />
                        </button>
                        {o.status === "blocked" && (
                          <button onClick={() => setUnblockTarget(o)} className="btn-ghost px-2 py-1 text-xs" title="Deblokkeren">
                            <Unlock className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button onClick={() => setDeleteTarget(o)} className="btn-ghost px-2 py-1 text-xs text-danger-600 hover:text-danger-700" title="Verwijderen">
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

      <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />
      <ConfirmReset2FaModal user={reset2faTarget} resetting={resetting2fa} onCancel={() => setReset2faTarget(null)} onConfirm={handleReset2fa} />
      <ConfirmUnblockModal name={unblockTarget?.name ?? null} onCancel={() => setUnblockTarget(null)} onConfirm={handleUnblock} />
      <ConfirmDeleteModal user={deleteTarget} deleting={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={handleDelete} />
    </div>
  );
}

// ===== Users tab =====
function OwnerUsersTab({
  users,
  selectedOrgId,
  onClearOrgFilter,
  onCreateUser,
  onCreateOrg,
  onCreateCustomers,
  onManageCustomers,
  onRefresh,
  onBack,
}: {
  users: OwnerUser[];
  selectedOrgId?: string | null;
  onClearOrgFilter?: () => void;
  onCreateUser: () => void;
  onCreateOrg: () => void;
  onCreateCustomers: (u: OwnerUser) => void;
  onManageCustomers: (u: OwnerUser) => void;
  onRefresh: () => void;
  onBack: () => void;
}) {
  const { push } = useToast();
  const [search, setSearch] = useState("");
  const [userTypeFilter, setUserTypeFilter] = useState<"all" | "in_org" | "loose">("all");
  const [activeOrgFilter, setActiveOrgFilter] = useState<string>(selectedOrgId || "all");

  const [resetTarget, setResetTarget] = useState<OwnerUser | null>(null);
  const [reset2faTarget, setReset2faTarget] = useState<OwnerUser | null>(null);
  const [resetting2fa, setResetting2fa] = useState(false);
  const [unblockTarget, setUnblockTarget] = useState<OwnerUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OwnerUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (selectedOrgId) {
      setActiveOrgFilter(selectedOrgId);
    }
  }, [selectedOrgId]);

  // Organizations list for dropdown
  const orgList = users.filter((u) => String(u.number).startsWith("2"));

  // Bookkeeper users (number starting with 89)
  const bookkeepers = users.filter((u) => String(u.number).startsWith("89"));

  const filteredUsers = bookkeepers.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      String(u.number).includes(search) ||
      (u.organizationName && u.organizationName.toLowerCase().includes(search.toLowerCase()));

    const isOrgUser = Boolean(u.organizationName || (u.owner_id && orgList.some((o) => o.id === u.owner_id)));

    let matchesType = true;
    if (userTypeFilter === "in_org") matchesType = isOrgUser;
    if (userTypeFilter === "loose") matchesType = !isOrgUser;

    let matchesOrg = true;
    if (activeOrgFilter && activeOrgFilter !== "all") {
      matchesOrg = u.owner_id === activeOrgFilter;
    }

    return matchesSearch && matchesType && matchesOrg;
  });

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const pwd = window.prompt("Vul uw wachtwoord in ter bevestiging van de verwijdering:");
    if (!pwd) return;
    setDeleting(true);
    try {
      await api.ownerDeleteUser(deleteTarget.id, pwd);
      push("success", `${deleteTarget.name} is verwijderd.`);
      setDeleteTarget(null);
      onRefresh();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Verwijderen mislukt.");
    } finally {
      setDeleting(false);
    }
  };

  const handleUnblock = async () => {
    if (!unblockTarget) return;
    try {
      await api.ownerUnblock(unblockTarget.id);
      push("success", `${unblockTarget.name} is gedeblokkeerd.`);
      setUnblockTarget(null);
      onRefresh();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Deblokkeren mislukt.");
    }
  };

  const handleReset2fa = async () => {
    if (!reset2faTarget) return;
    setResetting2fa(true);
    try {
      const res = await api.ownerReset2fa(reset2faTarget.id);
      push("success", res.message || "2FA succesvol gereset.");
      setReset2faTarget(null);
      onRefresh();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "2FA reset mislukt.");
    } finally {
      setResetting2fa(false);
    }
  };

  const selectedOrgName = orgList.find((o) => o.id === activeOrgFilter)?.name;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gebruikers"
        subtitle="Overzicht van alle boekhouders (van organisaties en gewoon los)"
        onBack={onBack}
        action={
          <div className="flex gap-2">
            <button onClick={onCreateUser} className="btn-primary">
              <UserPlus className="h-4 w-4 mr-2" /> Gebruiker aanmaken
            </button>
            <button onClick={onCreateOrg} className="btn-secondary">
              <Building2 className="h-4 w-4 mr-2" /> Organisatie aanmaken
            </button>
          </div>
        }
      />

      {/* Filters & Controls */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
            <input
              type="text"
              placeholder="Zoek op naam, nummer of organisatie..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9 w-full text-sm"
            />
          </div>

          {/* Org filter dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-500 font-medium">Filter op organisatie:</span>
            <select
              value={activeOrgFilter}
              onChange={(e) => setActiveOrgFilter(e.target.value)}
              className="input py-1.5 text-xs max-w-[220px]"
            >
              <option value="all">Alle organisaties</option>
              {orgList.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.number})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Type pills filter */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-ink-50 p-2 rounded-lg border border-ink-100">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-ink-500 font-medium px-2">Type:</span>
            <button
              onClick={() => setUserTypeFilter("all")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                userTypeFilter === "all" ? "bg-white text-ink-900 shadow-sm" : "text-ink-600 hover:text-ink-900"
              }`}
            >
              Alle ({bookkeepers.length})
            </button>
            <button
              onClick={() => setUserTypeFilter("in_org")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                userTypeFilter === "in_org" ? "bg-white text-purple-700 shadow-sm" : "text-ink-600 hover:text-ink-900"
              }`}
            >
              🏢 Van organisatie ({bookkeepers.filter((u) => Boolean(u.organizationName || (u.owner_id && orgList.some((o) => o.id === u.owner_id)))).length})
            </button>
            <button
              onClick={() => setUserTypeFilter("loose")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                userTypeFilter === "loose" ? "bg-white text-ink-800 shadow-sm" : "text-ink-600 hover:text-ink-900"
              }`}
            >
              👤 Gewoon los ({bookkeepers.filter((u) => !u.organizationName && (!u.owner_id || !orgList.some((o) => o.id === u.owner_id))).length})
            </button>
          </div>

          {activeOrgFilter !== "all" && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                Gefilterd op: {selectedOrgName}
              </span>
              <button
                onClick={() => {
                  setActiveOrgFilter("all");
                  if (onClearOrgFilter) onClearOrgFilter();
                }}
                className="text-xs text-ink-500 hover:text-ink-800 flex items-center gap-1"
              >
                <X className="h-3.5 w-3.5" /> Filter wissen
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Users Table */}
      <div className="card overflow-hidden">
        {filteredUsers.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Geen gebruikers gevonden"
            subtitle={
              search || userTypeFilter !== "all" || activeOrgFilter !== "all"
                ? "Geen gebruikers voldoen aan de huidige filters."
                : "Maak de eerste gebruiker aan."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50/50 text-left text-xs font-medium text-ink-500 uppercase tracking-wide">
                  <th className="px-5 py-3">Naam</th>
                  <th className="px-5 py-3">Nummer</th>
                  <th className="px-5 py-3">Organisatie</th>
                  <th className="px-5 py-3 text-center">Klanten</th>
                  <th className="px-5 py-3">Opslag</th>
                  <th className="px-5 py-3">2FA Status</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Aangemaakt</th>
                  <th className="px-5 py-3 text-right">Acties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filteredUsers.map((u) => {
                  const orgName = u.organizationName || orgList.find((o) => o.id === u.owner_id)?.name;
                  return (
                    <tr key={u.id} className="hover:bg-ink-50/50 transition-colors">
                      <td className="px-5 py-3 font-medium text-ink-900">
                        <div className="flex items-center gap-2">
                          <div className="p-1 rounded-full bg-ink-100 text-ink-600">
                            <User className="h-4 w-4" />
                          </div>
                          <span>{u.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 tabular-nums font-mono text-xs text-ink-600">{u.number}</td>
                      <td className="px-5 py-3">
                        {orgName ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-600/20">
                            <Building2 className="h-3 w-3" /> {orgName}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600">
                            <User className="h-3 w-3" /> Gewoon los
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 tabular-nums text-center font-medium text-ink-800">{u.customerCount}</td>
                      <td className="px-5 py-3 tabular-nums text-ink-600">{formatBytes(u.storageBytes)}</td>
                      <td className="px-5 py-3">
                        {u.twoFactorEnabled ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                            <ShieldCheck className="h-3 w-3" /> Ingesteld
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
                            <ShieldAlert className="h-3 w-3" /> Niet ingesteld
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {u.status === "active" ? <span className="badge-active">Actief</span> : <span className="badge-blocked">Geblokkeerd</span>}
                      </td>
                      <td className="px-5 py-3 text-ink-500">{formatDate(u.createdAt)}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => onManageCustomers(u)} className="btn-ghost px-2 py-1 text-xs text-brand-600 hover:text-brand-700" title="Klanten koppelen">
                            <Users className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => onCreateCustomers(u)} className="btn-ghost px-2 py-1 text-xs" title="Klant aanmaken">
                            <UserPlus className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setResetTarget(u)} className="btn-ghost px-2 py-1 text-xs" title="Wachtwoord resetten">
                            <Lock className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setReset2faTarget(u)} className="btn-ghost px-2 py-1 text-xs text-amber-600 hover:text-amber-700" title="2FA resetten">
                            <ShieldAlert className="h-3.5 w-3.5" />
                          </button>
                          {u.status === "blocked" && (
                            <button onClick={() => setUnblockTarget(u)} className="btn-ghost px-2 py-1 text-xs" title="Deblokkeren">
                              <Unlock className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button onClick={() => setDeleteTarget(u)} className="btn-ghost px-2 py-1 text-xs text-danger-600 hover:text-danger-700" title="Verwijderen">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />
      <ConfirmReset2FaModal user={reset2faTarget} resetting={resetting2fa} onCancel={() => setReset2faTarget(null)} onConfirm={handleReset2fa} />
      <ConfirmUnblockModal name={unblockTarget?.name ?? null} onCancel={() => setUnblockTarget(null)} onConfirm={handleUnblock} />
      <ConfirmDeleteModal user={deleteTarget} deleting={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={handleDelete} />
    </div>
  );
}

function ConfirmReset2FaModal({ user, resetting, onCancel, onConfirm }: { user: OwnerUser | null; resetting: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal open={!!user} onClose={onCancel} title="2FA Resetten" size="sm"
      footer={
        <>
          <button onClick={onCancel} className="btn-secondary" disabled={resetting}>Annuleren</button>
          <button onClick={onConfirm} disabled={resetting} className="btn-danger">
            {resetting ? <Spinner /> : <ShieldAlert className="h-4 w-4" />} Resetten
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink-600">
          Weet u zeker dat u de tweestapsverificatie wilt resetten voor <span className="font-semibold text-ink-900">{user?.name}</span>?
        </p>
        <p className="text-xs text-ink-500">
          De bestaande authenticator-koppeling wordt verwijderd. De gebruiker moet bij de volgende login opnieuw 2FA instellen.
        </p>
      </div>
    </Modal>
  );
}

// ===== Warnings tab =====
function OwnerWarningsTab({ warnings, onRefresh, onBack }: { warnings: WarningLog[]; onRefresh: () => void; onBack: () => void }) {
  return (
    <div className="space-y-6">
      <PageHeader title="Waarschuwingen" subtitle="Beveiligingsincidenten van de afgelopen 30 dagen" onBack={onBack} action={
        <button onClick={onRefresh} className="btn-secondary"><BarChart3 className="h-4 w-4" /> Vernieuwen</button>
      } />
      <div className="card overflow-hidden">
        {warnings.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Geen waarschuwingen" subtitle="Geen beveiligingsincidenten in de afgelopen 30 dagen." />
        ) : (
          <div className="divide-y divide-ink-100">
            {warnings.map((w) => <WarningRow key={w.id} w={w} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Blocked accounts tab =====
function OwnerBlockedTab({ blocked, onRefresh, onBack }: { blocked: BlockedAccount[]; onRefresh: () => void; onBack: () => void }) {
  const { push } = useToast();
  const [unblockTarget, setUnblockTarget] = useState<BlockedAccount | null>(null);
  const [busy, setBusy] = useState(false);

  const handleUnblock = async () => {
    if (!unblockTarget) return;
    setBusy(true);
    try {
      await api.ownerUnblock(unblockTarget.id);
      push("success", `${unblockTarget.name} is gedeblokkeerd.`);
      setUnblockTarget(null);
      onRefresh();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Deblokkeren mislukt.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Geblokkeerde accounts" subtitle="Alle geblokkeerde gebruikers en klanten" onBack={onBack} action={
        <button onClick={onRefresh} className="btn-secondary"><Ban className="h-4 w-4" /> Vernieuwen</button>
      } />
      <div className="card overflow-hidden">
        {blocked.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Geen geblokkeerde accounts" subtitle="Er zijn momenteel geen geblokkeerde accounts." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50/50 text-left text-xs font-medium text-ink-500 uppercase tracking-wide">
                  <th className="px-5 py-3">Naam</th>
                  <th className="px-5 py-3">Nummer</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Hoort bij</th>
                  <th className="px-5 py-3">Geblokkeerd op</th>
                  <th className="px-5 py-3 text-right">Actie</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {blocked.map((a) => (
                  <tr key={a.id} className="hover:bg-ink-50/50 transition-colors">
                    <td className="px-5 py-3 font-medium text-ink-900">{a.name}</td>
                    <td className="px-5 py-3 tabular-nums text-ink-600">{a.number}</td>
                    <td className="px-5 py-3">
                      <span className={`badge ${a.role === "user" ? "badge-active" : "badge-blocked"}`}>
                        {a.role === "user" ? "Gebruiker" : "Klant"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-ink-600">{a.ownerName ?? "—"}</td>
                    <td className="px-5 py-3 text-ink-500">{formatDateTime(a.blockedAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => setUnblockTarget(a)} className="btn-ghost px-2 py-1 text-xs" title="Deblokkeren">
                        <Unlock className="h-3.5 w-3.5" /> Deblokkeren
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={!!unblockTarget} onClose={() => setUnblockTarget(null)} title="Account deblokkeren" size="sm"
        footer={
          <>
            <button onClick={() => setUnblockTarget(null)} className="btn-secondary" disabled={busy}>Annuleren</button>
            <button onClick={handleUnblock} disabled={busy} className="btn-primary">
              {busy ? <Spinner /> : <Unlock className="h-4 w-4" />} Deblokkeren
            </button>
          </>
        }
      >
        <p className="text-sm text-ink-600">Weet u zeker dat u <span className="font-medium text-ink-800">{unblockTarget?.name}</span> (nr. {unblockTarget?.number}) wilt deblokkeren?</p>
      </Modal>
    </div>
  );
}

// ===== Logs tab =====
function OwnerLogsTab({ logs, onBack }: { logs: WarningLog[]; onBack: () => void }) {
  return (
    <div className="space-y-6">
      <PageHeader title="Logboek" subtitle="Alle gebeurtenissen van de afgelopen 7 dagen" onBack={onBack} />
      <div className="card overflow-hidden">
        {logs.length === 0 ? (
          <EmptyState icon={ScrollText} title="Geen logboekvermeldingen" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50/50 text-left text-xs font-medium text-ink-500 uppercase tracking-wide">
                  <th className="px-5 py-3">Tijdstip</th>
                  <th className="px-5 py-3">Nummer</th>
                  <th className="px-5 py-3">Gebeurtenis</th>
                  <th className="px-5 py-3">IP</th>
                  <th className="px-5 py-3">Pogingen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-ink-50/50">
                    <td className="px-5 py-3 text-ink-600 whitespace-nowrap">{formatDateTime(l.created_at)}</td>
                    <td className="px-5 py-3 tabular-nums text-ink-600">{l.account_number ?? "—"}</td>
                    <td className="px-5 py-3 text-ink-800">{eventLabel(l.event)}</td>
                    <td className="px-5 py-3 text-ink-600">{l.ip ?? "—"}</td>
                    <td className="px-5 py-3 tabular-nums text-ink-600">{l.attempts ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function eventLabel(e: string): string {
  const map: Record<string, string> = {
    login_success: "Succesvolle aanmelding",
    login_failed: "Mislukte aanmelding",
    login_blocked: "Aanmelding geblokkeerd",
    account_blocked: "Account geblokkeerd",
    customer_blocked: "Klant geblokkeerd",
    owner_unblock: "Account gedeblokkeerd",
    customer_unblocked: "Klant gedeblokkeerd",
    upload_success: "Upload gelukt",
    upload_recipient_invalid: "Ontvanger onjuist",
    file_download: "Bestand gedownload",
    file_view: "Bestand bekeken",
    file_purged: "Bestand verwijderd",
    password_changed: "Wachtwoord gewijzigd",
    name_changed: "Naam gewijzigd",
    user_created: "Gebruiker aangemaakt",
    customers_bulk_created: "Klanten aangemaakt",
    user_password_reset: "Wachtwoord gereset",
    user_deleted: "Gebruiker verwijderd",
    settings_updated: "Instellingen gewijzigd",
    owner_created: "Eigenaar aangemaakt",
  };
  return map[e] ?? e;
}

// ===== Settings tab =====
function OwnerSettingsTab({ settings, onUpdated, onBack }: { settings: SettingsData; onUpdated: () => void; onBack: () => void }) {
  const { push } = useToast();
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.ownerUpdateSettings({
        max_customer_accounts_per_batch: form.max_customer_accounts_per_batch,
        max_upload_bytes: form.max_upload_bytes,
        session_lifetime_hours: form.session_lifetime_hours,
        max_login_attempts: form.max_login_attempts,
        retention_years: form.retention_years,
      });
      push("success", "Instellingen opgeslagen.");
      onUpdated();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Opslaan mislukt.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Platforminstellingen" subtitle="Globale configuratie van het platform" onBack={onBack} />
      <div className="card p-6 space-y-5 max-w-2xl">
        <SettingField label="Max. klanten per batch" value={form.max_customer_accounts_per_batch} min={1} max={500}
          onChange={(v) => setForm({ ...form, max_customer_accounts_per_batch: v })} />
        <SettingField label="Max. upload (bytes)" value={form.max_upload_bytes} min={1048576} max={104857600} step={1048576}
          onChange={(v) => setForm({ ...form, max_upload_bytes: v })} />
        <SettingField label="Sessie-duur (uren)" value={form.session_lifetime_hours} min={1} max={168}
          onChange={(v) => setForm({ ...form, session_lifetime_hours: v })} />
        <SettingField label="Max. loginpogingen" value={form.max_login_attempts} min={3} max={10}
          onChange={(v) => setForm({ ...form, max_login_attempts: v })} />
        <SettingField label="Bewaartermijn (jaar)" value={form.retention_years} min={1} max={10}
          onChange={(v) => setForm({ ...form, retention_years: v })} />
        <div className="pt-2">
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
            Opslaan
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingField({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm font-medium text-ink-700 flex-shrink-0">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input w-32 text-right tabular-nums"
      />
    </div>
  );
}

// ===== Modals =====
interface CustomerSelection {
  id: string;
  number: string;
  name: string;
  status: string;
  owner_id: string | null;
}

function CreateUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { push } = useToast();
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [password, setPassword] = useState("");
  const [customerCount, setCustomerCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{
    number: string;
    customers: { number: string; name: string; tempPassword: string }[];
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const [allExistingCustomers, setAllExistingCustomers] = useState<CustomerSelection[]>([]);
  const [selectedExistingCustomerIds, setSelectedExistingCustomerIds] = useState<string[]>([]);
  const [existingSearch, setExistingSearch] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      
      // Auto-generate a secure 8-digit bookkeeper number starting with "89"
      const autoNumber = "89" + Math.floor(100000 + Math.random() * 900000).toString().slice(0, 6);
      setNumber(autoNumber);
      
      // Auto-generate a secure 12-character alphanumeric password
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      let autoPassword = "";
      for (let i = 0; i < 12; i++) {
        autoPassword += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      setPassword(autoPassword);
      
      setCustomerCount(0);
      setResult(null);
      setProgress(null);
      setAllExistingCustomers([]);
      setSelectedExistingCustomerIds([]);
      setExistingSearch("");

      api.ownerCustomers()
        .then((res) => {
          setAllExistingCustomers(res.customers || []);
        })
        .catch(() => {});
    }
  }, [open]);

  const canSubmit = name.trim() && /^\d{8}$/.test(number) && number.startsWith("89") && password.length >= 8 && password.length <= 15 && /^[A-Za-z0-9]+$/.test(password) && customerCount >= 0 && customerCount <= 500;

  const handleCreate = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      // Step 1: create the user
      const res = await api.ownerCreateUser(name.trim(), number.trim(), password);
      
      // Step 1.5: assign selected existing customers
      if (selectedExistingCustomerIds.length > 0) {
        await api.ownerAssignCustomers(res.account.id, selectedExistingCustomerIds);
      }

      // Step 2: create customers in chunks of 25
      const allCustomers: { number: string; name: string; tempPassword: string }[] = [];
      const remaining = customerCount;
      if (remaining > 0) {
        setProgress({ done: 0, total: remaining });
        let done = 0;
        while (done < remaining) {
          const chunk = Math.min(15, remaining - done);
          const cres = await api.ownerCreateCustomers(res.account.id, chunk);
          allCustomers.push(...cres.created);
          done += cres.created.length;
          setProgress({ done, total: remaining });
        }
      }
      setResult({ number: res.account.number, customers: allCustomers });
      onCreated();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Aanmaken mislukt.");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const copyCreds = () => {
    if (!result) return;
    const lines = [`Naam: ${name}`, `Nummer: ${result.number}`, `Wachtwoord: ${password}`];
    if (result.customers.length) {
      lines.push("", "Klanten:");
      for (const c of result.customers) {
        lines.push(`${c.name} — ${c.number} — ${c.tempPassword}`);
      }
    }
    navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleSelectExisting = (id: string) => {
    setSelectedExistingCustomerIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const filteredExisting = allExistingCustomers.filter(
    (c) =>
      c.name.toLowerCase().includes(existingSearch.toLowerCase()) ||
      c.number.includes(existingSearch)
  );

  const close = () => {
    setName("");
    setNumber("");
    setPassword("");
    setCustomerCount(0);
    setResult(null);
    setCopied(false);
    setProgress(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title={result ? "Gebruiker aangemaakt" : "Gebruiker aanmaken"} size="md"
      footer={result ? <button onClick={close} className="btn-primary">Klaar</button> : (
        <>
          <button onClick={close} className="btn-secondary">Annuleren</button>
          <button onClick={handleCreate} disabled={loading || !canSubmit} className="btn-primary">
            {loading ? <Spinner /> : <UserPlus className="h-4 w-4" />} Aanmaken
          </button>
        </>
      )}
    >
      {result ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-ink-200 bg-ink-50 p-4 space-y-2 text-sm">
            <Row label="Naam" value={name} />
            <Row label="Nummer" value={result.number} mono />
            <Row label="Wachtwoord" value={password} mono />
          </div>
          {result.customers.length > 0 && (
            <>
              <p className="text-sm text-ink-500">{result.customers.length} klantaccount(s) automatically aangemaakt. De wachtwoorden zijn eenmalig zichtbaar.</p>
              <div className="max-h-60 overflow-y-auto rounded-lg border border-ink-200 divide-y divide-ink-100">
                {result.customers.map((c) => (
                  <div key={c.number} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <span className="font-medium text-ink-900">{c.name}</span>
                      <span className="ml-2 tabular-nums text-ink-500">{c.number}</span>
                    </div>
                    <span className="font-mono text-ink-700">{c.tempPassword}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="flex gap-2">
            <button onClick={async () => { const { generateCustomerListPdf: gen } = await import("@/lib/pdf"); gen({ userName: name, userNumber: result.number, customers: result.customers }); }} className="btn-primary flex-1">
              <Download className="h-4 w-4" /> PDF downloaden
            </button>
            <button onClick={copyCreds} className="btn-secondary flex-1">
              {copied ? <CheckCircle2 className="h-4 w-4 text-success-600" /> : <Copy className="h-4 w-4" />}
              {copied ? "Gekopieerd" : "Kopiëren"}
            </button>
          </div>
        </div>
      ) : progress ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-600">Klanten aanmaken… {progress.done} / {progress.total}</p>
          <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
            <div className="h-full bg-brand-600 transition-all duration-300" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1.5">Naam</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Bijv. Accountantskantoor Jansen" maxLength={80} autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1.5">Nummer</label>
            <input
              type="text"
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))}
              className="input tabular-nums"
              placeholder="Begint met 89, 8 cijfers"
              inputMode="numeric"
            />
            <p className="mt-1 text-xs text-ink-400">Het nummer kan later niet meer gewijzigd worden.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1.5">Wachtwoord</label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value.slice(0, 15))}
              className="input"
              placeholder="8-15 tekens, letters en cijfers"
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-ink-400">De gebruiker kan dit later zelf wijzigen.</p>
          </div>

          <div className="border-t border-ink-100 pt-3">
            <label className="block text-sm font-medium text-ink-700 mb-1.5">Bestaande klanten toewijzen</label>
            <input
              type="text"
              className="input w-full mb-2"
              placeholder="Zoeken op naam of klantnummer..."
              value={existingSearch}
              onChange={(e) => setExistingSearch(e.target.value)}
            />
            {allExistingCustomers.length === 0 ? (
              <p className="text-xs text-ink-400">Geen bestaande klanten beschikbaar.</p>
            ) : (
              <div className="max-h-36 overflow-y-auto rounded-lg border border-ink-200 divide-y divide-ink-100 bg-white text-sm">
                {filteredExisting.map((c) => (
                  <label key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-ink-50/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedExistingCustomerIds.includes(c.id)}
                      onChange={() => toggleSelectExisting(c.id)}
                      className="rounded border-ink-300 text-brand-600 focus:ring-brand-500 h-4 w-4"
                    />
                    <div>
                      <span className="font-medium text-ink-900">{c.name}</span>
                      <span className="ml-1.5 tabular-nums text-ink-500 text-xs">({c.number})</span>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-ink-100 pt-3">
            <label className="block text-sm font-medium text-ink-700 mb-1.5">Aantal nieuwe klanten aanmaken</label>
            <input
              type="number"
              value={customerCount}
              min={0}
              max={500}
              onChange={(e) => setCustomerCount(Math.max(0, Math.min(500, Number(e.target.value))))}
              className="input tabular-nums"
            />
            <p className="mt-1 text-xs text-ink-400">Tussen 0 en 500 nieuwe klantaccounts die automatisch voor deze gebruiker worden gegenereerd.</p>
          </div>
        </div>
      )}
    </Modal>
  );
}

function CreateCustomersModal({ user, onClose, onCreated }: { user: OwnerUser | null; onClose: () => void; onCreated: () => void }) {
  const { push } = useToast();
  const [count, setCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ number: string; name: string; tempPassword: string }[] | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await api.ownerCreateCustomers(user.id, count);
      setResult(res.created);
      onCreated();
      push("success", `${res.count} klantaccount(s) aangemaakt.`);
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Aanmaken mislukt.");
    } finally {
      setLoading(false);
    }
  };

  const copyAll = () => {
    if (!result) return;
    const text = result.map((r) => `${r.name} — ${r.number} — ${r.tempPassword}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const close = () => { setCount(1); setResult(null); setCopied(false); onClose(); };

  return (
    <Modal open={!!user} onClose={close} title={result ? "Klanten aangemaakt" : "Klanten aanmaken"} size="md"
      footer={result ? <button onClick={close} className="btn-primary">Klaar</button> : (
        <>
          <button onClick={close} className="btn-secondary">Annuleren</button>
          <button onClick={handleCreate} disabled={loading} className="btn-primary">
            {loading ? <Spinner /> : <UserPlus className="h-4 w-4" />} Aanmaken
          </button>
        </>
      )}
    >
      {result ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">{result.length} klantaccount(s) aangemaakt voor {user?.name}. Bewaar de wachtwoorden veilig.</p>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-ink-200 divide-y divide-ink-100">
            {result.map((r) => (
              <div key={r.number} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div>
                  <span className="font-medium text-ink-900">{r.name}</span>
                  <span className="ml-2 tabular-nums text-ink-500">{r.number}</span>
                </div>
                <span className="font-mono text-ink-700">{r.tempPassword}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={async () => { const { generateCustomerListPdf: gen } = await import("@/lib/pdf"); gen({ userName: user?.name ?? "", userNumber: user?.number ?? "", customers: result }); }} className="btn-primary flex-1">
              <Download className="h-4 w-4" /> PDF downloaden
            </button>
            <button onClick={copyAll} className="btn-secondary flex-1">
              {copied ? <CheckCircle2 className="h-4 w-4 text-success-600" /> : <Copy className="h-4 w-4" />}
              {copied ? "Gekopieerd" : "Kopiëren"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-500">Aantal klantaccounts dat automatisch wordt aangemaakt voor <span className="font-medium text-ink-800">{user?.name}</span>.</p>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1.5">Aantal (1 - 500)</label>
            <input type="number" value={count} min={1} max={500} onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value))))} className="input tabular-nums" autoFocus />
          </div>
        </div>
      )}
    </Modal>
  );
}

interface CustomerSelection {
  id: string;
  number: string;
  name: string;
  status: string;
  owner_id: string | null;
}

function ManageCustomersModal({
  user,
  users,
  onClose,
  onUpdated,
}: {
  user: OwnerUser | null;
  users: OwnerUser[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { push } = useToast();
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<CustomerSelection[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    api.ownerCustomers()
      .then((res) => {
        setCustomers(res.customers || []);
        // Select customers currently assigned to this user
        const initialSelected = (res.customers || [])
          .filter((c) => c.owner_id === user.id)
          .map((c) => c.id);
        setSelectedIds(initialSelected);
      })
      .catch((err) => {
        push("error", "Fout bij laden van klanten: " + (err instanceof Error ? err.message : String(err)));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [user, push]);

  const handleSave = async () => {
    if (!user) return;
    setLoading(true);
    try {
      await api.ownerAssignCustomers(user.id, selectedIds);
      push("success", "Klantkoppelingen succesvol bijgewerkt.");
      onUpdated();
      onClose();
    } catch (err) {
      push("error", "Fout bij opslaan: " + (err instanceof Error ? err.message : "Opslaan mislukt"));
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.number.includes(search)
  );

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={`Klanten koppelen voor ${user?.name}`}
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary" disabled={loading}>
            Annuleren
          </button>
          <button onClick={handleSave} disabled={loading} className="btn-primary">
            {loading ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />} Opslaan
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-500">
          Selecteer de klanten die expliciet aan <span className="font-medium text-ink-800">{user?.name}</span> toegewezen moeten zijn.
        </p>

        <div>
          <input
            type="text"
            className="input w-full"
            placeholder="Zoeken op naam of klantnummer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading && customers.length === 0 ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-6 text-sm text-ink-400">Geen klanten gevonden.</div>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-lg border border-ink-200 divide-y divide-ink-100 bg-white">
            {filtered.map((c) => {
              const otherUser = c.owner_id && c.owner_id !== user?.id
                ? users.find((u) => u.id === c.owner_id)
                : null;

              return (
                <label
                  key={c.id}
                  className="flex items-center justify-between px-4 py-3 hover:bg-ink-50/50 cursor-pointer text-sm"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      className="rounded border-ink-300 text-brand-600 focus:ring-brand-500 h-4 w-4"
                    />
                    <div>
                      <span className="font-medium text-ink-900">{c.name}</span>
                      <span className="ml-2 tabular-nums text-ink-500 text-xs">({c.number})</span>
                    </div>
                  </div>
                  {otherUser && (
                    <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/10">
                      Gekoppeld aan: {otherUser.name}
                    </span>
                  )}
                  {!otherUser && c.owner_id === user?.id && (
                    <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/10 font-semibold">
                      Toegewezen
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: { id: string; name: string; number: string } | null; onClose: () => void }) {
  const { push } = useToast();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleReset = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await api.ownerResetUserPassword(user.id);
      setResult(res.tempPassword);
      push("success", "Nieuw wachtwoord gegenereerd.");
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Reset mislukt.");
    } finally {
      setLoading(false);
    }
  };

  const close = () => { setResult(null); setCopied(false); onClose(); };

  return (
    <Modal open={!!user} onClose={close} title={result ? "Nieuw wachtwoord" : "Wachtwoord resetten"} size="sm"
      footer={result ? <button onClick={close} className="btn-primary">Klaar</button> : (
        <>
          <button onClick={close} className="btn-secondary">Annuleren</button>
          <button onClick={handleReset} disabled={loading} className="btn-danger">
            {loading ? <Spinner /> : <Lock className="h-4 w-4" />} Resetten
          </button>
        </>
      )}
    >
      {result ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">Nieuw tijdelijk wachtwoord voor <span className="font-medium text-ink-800">{user?.name}</span>:</p>
          <div className="rounded-lg border border-ink-200 bg-ink-50 p-4 text-center">
            <span className="font-mono text-lg font-medium text-ink-900">{result}</span>
          </div>
          <p className="text-xs text-amber-600 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
            <strong>Let op:</strong> Het oude wachtwoord en eventuele eerder gegenereerde inlogbladen/PDF&apos;s zijn direct ongeldig. De gebruiker moet inloggen met dit nieuwe tijdelijke wachtwoord.
          </p>
          <button onClick={() => { navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="btn-secondary w-full">
            {copied ? <CheckCircle2 className="h-4 w-4 text-success-600" /> : <Copy className="h-4 w-4" />}
            {copied ? "Gekopieerd" : "Kopiëren"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-ink-500">Weet u zeker dat u het wachtwoord van <span className="font-medium text-ink-800">{user?.name}</span> wilt resetten? Er wordt een nieuw tijdelijk wachtwoord gegenereerd.</p>
      )}
    </Modal>
  );
}

function ConfirmDeleteModal({ user, deleting, onCancel, onConfirm }: { user: { id: string; name: string; number: string } | null; deleting: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal open={!!user} onClose={onCancel} title="Gebruiker verwijderen" size="sm"
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
            Weet u zeker dat u <span className="font-medium text-ink-800">{user?.name}</span> (nr. {user?.number}) wilt verwijderen?
          </p>
        </div>
        <div className="rounded-lg border border-danger-200 bg-danger-50/50 p-3 text-xs text-danger-700">
          Alle gekoppelde klantaccounts, geüploade bestanden, inlogsessies en meldingen worden permanent verwijderd. Deze actie kan niet ongedaan worden gemaakt.
        </div>
      </div>
    </Modal>
  );
}

function ConfirmUnblockModal({ name, onCancel, onConfirm }: { name: string | null; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal open={!!name} onClose={onCancel} title="Account deblokkeren" size="sm"
      footer={
        <>
          <button onClick={onCancel} className="btn-secondary">Annuleren</button>
          <button onClick={onConfirm} className="btn-primary"><Unlock className="h-4 w-4" /> Deblokkeren</button>
        </>
      }
    >
      <p className="text-sm text-ink-600">Weet u zeker dat u <span className="font-medium text-ink-800">{name}</span> wilt deblokkeren? Het aantal mislukte pogingen wordt op nul gezet.</p>
    </Modal>
  );
}

function SecurityWarningModal({ open, onClose, warning, accountNumber }: {
  open: boolean; onClose: () => void; warning: SecurityWarning; accountNumber: string;
}) {
  if (!warning) return null;
  return (
    <Modal open={open} onClose={onClose} title="Beveiligingswaarschuwing" size="sm"
      footer={<button onClick={onClose} className="btn-primary">Begrepen</button>}
    >
      <div className="flex items-start gap-3 mb-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-warning-50 text-warning-600 flex-shrink-0">
          <TriangleAlert className="h-5 w-5" />
        </span>
        <p className="text-sm text-ink-600">Er zijn recente mislukte aanmeldpogingen op uw account gedetecteerd. Controleer deze gegevens:</p>
      </div>
      <div className="rounded-lg border border-ink-200 bg-ink-50 p-4 space-y-2 text-sm">
        <Row label="Datum" value={warning.date} />
        <Row label="Tijd" value={warning.time} />
        <Row label="Accountnummer" value={accountNumber} mono />
        <Row label="IP-adres" value={warning.ip} />
        <Row label="Aantal pogingen" value={String(warning.attempts)} />
      </div>
    </Modal>
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

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-500">{label}</span>
      <span className={`font-medium text-ink-900 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
