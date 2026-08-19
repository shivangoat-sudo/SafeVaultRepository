import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/api";
import { useToast } from "@/components/Toast";
import { DashboardShell, NotificationBell } from "@/components/DashboardShell";
import { AccountSettingsModal } from "@/components/AccountSettingsModal";
import { formatBytes, formatDate, formatDateTime, Spinner, EmptyState, PageHeader } from "@/components/ui";
import type { FileRow, Notification, ProfileData, UserNote } from "@/types";
import { processFiles } from "@/bridge";
import { CustomerArchiveTab } from "@/components/CustomerArchiveTab";
import { CustomerCommunicationsTab } from "@/components/CustomerCommunicationsTab";
import {
  Upload, History, Settings as SettingsIcon, FileText, FileImage, FileType,
  CheckCircle2, ShieldCheck, ScrollText, AlertCircle, Save, User as UserIcon,
  Archive, Mail, StickyNote, Globe, Paperclip
} from "lucide-react";

type Tab = "upload" | "history" | "archive" | "communications" | "notes" | "profile" | "settings";

export function CustomerDashboard() {
  const { push } = useToast();
  const [tab, setTab] = useState<Tab>("upload");
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [purgeNotice, setPurgeNotice] = useState(false);
  const [pendingTransfers, setPendingTransfers] = useState<Array<{ id: string; sender_name: string; receiver_name: string }>>([]);
  const [transferingAction, setTransferingAction] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [f, n, tr] = await Promise.all([
        api.customerFiles(),
        api.notifications(),
        api.customerTransfers()
      ]);
      setFiles(f.files);
      setNotifications(n.notifications);
      setPendingTransfers(tr.transfers || []);
      const hasPurge = n.notifications.some((x) => x.kind === "file_purged" && !x.read);
      setPurgeNotice(hasPurge);
      if (hasPurge) {
        const purgeIds = n.notifications.filter((x) => x.kind === "file_purged" && !x.read).map((x) => x.id);
        await api.markRead(purgeIds);
      }
    } catch (err) {
      console.error("CustomerDashboard loadAll error:", err);
      setFetchError(err instanceof Error ? err.message : "Fout bij het laden van klantgegevens.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleTransferAction = async (id: string, action: "approve" | "decline") => {
    setTransferingAction(id);
    try {
      await api.customerTransferAction(id, action);
      push("success", action === "approve" ? "Overdracht geaccepteerd." : "Overdracht geweigerd.");
      await loadAll();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Actie mislukt.");
    } finally {
      setTransferingAction(null);
    }
  };

  const nav = [
    { label: "Uploaden", icon: Upload, active: tab === "upload", onClick: () => setTab("upload") },
    { label: "Uploadgeschiedenis", icon: History, active: tab === "history", onClick: () => setTab("history") },
    { label: "Archief", icon: Archive, active: tab === "archive", onClick: () => setTab("archive") },
    { label: "Berichten", icon: Mail, active: tab === "communications", onClick: () => setTab("communications") },
    { label: "Notities", icon: StickyNote, active: tab === "notes", onClick: () => setTab("notes") },
    { label: "Mijn gegevens", icon: UserIcon, active: tab === "profile", onClick: () => setTab("profile") },
    { label: "Account", icon: SettingsIcon, active: tab === "settings", onClick: () => setTab("settings") },
  ];

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <DashboardShell
      nav={nav}
      roleLabel="Klant"
      notifications={<NotificationBell count={unreadCount} onClick={() => setNotifOpen(true)} />}
    >
      {fetchError && (
        <div className="mb-4 p-4 rounded-lg bg-danger-50 border border-danger-200 text-danger-800 text-sm flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold">Kon gegevens niet laden van de server</p>
            <p className="text-xs text-danger-700 mt-0.5">{fetchError}</p>
          </div>
          <button onClick={loadAll} className="btn-secondary text-xs shrink-0">
            Opnieuw proberen
          </button>
        </div>
      )}
      {loading ? (
        <div className="flex justify-center py-20"><Spinner className="h-6 w-6 text-ink-400" /></div>
      ) : (
        <>
          {pendingTransfers.map((tr) => (
            <div key={tr.id} className="mb-4 rounded-lg border border-brand-200 bg-brand-50 p-4 text-xs text-brand-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fade-in">
              <div>
                <p className="font-semibold text-sm">Overdrachtsverzoek van uw dossier</p>
                <p className="mt-0.5 text-brand-800">
                  Behandelaar <strong>{tr.sender_name}</strong> verzoekt uw dossier over te dragen aan <strong>{tr.receiver_name}</strong>. Gaat u hiermee akkoord?
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleTransferAction(tr.id, "decline")}
                  disabled={transferingAction === tr.id}
                  className="btn-secondary text-xs"
                >
                  Weigeren
                </button>
                <button
                  onClick={() => handleTransferAction(tr.id, "approve")}
                  disabled={transferingAction === tr.id}
                  className="btn-primary text-xs"
                >
                  {transferingAction === tr.id ? <Spinner className="h-3.5 w-3.5 mr-1" /> : null}
                  Accepteren
                </button>
              </div>
            </div>
          ))}
          {purgeNotice && (
            <div className="mb-4 rounded-lg border border-warning-500/20 bg-warning-50 px-4 py-3 text-sm text-warning-700 animate-fade-in">
              Een of meer van uw bestanden is automatisch verwijderd na het verstrijken van de ingestelde bewaartermijn.
            </div>
          )}
          {tab === "upload" && <UploadTab onUploaded={loadAll} />}
          {tab === "history" && <HistoryTab files={files} onRefresh={loadAll} />}
          {tab === "archive" && <CustomerArchiveTab />}
          {tab === "communications" && <CustomerCommunicationsTab />}
          {tab === "notes" && <CustomerNotesTab />}
          {tab === "profile" && <CustomerProfileTab />}
          {tab === "settings" && (
            <div className="space-y-6">
              <PageHeader title="Gegevens wijzigen" subtitle="Wijzig uw naam of wachtwoord" />
              <div className="card p-6 max-w-lg">
                <button onClick={() => setShowSettings(true)} className="btn-primary w-full">
                  <SettingsIcon className="h-4 w-4" /> Naam of wachtwoord wijzigen
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <AccountSettingsModal open={showSettings} onClose={() => setShowSettings(false)} canChangeName={true} />
      <NotificationsPanel open={notifOpen} onClose={() => setNotifOpen(false)} notifications={notifications} onRead={loadAll} />
      <PurgeNoticeModal open={purgeNotice} onClose={() => setPurgeNotice(false)} />
    </DashboardShell>
  );
}

function UploadTab({ onUploaded }: { onUploaded: () => void }) {
  const { push } = useToast();
  const [userName, setUserName] = useState("");
  const [userNumber, setUserNumber] = useState("");
  const [bookkeeper, setBookkeeper] = useState<{ name: string; number: string } | null>(null);
  const [loadingBookkeeper, setLoadingBookkeeper] = useState(true);
  const [category, setCategory] = useState<"income_overview" | "proof">("income_overview");
  const [quarter, setQuarter] = useState<string>("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [totalSize, setTotalSize] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [maxUploadBytes, setMaxUploadBytes] = useState<number | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.customerGetBookkeeper()
      .then((res) => {
        if (res.bookkeeper) {
          setBookkeeper(res.bookkeeper);
          setUserName(res.bookkeeper.name);
          setUserNumber(res.bookkeeper.number);
        }
      })
      .catch((err) => {
        console.error("Failed to load bookkeeper:", err);
      })
      .finally(() => {
        setLoadingBookkeeper(false);
      });

    api.orgSettings()
      .then((res) => {
        if (res && res.max_upload_bytes) {
          setMaxUploadBytes(res.max_upload_bytes);
        } else {
          setSettingsError("Maximale uploadlimiet kon niet geladen worden uit de database.");
        }
      })
      .catch((err) => {
        setSettingsError(err instanceof Error ? err.message : "Fout bij ophalen van uploadlimiet uit de database.");
      });
  }, []);

  const handleFileSelect = (fileList: FileList | null) => {
    if (!fileList) return;
    if (!maxUploadBytes) {
      push("error", "Upload geblokkeerd: Maximale uploadlimiet kan niet worden geverifieerd via de database.");
      return;
    }
    const valid: File[] = [];
    for (const f of Array.from(fileList)) {
      if (f.size > maxUploadBytes) {
        push("error", `Bestand "${f.name}" is groter dan de toegestane limiet van ${Math.round(maxUploadBytes / 1024 / 1024)} MB.`);
        continue;
      }
      valid.push(f);
    }
    const newTotal = [...selectedFiles, ...valid].reduce((s, f) => s + f.size, 0);
    if (newTotal > maxUploadBytes) {
      push("error", `Totale uploadgrootte mag maximaal ${Math.round(maxUploadBytes / 1024 / 1024)} MB bedragen.`);
      return;
    }
    if (valid.length > 0) setSelectedFiles((prev) => [...prev, ...valid]);
    setTotalSize([...selectedFiles, ...valid].reduce((s, f) => s + f.size, 0));
  };

  const removeFile = (idx: number) => {
    const next = selectedFiles.filter((_, i) => i !== idx);
    setSelectedFiles(next);
    setTotalSize(next.reduce((s, f) => s + f.size, 0));
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim() || !userNumber.trim()) {
      push("error", "Er is geen boekhouder gekoppeld aan uw account.");
      return;
    }
    if (!quarter) {
      push("error", "Selecteer voor welk kwartaal de documenten zijn.");
      return;
    }
    if (selectedFiles.length === 0) {
      push("error", "Selecteer minstens één bestand.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.set("userName", userName.trim());
      form.set("userNumber", userNumber.trim());
      form.set("category", category);
      form.set("quarter", quarter);
      form.set("year", String(new Date().getFullYear()));
      for (const f of selectedFiles) {
        form.append("files", f);
      }
      const res = await api.customerUpload(form);
      push("success", `${res.count} bestand(en) succesvol geüpload.`);

      // Only run VAT engine for income_overview category, NOT for proof (bonnen/facturen)
      if (category === "income_overview") {
        setProcessing(true);
        try {
          const result = await processFiles(selectedFiles);
          if (result.metrics.totalRowsProcessed > 0) {
            push("success", `${result.metrics.totalRowsProcessed} regels verwerkt door BTW-engine.`);
          }
        } catch {
          push("error", "BTW-berekening kon niet worden uitgevoerd. De bestanden zijn wel geüpload.");
        } finally {
          setProcessing(false);
        }
      }

      setSelectedFiles([]);
      setTotalSize(0);
      setQuarter("");
      onUploaded();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Upload mislukt.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Bestanden uploaden" subtitle="Stuur documenten veilig naar uw boekhouder" />

      {settingsError && (
        <div className="p-4 rounded-lg bg-danger-50 border border-danger-200 text-danger-800 text-sm flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold">Uploads momenteel geblokkeerd</p>
            <p className="text-xs text-danger-700 mt-0.5">{settingsError}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleUpload} className="space-y-6">
        {/* Recipient info */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink-900 mb-2">Uw gekoppelde boekhouder</h3>
          {loadingBookkeeper ? (
            <div className="flex items-center gap-2 py-2">
              <Spinner className="h-4 w-4 text-ink-400" />
              <span className="text-sm text-ink-500">Boekhouder laden...</span>
            </div>
          ) : bookkeeper ? (
            <div className="bg-brand-50 border border-brand-200 rounded-lg p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                  <UserIcon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink-900">Uw gebruiker: {bookkeeper.name}</p>
                  <p className="text-xs text-ink-500">Gebruikersnummer: {bookkeeper.number}</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2.5 py-0.5 text-xs font-medium text-success-700 border border-success-200">
                <ShieldCheck className="h-3.5 w-3.5" /> Gekoppeld en beveiligd
              </span>
            </div>
          ) : (
            <div className="bg-danger-50 border border-danger-200 rounded-lg p-4 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-danger-600" />
              <p className="text-sm text-danger-700">Er is momenteel geen boekhouder gekoppeld aan uw account. Neem contact op met SafeVault beheer.</p>
            </div>
          )}
        </div>

        {/* Category + Quarter */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink-900 mb-4">Documentgegevens</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1.5">Categorie</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setCategory("income_overview")}
                  className={`rounded-lg border p-3 text-left transition-all ${
                    category === "income_overview"
                      ? "border-brand-500 bg-brand-50 ring-2 ring-brand-200"
                      : "border-ink-200 hover:border-ink-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${category === "income_overview" ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-500"}`}>
                      <ScrollText className="h-4 w-4" />
                    </span>
                    <span className="text-sm font-medium text-ink-900">Bankoverzicht</span>
                  </div>
                  <p className="text-xs text-ink-400 mt-1.5">Inkomsten en uitgaven</p>
                </button>
                <button
                  type="button"
                  onClick={() => setCategory("proof")}
                  className={`rounded-lg border p-3 text-left transition-all ${
                    category === "proof"
                      ? "border-brand-500 bg-brand-50 ring-2 ring-brand-200"
                      : "border-ink-200 hover:border-ink-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${category === "proof" ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-500"}`}>
                      <FileText className="h-4 w-4" />
                    </span>
                    <span className="text-sm font-medium text-ink-900">Bonnen / facturen</span>
                  </div>
                  <p className="text-xs text-ink-400 mt-1.5">Bewijsstukken en documenten</p>
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1.5">Kwartaal</label>
              <div className="grid grid-cols-4 gap-2">
                {["Q1", "Q2", "Q3", "Q4"].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuarter(q)}
                    className={`rounded-lg border py-2.5 text-sm font-medium transition-all ${
                      quarter === q
                        ? "border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-200"
                        : "border-ink-200 text-ink-600 hover:border-ink-300"
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-400">Voor welk kwartaal zijn deze documenten?</p>
            </div>
          </div>
        </div>

        {/* File drop zone */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink-900 mb-4">Bestanden</h3>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFileSelect(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              dragOver ? "border-brand-500 bg-brand-50/50" : "border-ink-200 hover:border-ink-300 hover:bg-ink-50/50"
            }`}
          >
            <span className="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-ink-100 text-ink-400">
              <Upload className="h-6 w-6" />
            </span>
            <p className="mt-3 text-sm font-medium text-ink-700">Sleep bestanden hierheen of klik om te selecteren</p>
            <p className="mt-1 text-xs text-ink-400">Alle bestandstypen · Max. 50 MB per bestand en in totaal · Geen uitvoerbare bestanden</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => handleFileSelect(e.target.files)}
              className="hidden"
            />
          </div>

          {selectedFiles.length > 0 && (
            <div className="mt-4 space-y-2">
              {selectedFiles.map((f, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-ink-200 bg-ink-50/50 px-3 py-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileIcon name={f.name} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-800 truncate">{f.name}</p>
                      <p className="text-xs text-ink-400">{formatBytes(f.size)}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => removeFile(i)} className="text-ink-400 hover:text-danger-600 transition-colors text-xs font-medium">
                    Verwijderen
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 text-sm">
                <span className="text-ink-500">{selectedFiles.length} bestand(en) · {formatBytes(totalSize)}</span>
                <span className={`tabular-nums ${totalSize > MAX_SIZE ? "text-danger-600" : "text-ink-400"}`}>
                  {formatBytes(totalSize)} / 50 MB
                </span>
              </div>
            </div>
          )}
        </div>

        <button type="submit" disabled={uploading || processing || selectedFiles.length === 0} className="btn-primary w-full sm:w-auto">
          {uploading || processing ? <Spinner /> : <Upload className="h-4 w-4" />}
          {uploading ? "Uploaden..." : processing ? "Verwerken..." : "Bestanden versturen"}
        </button>
      </form>
    </div>
  );
}

function HistoryTab({ files, onRefresh }: { files: FileRow[]; onRefresh: () => void }) {
  return (
    <div className="space-y-6">
      <PageHeader title="Uploadgeschiedenis" subtitle="Uw geüploade bestanden" action={
        <button onClick={onRefresh} className="btn-secondary"><History className="h-4 w-4" /> Vernieuwen</button>
      } />
      <div className="card overflow-hidden">
        {files.length === 0 ? (
          <EmptyState icon={FileText} title="Nog geen uploads" subtitle="Geüploade bestanden verschijnen hier." />
        ) : (
          <div className="divide-y divide-ink-100">
            {files.map((f) => (
              <div key={f.id} className="flex items-center justify-between py-3 px-5 hover:bg-ink-50/50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <FileIcon name={f.original_name} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900 truncate">{f.original_name}</p>
                    <p className="text-xs text-ink-400">{formatBytes(f.size_bytes)} · {formatDateTime(f.created_at)}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-ink-400">Verloopt op</p>
                  <p className="text-xs font-medium text-ink-600">{formatDate(f.expires_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-ink-400 flex items-center gap-1.5">
        <AlertCircle className="h-3.5 w-3.5" />
        Bestanden worden automatisch opgeruimd na het verstrijken van de ingestelde bewaartermijn.
      </p>
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

// Modal import
import { Modal } from "@/components/Modal";

function PurgeNoticeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="Bestanden verwijderd" size="sm"
      footer={<button onClick={onClose} className="btn-primary">Begrepen</button>}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-warning-50 text-warning-600 flex-shrink-0">
          <CheckCircle2 className="h-5 w-5" />
        </span>
        <p className="text-sm text-ink-600">Een of meer van uw bestanden is automatisch verwijderd na het verstrijken van de ingestelde bewaartermijn, conform het privacybeleid.</p>
      </div>
    </Modal>
  );
}

// ===== Customer self-service profile =====
function CustomerProfileTab() {
  const { push } = useToast();
  const [profile, setProfile] = useState<ProfileData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.customerGetProfile()
      .then((res) => setProfile(res.profile))
      .catch(() => push("error", "Gegevens konden niet worden geladen."))
      .finally(() => setLoading(false));
  }, [push]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.customerUpdateProfile(profile);
      push("success", "Uw gegevens zijn opgeslagen.");
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Opslaan mislukt.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><Spinner className="h-6 w-6 text-ink-400" /></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Mijn gegevens" subtitle="Beheer uw eigen contactgegevens" />
      <div className="card p-6 max-w-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { key: "first_name", label: "Voornaam" },
            { key: "last_name", label: "Achternaam" },
            { key: "bsn", label: "BSN" },
            { key: "btw_number", label: "BTW-nummer" },
            { key: "address", label: "Adres" },
            { key: "postcode", label: "Postcode" },
            { key: "email", label: "E-mailadres" },
            { key: "phone", label: "Telefoonnummer" },
          ].map((f) => (
            <div key={f.key} className={f.key === "address" ? "sm:col-span-2" : ""}>
              <label className="block text-sm font-medium text-ink-700 mb-1.5">{f.label}</label>
              <input
                type="text"
                value={profile[f.key] ?? ""}
                onChange={(e) => setProfile((p) => ({ ...p, [f.key]: e.target.value }))}
                className="input"
              />
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? <Spinner /> : <Save className="h-4 w-4" />} Opslaan
          </button>
        </div>
        <p className="mt-4 text-xs text-ink-400">
          Deze gegevens zijn zichtbaar voor uw boekhouder. Uw inlognummer wordt beheerd door uw boekhouder en kan hier niet worden gewijzigd. Uw gebruikersnaam kunt u wel zelf aanpassen.
        </p>
      </div>
    </div>
  );
}

function CustomerNotesTab() {
  const { push } = useToast();
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [loading, setLoading] = useState(true);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.dossierNotes("self");
      setNotes(res.notes);
    } catch {
      push("error", "Notities konden niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const handleViewAttachment = async (filePath: string) => {
    try {
      const res = await api.dossierNoteAttachmentView(filePath);
      window.open(res.url, "_blank");
    } catch {
      push("error", "Bijlage kon niet worden geopend.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gedeelde notities"
        subtitle="Notities en toelichtingen die door uw boekhouder met u zijn gedeeld"
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : notes.length === 0 ? (
        <div className="card p-8">
          <EmptyState
            icon={StickyNote}
            title="Geen gedeelde notities"
            subtitle="Uw boekhouder heeft op dit moment geen notities met u gedeeld."
          />
        </div>
      ) : (
        <div className="space-y-4 max-w-3xl">
          {notes.map((n) => (
            <div key={n.id} className="card p-5 border border-ink-150 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    {n.title ? (
                      <h3 className="text-base font-semibold text-ink-900">{n.title}</h3>
                    ) : (
                      <h3 className="text-base font-medium text-ink-500 italic">Naamloze notitie</h3>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700 border border-brand-200">
                      <Globe className="h-3 w-3" /> Gedeeld met u
                    </span>
                  </div>
                  
                  {n.body && (
                    <p className="text-sm text-ink-700 whitespace-pre-wrap mt-2 leading-relaxed bg-ink-50/20 p-3.5 rounded-lg border border-ink-100">
                      {n.body}
                    </p>
                  )}

                  {n.file_path && (
                    <div className="mt-4 flex items-center justify-between gap-4 p-3 bg-brand-50/50 hover:bg-brand-50 border border-brand-100 rounded-xl text-sm max-w-lg transition-colors">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Paperclip className="h-4 w-4 text-brand-600 flex-shrink-0" />
                        <span className="font-semibold text-ink-800 truncate" title={n.file_name ?? ""}>
                          {n.file_name || "Bijlage"}
                        </span>
                        {n.file_size && (
                          <span className="text-xs text-ink-400 font-mono flex-shrink-0">
                            ({formatBytes(n.file_size)})
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleViewAttachment(n.file_path!)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800 bg-white border border-brand-200 hover:border-brand-300 rounded-lg px-2.5 py-1.5 transition-all shadow-sm"
                      >
                        Inzien
                      </button>
                    </div>
                  )}

                  <p className="text-xs text-ink-400 mt-3.5 flex items-center gap-1">
                    Laatst bijgewerkt: {formatDateTime(n.updated_at)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const isPdf = ext === "pdf";
  const isImage = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff"].includes(ext);
  return (
    <span className={`flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0 ${isPdf ? "bg-danger-50 text-danger-600" : isImage ? "bg-brand-50 text-brand-600" : "bg-ink-100 text-ink-500"}`}>
      {isPdf ? <FileType className="h-4.5 w-4.5" /> : isImage ? <FileImage className="h-4.5 w-4.5" /> : <FileText className="h-4.5 w-4.5" />}
    </span>
  );
}
