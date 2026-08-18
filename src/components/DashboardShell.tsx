import { useState, type ReactNode } from "react";
import { useAuth } from "@/auth";
import { Shield, LogOut, Menu, X, Bell } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SafeVaultIcon } from "@/components/SafeVaultLogo";

type NavItem = {
  label: string;
  icon: typeof Shield;
  active: boolean;
  onClick: () => void;
};

type DashboardShellProps = {
  children: ReactNode;
  nav: NavItem[];
  roleLabel: string;
  notifications?: ReactNode;
};

export function DashboardShell({ children, nav, roleLabel, notifications }: DashboardShellProps) {
  const { account, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-ink-50 flex">
      {/* Sidebar - desktop */}
      <aside className="hidden lg:flex w-60 flex-col border-r border-ink-200 bg-white">
        <SidebarContent nav={nav} accountName={account?.name ?? ""} roleLabel={roleLabel} onLogout={logout} />
      </aside>

      {/* Sidebar - mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-64 flex flex-col border-r border-ink-200 bg-white animate-slide-up">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 text-ink-400 hover:text-ink-600"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent nav={nav} accountName={account?.name ?? ""} roleLabel={roleLabel} onLogout={logout} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-ink-200 bg-white/80 px-4 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden text-ink-500 hover:text-ink-700"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2.5">
              <SafeVaultIcon className="h-7 w-7 text-ink-900 shrink-0" />
              <span className="text-base font-semibold text-ink-900 tracking-tight leading-none">SafeVault</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {notifications}
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <span className="text-ink-400">Ingelogd als</span>
              <span className="font-medium text-ink-800">{account?.name}</span>
              <span className="badge-neutral">{roleLabel}</span>
            </div>
            <button onClick={logout} className="btn-ghost px-2.5" title="Uitloggen">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto max-w-6xl animate-fade-in">{children}</div>
        </main>
      </div>
    </div>
  );
}

function SidebarContent({
  nav,
  accountName,
  roleLabel,
  onLogout,
}: {
  nav: NavItem[];
  accountName: string;
  roleLabel: string;
  onLogout: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-5 h-14 border-b border-ink-100">
        <SafeVaultIcon className="h-8 w-8" />
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-ink-900 leading-tight">SafeVault</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              onClick={item.onClick}
              className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                item.active
                  ? "bg-ink-900 text-white"
                  : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"
              }`}
            >
              <Icon className="h-4.5 w-4.5 flex-shrink-0" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-ink-100 px-3 py-3">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-xs font-semibold">
            {accountName.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-ink-800 truncate">{accountName}</span>
            <span className="text-xs text-ink-400">{roleLabel}</span>
          </div>
        </div>
        <button onClick={onLogout} className="mt-1 w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-500 hover:bg-ink-100 hover:text-ink-800 transition-colors">
          <LogOut className="h-4.5 w-4.5" />
          Uitloggen
        </button>
      </div>
    </div>
  );
}

export function NotificationBell({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="relative text-ink-500 hover:text-ink-700 transition-colors p-1.5">
      <Bell className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] font-semibold text-white">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}
