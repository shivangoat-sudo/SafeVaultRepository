import React, { useState, useEffect } from "react";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { api } from "@/api";
import { ArrowRightLeft, UserCheck, AlertTriangle } from "lucide-react";

interface TransferCustomerModalProps {
  customer: { id: string; name: string; number: string } | null;
  onClose: () => void;
  onTransferred: () => void;
}

export function TransferCustomerModal({ customer, onClose, onTransferred }: TransferCustomerModalProps) {
  const { push } = useToast();
  const [users, setUsers] = useState<Array<{ id: string; name: string; number: string; role: string }>>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [loadingUsers, setLoadingUsers] = useState<boolean>(false);
  const [transferring, setTransferring] = useState<boolean>(false);
  const [confirming, setConfirming] = useState<boolean>(false);

  useEffect(() => {
    if (customer) {
      setLoadingUsers(true);
      setSelectedUserId("");
      setConfirming(false);
      api
        .getEligibleTransferUsers()
        .then((res) => {
          setUsers(res.users || []);
          if (res.users && res.users.length > 0) {
            setSelectedUserId(res.users[0].id);
          }
        })
        .catch((err) => {
          push("error", err instanceof Error ? err.message : "Fout bij ophalen gebruikers.");
        })
        .finally(() => {
          setLoadingUsers(false);
        });
    }
  }, [customer, push]);

  const selectedUser = users.find((u) => u.id === selectedUserId);

  const handleTransfer = async () => {
    if (!customer || !selectedUserId) return;
    setTransferring(true);
    try {
      const res = await api.transferCustomer(customer.id, selectedUserId);
      push("success", res.message || "Klant succesvol overgedragen.");
      onTransferred();
      onClose();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Overdracht mislukt.");
    } finally {
      setTransferring(false);
    }
  };

  if (!customer) return null;

  return (
    <Modal open={!!customer} onClose={onClose} title="Klant overdragen" size="md">
      <div className="space-y-4 py-2">
        <div className="rounded-lg border border-ink-200 bg-ink-50/70 p-3.5 space-y-1">
          <p className="text-xs font-medium text-ink-500 uppercase tracking-wide">Klantgegevens</p>
          <p className="text-sm font-semibold text-ink-900">{customer.name}</p>
          <p className="text-xs text-ink-500 tabular-nums">Klantnummer: {customer.number}</p>
        </div>

        {loadingUsers ? (
          <div className="flex items-center justify-center py-8">
            <Spinner className="h-5 w-5 text-ink-400" />
            <span className="ml-2 text-xs text-ink-500">Bevoegde gebruikers ophalen...</span>
          </div>
        ) : users.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-900">Geen overdrachtsmogelijkheden</p>
              <p className="mt-0.5">Er zijn momenteel geen andere actieve gebruikers binnen uw organisatie waaraan deze klant kan worden overgedragen.</p>
            </div>
          </div>
        ) : !confirming ? (
          <>
            <div>
              <label className="block text-xs font-medium text-ink-700 mb-1.5">
                Overdragen aan behandelaar / gebruiker:
              </label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="input text-sm"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.number}) - {u.role === "organization" ? "Organisatie beheerdersaccount" : "Boekhouder / Gebruiker"}
                  </option>
                ))}
              </select>
            </div>

            <p className="text-xs text-ink-500 bg-ink-50 p-3 rounded-lg border border-ink-100">
              Na overdracht krijgt de gekozen behandelaar direct de volledige toegang en verantwoordelijkheid over het dossier van deze klant.
            </p>

            <div className="flex justify-end gap-2.5 pt-4 border-t border-ink-100">
              <button onClick={onClose} className="btn-secondary text-xs">Annuleren</button>
              <button
                onClick={() => setConfirming(true)}
                disabled={!selectedUserId}
                className="btn-primary text-xs"
              >
                <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" /> Volgende
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-4 space-y-2">
              <p className="text-xs font-semibold text-brand-900">Bevestig overdracht van klant</p>
              <p className="text-xs text-ink-700 leading-relaxed">
                Weet u zeker dat u <strong>{customer.name}</strong> ({customer.number}) wilt overdragen aan <strong>{selectedUser?.name}</strong>?
              </p>
            </div>

            <div className="flex justify-end gap-2.5 pt-4 border-t border-ink-100">
              <button onClick={() => setConfirming(false)} disabled={transferring} className="btn-secondary text-xs">
                Terug
              </button>
              <button
                onClick={handleTransfer}
                disabled={transferring}
                className="btn-primary text-xs"
              >
                {transferring ? <Spinner className="h-3.5 w-3.5 mr-1.5" /> : <UserCheck className="h-3.5 w-3.5 mr-1.5" />}
                {transferring ? "Verwerken..." : "Overdracht Bevestigen"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
