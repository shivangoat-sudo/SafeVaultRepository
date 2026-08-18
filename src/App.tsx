import { useState, useEffect } from "react";
import { AuthProvider, useAuth } from "@/auth";
import { ToastProvider } from "@/components/Toast";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LoginPage } from "@/pages/LoginPage";
import { OwnerDashboard } from "@/pages/OwnerDashboard";
import { UserDashboard } from "@/pages/UserDashboard";
import { OrganizationDashboard } from "@/pages/OrganizationDashboard";
import { CustomerDashboard } from "@/pages/CustomerDashboard";
import { Spinner } from "@/components/ui";
import { getSessionToken } from "@/api";

function AppRoutes() {
  const { account, refreshAccount } = useAuth();
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    const token = getSessionToken();
    if (token) {
      // Verify the persisted session is still valid on the backend.
      refreshAccount().finally(() => setBootstrapping(false));
    } else {
      setBootstrapping(false);
    }
  }, [refreshAccount]);

  if (bootstrapping) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-50">
        <Spinner className="h-6 w-6 text-ink-400" />
      </div>
    );
  }

  if (!account) return <LoginPage />;

  if (account.role === "owner") return <OwnerDashboard />;
  if (account.role === "organization") return <OrganizationDashboard />;
  if (account.role === "user") return <UserDashboard />;
  if (account.role === "customer") return <CustomerDashboard />;

  // Fallback — should never happen
  return <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <ErrorBoundary>
          <AppRoutes />
        </ErrorBoundary>
      </ToastProvider>
    </AuthProvider>
  );
}
