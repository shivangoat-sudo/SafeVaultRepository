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
import { NoteAttachmentModal, type NoteAttachmentTarget } from "@/components/NoteAttachmentModal";
import { Modal } from "@/components/Modal";
import {
  Upload, History, Settings as SettingsIcon, FileText, FileImage, FileType,
  CheckCircle2, ShieldCheck, ScrollText, AlertCircle, Save, User as UserIcon,
  Archive, Mail, StickyNote, Globe, Paperclip, Download, Eye, Plus, Trash2, Edit3, X, Loader2
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

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [f, n, tr] = await Promise.all([
        api.customerFiles(),
        api.notifications(),
        api.customerTransfers().catch(() => ({ transfers: [] }))
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
    } catch {
      // ignore
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
              Een of meer van uw bestanden is automatisch verwijderd na de bewaartermijn van 2 jaar.
            </div>
          )}
          {tab === "upload" && <UploadTab onUploaded={loadAll} />}
          {tab === "history" && <HistoryTab files={files} onRefresh={loadAll} />}
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
  const [maxUploadBytes, setMaxUploadBytes] = useState<number>(52428800);
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
        if (res?.max_upload_bytes) setMaxUploadBytes(Number(res.max_upload_bytes));
      })
      .catch((err) => {
        console.error("Kon organisatie-instellingen niet laden:", err);
      });
  }, []);

  const handleFileSelect = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    if (!maxUploadBytes || maxUploadBytes <= 0) {
      push("error", "Uploadlimiet kon niet worden vastgesteld. Probeer de pagina te vernieuwen.");
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
    if (valid.length === 0) return;

    const newTotal = [...selectedFiles, ...valid].reduce((s, f) => s + f.size, 0);
    if (newTotal > maxUploadBytes) {
      push("error", `Totale uploadgrootte mag maximaal ${Math.round(maxUploadBytes / 1024 / 1024)} MB bedragen.`);
      return;
    }
    setSelectedFiles((prev) => [...prev, ...valid]);
    setTotalSize(newTotal);
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
        } catch (engineErr) {
          console.error("BTW-berekeningsfout:", engineErr);
          // push("error", "De bestanden zijn geüpload, maar de BTW-berekening kon niet worden uitgevoerd.");
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
            <p className="mt-1 text-xs text-ink-400">Alle bestandstypen · Max. {Math.round(maxUploadBytes / 1024 / 1024)} MB per bestand en in totaal · Geen uitvoerbare bestanden</p>
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
                <span className={`tabular-nums ${totalSize > maxUploadBytes ? "text-danger-600" : "text-ink-400"}`}>
                  {formatBytes(totalSize)} / {formatBytes(maxUploadBytes)}
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
  const { push } = useToast();

  const handleDownload = async (fileId: string, originalName: string) => {
    try {
      const res = await api.userFileDownload(fileId);
      const a = document.createElement("a");
      a.href = res.url;
      a.download = originalName;
      a.click();
    } catch {
      push("error", "Downloaden mislukt.");
    }
  };

  const handleView = async (fileId: string) => {
    try {
      const res = await api.userFileView(fileId);
      window.open(res.url, "_blank");
    } catch {
      push("error", "Weergeven mislukt.");
    }
  };

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
                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-ink-400">Verloopt op</p>
                    <p className="text-xs font-medium text-ink-600">{formatDate(f.expires_at)}</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => handleView(f.id)} className="p-2 text-ink-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors" title="Weergeven">
                      <Eye className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleDownload(f.id, f.original_name)} className="p-2 text-ink-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors" title="Downloaden">
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-ink-400 flex items-center gap-1.5">
        <AlertCircle className="h-3.5 w-3.5" />
        Bestanden kunnen niet worden verwijderd en worden automatisch na 7 jaar opgeruimd.
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
        <p className="text-sm text-ink-600">Een of meer van uw bestanden is automatisch verwijderd na de bewaartermijn van 2 jaar, conform het privacybeleid.</p>
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

  // Form / Modal states
  const [showModal, setShowModal] = useState(false);
  const [editingNote, setEditingNote] = useState<UserNote | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<Array<{ filePath: string; fileName: string; fileSize: number; mimeType: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewAttachmentTarget, setViewAttachmentTarget] = useState<NoteAttachmentTarget>(null);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.dossierNotes("self");
      setNotes(res.notes || []);
    } catch {
      push("error", "Notities konden niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const handleOpenCreate = () => {
    setEditingNote(null);
    setTitle("");
    setBody("");
    setAttachments([]);
    setShowModal(true);
  };

  const handleOpenEdit = (note: UserNote) => {
    setEditingNote(note);
    setTitle(note.title || "");
    setBody(note.body || "");
    const initialAtts = (note.attachments || []).map((a: any) => ({
      filePath: a.file_path || a.filePath,
      fileName: a.file_name || a.fileName,
      fileSize: a.file_size || a.fileSize,
      mimeType: a.mime_type || a.mimeType,
    }));
    if (initialAtts.length === 0 && note.file_path) {
      initialAtts.push({
        filePath: note.file_path,
        fileName: note.file_name || "Bijlage",
        fileSize: note.file_size || 0,
        mimeType: note.mime_type || "application/octet-stream",
      });
    }
    setAttachments(initialAtts);
    setShowModal(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const formData = new FormData();
        formData.append("file", files[i]);
        const res = await api.dossierUploadNoteAttachment("self", formData);
        setAttachments((prev) => [...prev, res]);
      }
      push("success", "Bijlage(n) geüpload.");
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Upload mislukt.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleRemoveAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!title.trim() && !body.trim() && attachments.length === 0) {
      push("error", "Vul ten minste een titel, notitie of bijlage in.");
      return;
    }
    setSaving(true);
    try {
      if (editingNote) {
        await api.dossierUpdateNote(
          editingNote.id,
          title.trim(),
          body.trim(),
          undefined,
          undefined,
          undefined,
          undefined,
          true,
          attachments
        );
        push("success", "Notitie bijgewerkt.");
      } else {
        await api.dossierSaveNote(
          "self",
          title.trim(),
          body.trim(),
          undefined,
          undefined,
          undefined,
          undefined,
          true,
          attachments
        );
        push("success", "Notitie aangemaakt.");
      }
      setShowModal(false);
      loadNotes();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Opslaan mislukt.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (noteId: string) => {
    if (!window.confirm("Weet u zeker dat u deze notitie wilt verwijderen?")) return;
    try {
      await api.dossierDeleteNote(noteId);
      push("success", "Notitie verwijderd.");
      loadNotes();
    } catch {
      push("error", "Verwijderen mislukt.");
    }
  };

  const handleViewAttachment = (filePath: string, fileName?: string, fileSize?: number) => {
    setViewAttachmentTarget({ filePath, fileName, fileSize });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notities & Toelichtingen"
        subtitle="Notities en toelichtingen in uw dossier"
        action={
          <button onClick={handleOpenCreate} className="btn-primary text-xs">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Nieuwe Notitie
          </button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : notes.length === 0 ? (
        <div className="card p-8 text-center">
          <EmptyState
            icon={StickyNote}
            title="Geen notities"
            subtitle="Er zijn nog geen notities in uw dossier."
          />
          <button onClick={handleOpenCreate} className="btn-primary text-xs mt-4">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Plaats een notitie
          </button>
        </div>
      ) : (
        <div className="space-y-4 max-w-3xl">
          {notes.map((n) => {
            const attList = (n.attachments && n.attachments.length > 0)
              ? n.attachments
              : n.file_path
              ? [{ file_path: n.file_path, file_name: n.file_name, file_size: n.file_size, mime_type: n.mime_type }]
              : [];

            return (
              <div key={n.id} className="card p-5 border border-ink-150 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {n.title ? (
                          <h3 className="text-base font-semibold text-ink-900">{n.title}</h3>
                        ) : (
                          <h3 className="text-base font-medium text-ink-500 italic">Naamloze notitie</h3>
                        )}
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700 border border-brand-200">
                          <Globe className="h-3 w-3" /> Gedeeld
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenEdit(n)}
                          className="p-1 text-ink-400 hover:text-ink-700 rounded transition-colors"
                          title="Bewerken"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(n.id)}
                          className="p-1 text-ink-400 hover:text-danger-600 rounded transition-colors"
                          title="Verwijderen"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    
                    {n.body && (
                      <p className="text-sm text-ink-700 whitespace-pre-wrap mt-2 leading-relaxed bg-ink-50/20 p-3.5 rounded-lg border border-ink-100">
                        {n.body}
                      </p>
                    )}

                    {attList.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {attList.map((att: any, idx: number) => {
                          const fPath = att.file_path || att.filePath;
                          const fName = att.file_name || att.fileName || "Bijlage";
                          const fSize = att.file_size || att.fileSize;
                          return (
                            <div key={idx} className="flex items-center justify-between gap-4 p-2.5 bg-brand-50/50 hover:bg-brand-50 border border-brand-100 rounded-xl text-sm max-w-lg transition-colors">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <Paperclip className="h-4 w-4 text-brand-600 flex-shrink-0" />
                                <span className="font-semibold text-ink-800 truncate" title={fName}>
                                  {fName}
                                </span>
                                {fSize ? (
                                  <span className="text-xs text-ink-400 font-mono flex-shrink-0">
                                    ({formatBytes(fSize)})
                                  </span>
                                ) : null}
                              </div>
                              <button
                                onClick={() => handleViewAttachment(fPath, fName, fSize)}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800 bg-white border border-brand-200 hover:border-brand-300 rounded-lg px-2.5 py-1.5 transition-all shadow-sm"
                              >
                                Inzien
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <p className="text-xs text-ink-400 mt-3.5 flex items-center gap-1">
                      Laatst bijgewerkt: {formatDateTime(n.updated_at)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <Modal
          open={showModal}
          onClose={() => setShowModal(false)}
          title={editingNote ? "Notitie bewerken" : "Nieuwe notitie"}
          size="md"
          footer={
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="btn-secondary" disabled={saving}>
                Annuleren
              </button>
              <button onClick={handleSave} className="btn-primary" disabled={saving || uploading}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                {editingNote ? "Opslaan" : "Toevoegen"}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-ink-700 uppercase tracking-wider mb-1">
                Titel
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Bijv. Vraag over kwartaalafsluiting"
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-700 uppercase tracking-wider mb-1">
                Inhoud / Bericht
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Typ hier uw toelichting of opmerking..."
                className="input w-full min-h-[120px] resize-y"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-700 uppercase tracking-wider mb-1">
                Bijlagen
              </label>
              <div className="space-y-2">
                {attachments.map((att, i) => (
                  <div key={i} className="flex items-center justify-between p-2.5 bg-ink-50 rounded-lg border border-ink-200 text-xs">
                    <span className="font-medium text-ink-800 truncate max-w-[280px]">{att.fileName}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(i)}
                      className="text-danger-600 hover:text-danger-800 p-1"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}

                <label className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-ink-300 rounded-lg text-xs font-medium text-ink-700 hover:bg-ink-50 cursor-pointer transition-colors">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin text-brand-600" /> : <Paperclip className="h-4 w-4 text-ink-500" />}
                  <span>{uploading ? "Bezig met uploaden..." : "Bestand toevoegen"}</span>
                  <input
                    type="file"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                    disabled={uploading}
                  />
                </label>
              </div>
            </div>
          </div>
        </Modal>
      )}
      <NoteAttachmentModal attachment={viewAttachmentTarget} onClose={() => setViewAttachmentTarget(null)} />
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
