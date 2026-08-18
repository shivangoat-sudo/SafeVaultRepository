import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/api";
import { useToast } from "@/components/Toast";
import { DashboardShell } from "@/components/DashboardShell";
import { Modal } from "@/components/Modal";
import { StatCard, formatDateTime, Spinner, PageHeader } from "@/components/ui";
import {
  LayoutDashboard, Users, Activity, AlertTriangle, UserCheck, CheckCircle2, Clock
} from "lucide-react";

type Tab = "overview" | "users" | "customers" | "activity" | "attention";

interface SecurityWarning {
  id: string;
  event: string;
  created_at: string;
  account_id: string;
  account_name: string;
  account_number: string;
  account_role: string;
  ip: string;
  severity: "Critical" | "High" | "Warning";
  status: "Nieuw" | "In behandeling" | "Opgelost";
  metadata: Record<string, string | number | boolean | undefined>;
}

interface OrgActivity {
  id: string;
  event: string;
  created_at: string;
  account_id: string;
  ip: string;
}

interface OrgDashboardData {
  totalCustomers: number;
  activeUsers: number;
  pendingActions: number;
  recentActivity: OrgActivity[];
  customerDistribution: { id: string; name: string; count: number }[];
}

interface OrgBookkeeper {
  id: string;
  name: string;
  number: string;
  customerCount: number;
  status: string;
  last_login_at: string | null;
}

interface OrgCustomer {
  id: string;
  name: string;
  number: string;
  assignedUser: string;
  created_at: string;
  status: string;
  statuses?: {
    Q1: string;
    Q2: string;
    Q3: string;
    Q4: string;
  };
}

export function OrganizationDashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  
  // Prefetched state lifted to parent for extremely fast instant transitions
  const [overviewData, setOverviewData] = useState<OrgDashboardData | null>(null);
  const [users, setUsers] = useState<OrgBookkeeper[]>([]);
  const [customers, setCustomers] = useState<OrgCustomer[]>([]);
  const [warnings, setWarnings] = useState<SecurityWarning[]>([]);

  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingAttention, setLoadingAttention] = useState(true);

  // Parallel prefetching on first mount
  useEffect(() => {
    // 1. Fetch dashboard overview (critical for first paint)
    api.orgDashboard()
      .then((res: unknown) => {
        setOverviewData(res as OrgDashboardData);
        setLoadingOverview(false);
      })
      .catch(() => {
        setLoadingOverview(false);
      });

    // 2. Preload other tabs in parallel in the background
    api.orgUsers()
      .then(res => {
        setUsers(res.users || []);
        setLoadingUsers(false);
      })
      .catch(() => {
        setLoadingUsers(false);
      });

    api.orgCustomers()
      .then(res => {
        setCustomers(res.customers || []);
        setLoadingCustomers(false);
      })
      .catch(() => {
        setLoadingCustomers(false);
      });

    api.orgSecurityWarnings()
      .then(res => {
        setWarnings(res.warnings || []);
        setLoadingAttention(false);
      })
      .catch(() => {
        setLoadingAttention(false);
      });
  }, []);

  const handleWarningStatusUpdate = useCallback((id: string, newStatus: string) => {
    setWarnings(prev => prev.map(w => w.id === id ? { ...w, status: newStatus as SecurityWarning["status"] } : w));
    // Also update pendingActions count in overviewData
    setOverviewData((prev: OrgDashboardData | null) => {
      if (!prev) return prev;
      // Recalculate pending warning count
      const updatedWarnings = warnings.map(w => w.id === id ? { ...w, status: newStatus as SecurityWarning["status"] } : w);
      const pendingCount = updatedWarnings.filter(w => w.status !== "Opgelost").length;
      return { ...prev, pendingActions: pendingCount };
    });
  }, [warnings]);

  const nav = [
    { label: "Overzicht", icon: LayoutDashboard, active: tab === "overview", onClick: () => setTab("overview") },
    { label: "Boekhouders", icon: UserCheck, active: tab === "users", onClick: () => setTab("users") },
    { label: "Klanten", icon: Users, active: tab === "customers", onClick: () => setTab("customers") },
    { label: "Activiteit", icon: Activity, active: tab === "activity", onClick: () => setTab("activity") },
    { label: "Aandacht", icon: AlertTriangle, active: tab === "attention", onClick: () => setTab("attention") },
  ];

  return (
    <DashboardShell nav={nav} roleLabel="Organisatie">
      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
        {tab === "overview" && (
          <OverviewTab 
            setTab={setTab} 
            data={overviewData} 
            loading={loadingOverview} 
          />
        )}
        {tab === "users" && (
          <UsersTab 
            setTab={setTab} 
            users={users} 
            loading={loadingUsers} 
          />
        )}
        {tab === "customers" && (
          <CustomersTab 
            setTab={setTab} 
            customers={customers} 
            loading={loadingCustomers} 
          />
        )}
        {tab === "activity" && (
          <ActivityTab 
            setTab={setTab} 
            logs={overviewData?.recentActivity || []} 
            loading={loadingOverview} 
          />
        )}
        {tab === "attention" && (
          <AttentionTab 
            setTab={setTab} 
            warnings={warnings} 
            loading={loadingAttention} 
            onStatusUpdate={handleWarningStatusUpdate} 
          />
        )}
      </div>
    </DashboardShell>
  );
}

function OverviewTab({ setTab, data, loading }: { setTab: (t: Tab) => void; data: OrgDashboardData | null; loading: boolean }) {
  if (loading) return <div className="flex justify-center py-20"><Spinner className="h-6 w-6 text-ink-400" /></div>;
  if (!data) return <div className="p-8 text-center text-ink-500">Geen data beschikbaar.</div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Organisatie Overzicht" subtitle="Management- en statusoverzicht van uw organisatie." />
      
      <div className="grid gap-4 sm:gap-6 grid-cols-2 lg:grid-cols-4">
        <StatCard label="Totaal Klanten" value={String(data.totalCustomers)} icon={Users} onClick={() => setTab("customers")} />
        <StatCard label="Actieve Boekhouders" value={String(data.activeUsers)} icon={UserCheck} onClick={() => setTab("users")} />
        <StatCard label="Aandacht Vereist" value={String(data.pendingActions)} icon={AlertTriangle} tone={data.pendingActions > 0 ? "danger" : "success"} onClick={() => setTab("attention")} />
        <StatCard label="Activiteit" value={String(data.recentActivity.length)} sub="Recente acties" icon={Activity} onClick={() => setTab("activity")} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-ink-900">Klanten per boekhouder</h3>
          {data.customerDistribution.length > 0 ? (
            <div className="space-y-3">
              {data.customerDistribution.map((d: { id: string; name: string; count: number }) => (
                <div key={d.id} className="flex items-center justify-between p-3 rounded-lg bg-ink-50 border border-ink-100 cursor-pointer hover:border-brand-300 transition-colors" onClick={() => setTab("customers")}>
                  <span className="text-sm font-medium text-ink-800">{d.name}</span>
                  <span className="badge-neutral">{d.count} {d.count === 1 ? 'klant' : 'klanten'}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-500 py-4 text-center border border-dashed border-ink-200 rounded-lg">Geen boekhouders of klanten gevonden.</p>
          )}
        </div>

        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-900">Recente Activiteit</h3>
            <button onClick={() => setTab("activity")} className="text-xs text-brand-600 hover:text-brand-700 font-medium">Bekijk alles</button>
          </div>
          {data.recentActivity.length > 0 ? (
            <div className="space-y-3">
              {data.recentActivity.slice(0, 5).map((log: OrgActivity) => (
                <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg bg-ink-50 border border-ink-100 cursor-pointer hover:bg-ink-100" onClick={() => setTab("activity")}>
                  <Activity className="h-4 w-4 text-ink-400 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink-800">{formatEvent(log.event)}</p>
                    <p className="text-xs text-ink-500">{formatDateTime(log.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-500 py-4 text-center border border-dashed border-ink-200 rounded-lg">Geen recente activiteit.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function formatEvent(e: string) {
  const map: Record<string, string> = {
    customer_transferred: "Klant overgedragen",
    status_updated: "Klantstatus gewijzigd",
    file_uploaded: "Bestand(en) verwerkt",
    dossier_archived: "Dossier gearchiveerd",
    login_success: "Succesvolle login",
    notes_updated: "Notities bijgewerkt"
  };
  return map[e] || e;
}

function UsersTab({ setTab, users, loading }: { setTab: (t: Tab) => void; users: OrgBookkeeper[]; loading: boolean }) {
  const [filter, setFilter] = useState("all");
  const [selectedUser, setSelectedUser] = useState<OrgBookkeeper | null>(null);

  const filtered = useMemo<OrgBookkeeper[]>(() => {
    let f = users;
    if (filter === "active") f = f.filter(u => u.status === "active");
    if (filter === "inactive") f = f.filter(u => u.status !== "active");
    if (filter === "most_customers") f = [...f].sort((a, b) => b.customerCount - a.customerCount);
    if (filter === "recent_login") f = [...f].sort((a, b) => new Date(b.last_login_at || 0).getTime() - new Date(a.last_login_at || 0).getTime());
    return f;
  }, [users, filter]);

  if (loading) return <div className="flex justify-center py-20"><Spinner className="h-6 w-6 text-ink-400" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader title="Boekhouders" subtitle="Overzicht van alle boekhouders." onBack={() => setTab("overview")} />
        <select value={filter} onChange={e => setFilter(e.target.value)} className="input max-w-xs">
          <option value="all">Alle Boekhouders</option>
          <option value="active">Actief</option>
          <option value="inactive">Geblokkeerd</option>
          <option value="most_customers">Meeste Klanten</option>
          <option value="recent_login">Recent Ingelogd</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-50 border-b border-ink-200">
              <tr>
                <th className="px-4 py-3 font-medium text-ink-600">Naam</th>
                <th className="px-4 py-3 font-medium text-ink-600">Nummer</th>
                <th className="px-4 py-3 font-medium text-ink-600">Klanten</th>
                <th className="px-4 py-3 font-medium text-ink-600">Status</th>
                <th className="px-4 py-3 font-medium text-ink-600 text-right">Laatst Actief</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filtered.map(u => (
                <tr key={u.id} className="hover:bg-ink-50 cursor-pointer" onClick={() => setSelectedUser(u)}>
                  <td className="px-4 py-3 font-medium text-ink-900">{u.name}</td>
                  <td className="px-4 py-3 text-ink-600">{u.number}</td>
                  <td className="px-4 py-3 text-ink-600">{u.customerCount}</td>
                  <td className="px-4 py-3">
                    <span className={u.status === "active" ? "badge-success" : "badge-error"}>
                      {u.status === "active" ? "Actief" : "Geblokkeerd"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-500 text-right">
                    {u.last_login_at ? formatDateTime(u.last_login_at) : "Nooit"}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-ink-500">Geen boekhouders gevonden.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedUser && (
        <Modal title="Details Boekhouder" onClose={() => setSelectedUser(null)}>
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-ink-500 uppercase">Naam</p>
                <p className="text-base text-ink-900 font-medium">{selectedUser.name}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-ink-500 uppercase">Boekhoudersnummer</p>
                <p className="text-base text-ink-900">{selectedUser.number}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-ink-500 uppercase">Klanten onder beheer</p>
                <p className="text-base text-ink-900">{selectedUser.customerCount}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-ink-500 uppercase">Laatst Actief</p>
                <p className="text-base text-ink-900">{selectedUser.last_login_at ? formatDateTime(selectedUser.last_login_at) : "Nooit"}</p>
              </div>
            </div>
            <div className="pt-4 border-t border-ink-100 flex justify-end">
              <button onClick={() => { setSelectedUser(null); setTab("customers"); }} className="btn-primary">Bekijk Klanten</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CustomersTab({ setTab, customers, loading }: { setTab: (t: Tab) => void; customers: OrgCustomer[]; loading: boolean }) {
  const [filterQ, setFilterQ] = useState("all");
  const [selectedCustomer, setSelectedCustomer] = useState<OrgCustomer | null>(null);

  const filtered = useMemo<OrgCustomer[]>(() => {
    let f = customers;
    if (filterQ !== "all") {
      f = f.filter(c => {
        const statuses = c.statuses || { Q1: "not_submitted", Q2: "not_submitted", Q3: "not_submitted", Q4: "not_submitted" };
        const qKey = filterQ as keyof typeof statuses;
        return statuses[qKey] === "in_progress" || statuses[qKey] === "not_submitted";
      });
    }
    return f;
  }, [customers, filterQ]);

  if (loading) return <div className="flex justify-center py-20"><Spinner className="h-6 w-6 text-ink-400" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader title="Klanten Management" subtitle="Overzicht van alle klanten beheerd door uw organisatie." onBack={() => setTab("overview")} />
        <select value={filterQ} onChange={e => setFilterQ(e.target.value)} className="input max-w-xs">
          <option value="all">Alle Kwartalen</option>
          <option value="Q1">Q1 Aandacht Vereist</option>
          <option value="Q2">Q2 Aandacht Vereist</option>
          <option value="Q3">Q3 Aandacht Vereist</option>
          <option value="Q4">Q4 Aandacht Vereist</option>
        </select>
      </div>
      
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-50 border-b border-ink-200">
              <tr>
                <th className="px-4 py-3 font-medium text-ink-600">Klant</th>
                <th className="px-4 py-3 font-medium text-ink-600">Boekhouder</th>
                <th className="px-4 py-3 font-medium text-ink-600 text-center">Q1</th>
                <th className="px-4 py-3 font-medium text-ink-600 text-center">Q2</th>
                <th className="px-4 py-3 font-medium text-ink-600 text-center">Q3</th>
                <th className="px-4 py-3 font-medium text-ink-600 text-center">Q4</th>
                <th className="px-4 py-3 font-medium text-ink-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-ink-50 cursor-pointer" onClick={() => setSelectedCustomer(c)}>
                  <td className="px-4 py-3 font-medium text-ink-900">{c.name}</td>
                  <td className="px-4 py-3 text-ink-600">{c.assignedUser}</td>
                  <td className="px-4 py-3 text-center"><QuarterBadge status={c.statuses?.Q1} /></td>
                  <td className="px-4 py-3 text-center"><QuarterBadge status={c.statuses?.Q2} /></td>
                  <td className="px-4 py-3 text-center"><QuarterBadge status={c.statuses?.Q3} /></td>
                  <td className="px-4 py-3 text-center"><QuarterBadge status={c.statuses?.Q4} /></td>
                  <td className="px-4 py-3">
                    <span className={c.status === "active" ? "badge-success" : "badge-error"}>
                      {c.status === "active" ? "Actief" : "Inactief"}
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-ink-500">Geen klanten gevonden.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedCustomer && (
        <Modal title="Details Klant" onClose={() => setSelectedCustomer(null)}>
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-ink-500 uppercase">Naam</p>
                <p className="text-base text-ink-900 font-medium">{selectedCustomer.name}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-ink-500 uppercase">Klantnummer</p>
                <p className="text-base text-ink-900">{selectedCustomer.number}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-ink-500 uppercase">Boekhouder</p>
                <p className="text-base text-ink-900">{selectedCustomer.assignedUser}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-ink-500 uppercase">Sinds</p>
                <p className="text-base text-ink-900">{formatDateTime(selectedCustomer.created_at)}</p>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-ink-500 uppercase mb-2">Kwartaalstatussen</p>
              <div className="flex gap-4">
                <div className="flex flex-col items-center"><span className="text-xs mb-1 text-ink-500">Q1</span><QuarterBadge status={selectedCustomer.statuses?.Q1} /></div>
                <div className="flex flex-col items-center"><span className="text-xs mb-1 text-ink-500">Q2</span><QuarterBadge status={selectedCustomer.statuses?.Q2} /></div>
                <div className="flex flex-col items-center"><span className="text-xs mb-1 text-ink-500">Q3</span><QuarterBadge status={selectedCustomer.statuses?.Q3} /></div>
                <div className="flex flex-col items-center"><span className="text-xs mb-1 text-ink-500">Q4</span><QuarterBadge status={selectedCustomer.statuses?.Q4} /></div>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function QuarterBadge({ status }: { status?: string }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-success-500 inline" />;
  if (status === "in_progress") return <Clock className="h-4 w-4 text-warning-500 inline" />;
  return <span className="h-4 w-4 rounded-full border-2 border-ink-200 inline-block" />;
}

function ActivityTab({ setTab, logs, loading }: { setTab: (t: Tab) => void; logs: OrgActivity[]; loading: boolean }) {
  if (loading) return <div className="flex justify-center py-20"><Spinner className="h-6 w-6 text-ink-400" /></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Activiteit" subtitle="Overzicht van acties uitgevoerd binnen uw organisatie." onBack={() => setTab("overview")} />
      <div className="card divide-y divide-ink-100">
        {logs.map((log: OrgActivity) => (
          <div key={log.id} className="p-4 flex gap-4 items-start">
            <div className="mt-1"><Activity className="h-5 w-5 text-ink-400" /></div>
            <div>
              <p className="text-sm text-ink-900 font-medium">{formatEvent(log.event)}</p>
              <p className="text-xs text-ink-500">{formatDateTime(log.created_at)}</p>
            </div>
          </div>
        ))}
        {logs.length === 0 && <p className="p-8 text-center text-ink-500">Geen activiteiten gevonden.</p>}
      </div>
    </div>
  );
}

function formatWarningEvent(event: string) {
  const map: Record<string, string> = {
    login_failed: "Mislukte loginpoging",
    login_blocked: "Verdachte loginactiviteit (geblokkeerd account)",
    account_blocked: "Boekhouder account geblokkeerd",
    customer_blocked: "Klantaccount geblokkeerd",
    unauthorized_access: "Ongeautoriseerde toegangspoging",
    user_password_reset: "Wachtwoord hersteld",
    user_2fa_reset: "2FA instelling gewijzigd"
  };
  return map[event] || event;
}

function getEventDescription(warning: SecurityWarning) {
  const meta = warning.metadata || {};
  switch (warning.event) {
    case "login_failed":
      return `Onjuist wachtwoord ingevoerd voor account ${warning.account_name} (${warning.account_number}).`;
    case "login_blocked":
      return `Poging tot inloggen op geblokkeerd of inactief account ${warning.account_name} (${warning.account_number}). Reden: ${meta.reason || "Onbekend"}`;
    case "account_blocked":
      return `Account van boekhouder ${warning.account_name} (${warning.account_number}) is definitief geblokkeerd wegens te veel mislukte inlogpogingen.`;
    case "customer_blocked":
      return `Dossier-account van klant ${warning.account_name} (${warning.account_number}) is definitief geblokkeerd wegens te veel mislukte inlogpogingen.`;
    case "unauthorized_access":
      return (meta.description as string) || `Ongeautoriseerde poging om toegang te krijgen tot dossiergegevens door ${warning.account_name} (${warning.account_number}).`;
    case "user_password_reset":
      return `Wachtwoord van gebruiker/boekhouder ${warning.account_name} is hersteld door de beheerder.`;
    case "user_2fa_reset":
      return `MFA/2FA instellingen van gebruiker/boekhouder ${warning.account_name} zijn gereset. Bij de volgende inlog moet 2FA opnieuw worden geconfigureerd.`;
    default:
      return "Ongebruikelijke accountactiviteit gedetecteerd.";
  }
}

function AttentionTab({ setTab, warnings, loading, onStatusUpdate }: {
  setTab: (t: Tab) => void;
  warnings: SecurityWarning[];
  loading: boolean;
  onStatusUpdate: (id: string, newStatus: string) => void;
}) {
  const { push } = useToast();
  const [selectedWarning, setSelectedWarning] = useState<SecurityWarning | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [updating, setUpdating] = useState<boolean>(false);

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      setUpdating(true);
      await api.updateOrgSecurityWarningStatus(id, newStatus);
      push("success", `Status bijgewerkt naar: ${newStatus}`);
      onStatusUpdate(id, newStatus);
      
      if (selectedWarning && selectedWarning.id === id) {
        setSelectedWarning((prev) => prev ? { ...prev, status: newStatus as SecurityWarning["status"] } : null);
      }
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Fout bij bijwerken status.");
    } finally {
      setUpdating(false);
    }
  };

  const filteredWarnings = useMemo(() => {
    return warnings.filter(w => {
      if (statusFilter === "active" && w.status === "Opgelost") return false;
      if (statusFilter !== "all" && statusFilter !== "active" && w.status !== statusFilter) return false;

      if (severityFilter !== "all") {
        const severityMap: Record<string, string> = {
          critical: "Critical",
          high: "High",
          warning: "Warning"
        };
        if (w.severity !== severityMap[severityFilter]) return false;
      }

      return true;
    });
  }, [warnings, statusFilter, severityFilter]);

  if (loading) return <div className="flex justify-center py-20"><Spinner className="h-6 w-6 text-ink-400" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader 
          title="Aandacht & Beveiliging" 
          subtitle="Beveiligingswaarschuwingen, geblokkeerde accounts en verdachte inlogpogingen." 
          onBack={() => setTab("overview")}
        />
        
        <div className="flex flex-wrap gap-3">
          <div>
            <label className="block text-xs font-semibold text-ink-500 uppercase mb-1">Status</label>
            <select 
              value={statusFilter} 
              onChange={(e) => setStatusFilter(e.target.value)}
              className="select py-1 px-3 text-sm"
            >
              <option value="active">Actief (Nieuw + In behandeling)</option>
              <option value="all">Alle waarschuwingen</option>
              <option value="Nieuw">Nieuw</option>
              <option value="In behandeling">In behandeling</option>
              <option value="Opgelost">Opgelost</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink-500 uppercase mb-1">Ernst</label>
            <select 
              value={severityFilter} 
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="select py-1 px-3 text-sm"
            >
              <option value="all">Alle niveaus</option>
              <option value="critical">Kritiek</option>
              <option value="high">Hoog</option>
              <option value="warning">Waarschuwing</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card divide-y divide-ink-100 overflow-hidden">
        {filteredWarnings.map((w: SecurityWarning) => {
          const isCritical = w.severity === "Critical";
          const isHigh = w.severity === "High";
          
          return (
            <div 
              key={w.id} 
              className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover:bg-ink-50 transition-colors" 
              onClick={() => setSelectedWarning(w)}
            >
              <div className="flex items-start gap-3">
                <span className="mt-2 flex h-2 w-2 rounded-full shrink-0" style={{
                  backgroundColor: isCritical ? "#dc2626" : isHigh ? "#ea580c" : "#eab308"
                }} />
                <div>
                  <p className="text-sm font-semibold text-ink-900 flex flex-wrap items-center gap-2">
                    {formatWarningEvent(w.event)}
                    {w.status === "Nieuw" && (
                      <span className="text-[10px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">
                        Nieuw
                      </span>
                    )}
                    {w.status === "In behandeling" && (
                      <span className="text-[10px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 border border-yellow-200">
                        In behandeling
                      </span>
                    )}
                    {w.status === "Opgelost" && (
                      <span className="text-[10px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded bg-green-100 text-green-800 border border-green-200">
                        Opgelost
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink-500 mt-0.5">
                    Account: <span className="font-medium text-ink-800">{w.account_name}</span> ({w.account_number}) — {formatDateTime(w.created_at)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 self-end sm:self-center">
                <span className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${
                  isCritical 
                    ? "bg-red-50 text-red-700 border-red-200" 
                    : isHigh 
                    ? "bg-orange-50 text-orange-700 border-orange-200" 
                    : "bg-yellow-50 text-yellow-700 border-yellow-200"
                }`}>
                  {isCritical ? "Kritiek" : isHigh ? "Hoog" : "Waarschuwing"}
                </span>
              </div>
            </div>
          );
        })}
        {filteredWarnings.length === 0 && (
          <div className="p-12 text-center text-ink-500">
            <CheckCircle2 className="h-10 w-10 text-success-500 mx-auto mb-3" />
            <p className="font-semibold text-ink-900 text-base">Geen beveiligingswaarschuwingen</p>
            <p className="text-sm text-ink-500 mt-1">Alle systemen binnen uw organisatie functioneren veilig.</p>
          </div>
        )}
      </div>

      {selectedWarning && (
        <Modal title="Beveiligingswaarschuwing" onClose={() => setSelectedWarning(null)}>
          <div className="p-6 space-y-6">
            <div className="flex items-start gap-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
                <AlertTriangle className="h-5 w-5" style={{
                  color: selectedWarning.severity === "Critical" ? "#dc2626" : selectedWarning.severity === "High" ? "#ea580c" : "#eab308"
                }} />
              </span>
              <div>
                <h3 className="text-base font-semibold text-ink-900">{formatWarningEvent(selectedWarning.event)}</h3>
                <p className="text-xs text-ink-500 mt-0.5">ID: {selectedWarning.id}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 bg-ink-50 p-4 rounded-xl border border-ink-100 text-sm">
              <div>
                <p className="text-xs font-semibold text-ink-500 uppercase tracking-wider">Betrokken Account</p>
                <p className="text-ink-900 font-semibold mt-1">{selectedWarning.account_name}</p>
                <p className="text-xs text-ink-500 mt-0.5">Rol: {selectedWarning.account_role === "user" ? "Boekhouder" : selectedWarning.account_role === "customer" ? "Klant" : selectedWarning.account_role === "organization" ? "Organisatie" : selectedWarning.account_role} ({selectedWarning.account_number})</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-ink-500 uppercase tracking-wider">Datum & Tijd</p>
                <p className="text-ink-900 font-semibold mt-1">{formatDateTime(selectedWarning.created_at)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-ink-500 uppercase tracking-wider">Ernst</p>
                <p className="text-ink-900 font-semibold mt-1 flex items-center gap-1.5">
                  {selectedWarning.severity === "Critical" ? "Kritiek" : selectedWarning.severity === "High" ? "Hoog" : "Waarschuwing"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-ink-500 uppercase tracking-wider">IP Adres</p>
                <p className="text-ink-900 font-mono mt-1">{selectedWarning.ip}</p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-2">Details Gebeurtenis</p>
              <div className="p-4 bg-ink-900 text-ink-100 rounded-xl font-medium text-sm leading-relaxed">
                {getEventDescription(selectedWarning)}
              </div>
            </div>

            <div className="border-t border-ink-100 pt-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-ink-500 uppercase tracking-wider">Status Waarschuwing</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`px-2 py-0.5 text-xs font-bold rounded ${
                      selectedWarning.status === "Nieuw" 
                        ? "bg-red-100 text-red-800" 
                        : selectedWarning.status === "In behandeling" 
                        ? "bg-yellow-100 text-yellow-800" 
                        : "bg-green-100 text-green-800"
                    }`}>
                      {selectedWarning.status}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  {selectedWarning.status !== "In behandeling" && selectedWarning.status !== "Opgelost" && (
                    <button 
                      disabled={updating}
                      onClick={() => handleUpdateStatus(selectedWarning.id, "In behandeling")}
                      className="btn-secondary text-xs py-1.5 px-3"
                    >
                      In behandeling
                    </button>
                  )}
                  {selectedWarning.status !== "Opgelost" && (
                    <button 
                      disabled={updating}
                      onClick={() => handleUpdateStatus(selectedWarning.id, "Opgelost")}
                      className="btn py-1.5 px-3 text-xs bg-success-600 hover:bg-success-700 text-white"
                    >
                      Opgelost
                    </button>
                  )}
                  {selectedWarning.status === "Opgelost" && (
                    <button 
                      disabled={updating}
                      onClick={() => handleUpdateStatus(selectedWarning.id, "Nieuw")}
                      className="btn-secondary text-xs py-1.5 px-3"
                    >
                      Heropenen
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
