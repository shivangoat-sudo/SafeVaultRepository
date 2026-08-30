import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/api";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/auth";
import { Modal } from "@/components/Modal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ChatInterface } from "@/components/ChatInterface";
import { formatBytes, formatDate, formatDateTime, Spinner, EmptyState, PageHeader, CsvViewer } from "@/components/ui";
import { VatCalculator } from "@/components/VatCalculator";
import type {
  CustomerRow, ProfileData, FileRow, ArchiveFolder, ArchiveFile, ArchiveNote,
  UserNote, Communication, CommunicationAttachment, AdminStatusRow,
} from "@/types";
import {
  User as UserIcon, FileText, FolderArchive, StickyNote,
  Mail, BarChart3, Folder, FolderPlus, FilePlus, Download, Trash2, Edit3,
  ChevronRight, Save, X, Search, Home, FileImage, FileType, NotebookPen,
  Send, Calculator, Globe, Paperclip, ArrowRightLeft, FolderSymlink, RotateCcw,
  Image as ImageIcon, UploadCloud, Eye,
} from "lucide-react";
import { TransferCustomerModal } from "@/components/TransferCustomerModal";
import { NoteAttachmentModal, type NoteAttachmentTarget } from "@/components/NoteAttachmentModal";

export type DossierTab = "profile" | "uploads" | "archive" | "notes" | "communication" | "status" | "vatcalc";

const TABS: { key: DossierTab; label: string; icon: typeof UserIcon }[] = [
  { key: "profile", label: "Profiel", icon: UserIcon },
  { key: "uploads", label: "Uploads", icon: FileText },
  { key: "archive", label: "Archief", icon: FolderArchive },
  { key: "notes", label: "Notities", icon: StickyNote },
  { key: "communication", label: "Communicatie", icon: Mail },
  { key: "status", label: "Status", icon: BarChart3 },
  { key: "vatcalc", label: "BTW-calculator", icon: Calculator },
];

const PROFILE_FIELDS: { key: string; label: string }[] = [
  { key: "first_name", label: "Voornaam" },
  { key: "last_name", label: "Achternaam" },
  { key: "username", label: "Gebruikersnaam" },
  { key: "bsn", label: "BSN" },
  { key: "btw_number", label: "BTW-nummer" },
  { key: "address", label: "Woonadres" },
  { key: "postcode", label: "Postcode" },
  { key: "phone", label: "Telefoonnummer" },
  { key: "email", label: "E-mailadres" },
];

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;

export function CustomerDossier({ customer, onBack }: { customer: CustomerRow; onBack: () => void }) {
  const [tab, setTab] = useState<DossierTab>("profile");
  const [showTransferModal, setShowTransferModal] = useState(false);
  const { account } = useAuth();
  const canTransfer = account?.role === "organization" || (account?.role === "user" && Boolean(account?.is_org_user));

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.name}
        subtitle={`Klant nr. ${customer.number}`}
        onBack={onBack}
        action={
          canTransfer ? (
            <button onClick={() => setShowTransferModal(true)} className="btn-secondary text-xs">
              <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5 text-brand-600" />
              Klant Overdragen
            </button>
          ) : null
        }
      />
      <div className="border-b border-ink-200 overflow-x-auto">
        <nav className="flex gap-1 min-w-max">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t.key
                    ? "border-brand-600 text-brand-700"
                    : "border-transparent text-ink-500 hover:text-ink-800 hover:border-ink-300"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      {tab === "profile" && <ProfileTab customer={customer} />}
      {tab === "uploads" && <UploadsTab customer={customer} />}
      {tab === "archive" && <ArchiveTab customer={customer} />}
      {tab === "notes" && <NotesTab customer={customer} />}
      {tab === "communication" && <CommunicationTab customer={customer} />}
      {tab === "status" && <StatusTab customer={customer} />}
      {tab === "vatcalc" && (
        <ErrorBoundary>
          <VatCalculator customerId={customer.id} />
        </ErrorBoundary>
      )}

      <TransferCustomerModal
        customer={showTransferModal ? customer : null}
        onClose={() => setShowTransferModal(false)}
        onTransferred={() => {
          onBack();
        }}
      />
    </div>
  );
}

// ===== Profile (read-only for accountant) =====
function ProfileTab({ customer }: { customer: CustomerRow }) {
  const [profile, setProfile] = useState<ProfileData>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.dossierProfile(customer.id)
      .then((res) => setProfile(res.profile))
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false));
  }, [customer.id]);

  if (loading) return <div className="flex justify-center py-12"><Spinner className="h-6 w-6 text-ink-400" /></div>;

  return (
    <div className="card p-6 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {PROFILE_FIELDS.map((f) => (
          <div key={f.key}>
            <label className="block text-sm font-medium text-ink-700 mb-1.5">{f.label}</label>
            <div className="rounded-lg border border-ink-200 bg-ink-50/50 px-3 py-2.5 text-sm text-ink-800 min-h-[42px]">
              {profile[f.key] || <span className="text-ink-300">—</span>}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-ink-400">
        Deze gegevens worden door de klant zelf ingevuld en zijn hier alleen leesbaar.
      </p>
    </div>
  );
}

// ===== Uploads =====
function UploadsTab({ customer }: { customer: CustomerRow }) {
  const { push } = useToast();
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState<FileRow | null>(null);
  const [metaTarget, setMetaTarget] = useState<FileRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.dossierUploads(customer.id);
      setFiles(res.files);
    } catch {
      push("error", "Uploads konden niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }, [customer.id, push]);

  useEffect(() => { load(); }, [load]);

  const incomeFiles = files.filter((f) => (f.category ?? "proof") === "income_overview");
  const proofFiles = files.filter((f) => (f.category ?? "proof") === "proof");

  return (
    <div className="space-y-6">
      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6 text-ink-400" /></div>
      ) : files.length === 0 ? (
        <div className="card"><EmptyState icon={FileText} title="Geen uploads" subtitle="Deze klant heeft nog geen documenten geüpload." /></div>
      ) : (
        <>
          <UploadCategory
            title="Overzicht inkomsten en uitgaven"
            subtitle="Administratieoverzichten (CSV, Excel, enz.)"
            files={incomeFiles}
            onView={setViewer}
            onMeta={setMetaTarget}
          />
          <UploadCategory
            title="Bewijsstukken"
            subtitle="Facturen, bonnen en overige documenten"
            files={proofFiles}
            onView={setViewer}
            onMeta={setMetaTarget}
          />
        </>
      )}
      <FileViewerModal file={viewer} onClose={() => setViewer(null)} />
      <FileMetadataModal file={metaTarget} onClose={() => setMetaTarget(null)} onSaved={load} />
    </div>
  );
}

function UploadCategory({ title, subtitle, files, onView, onMeta }: {
  title: string; subtitle: string; files: FileRow[];
  onView: (f: FileRow) => void; onMeta: (f: FileRow) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-ink-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        <p className="text-xs text-ink-400">{subtitle}</p>
      </div>
      <div className="divide-y divide-ink-100">
        {files.map((f) => (
          <div key={f.id} className="flex items-center justify-between py-3 px-5 hover:bg-ink-50/50 transition-colors">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <FileIcon name={f.original_name} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-900 truncate">{f.original_name}</p>
                <p className="text-xs text-ink-400">
                  {formatBytes(f.size_bytes)} · {formatDate(f.created_at)}
                  {f.quarter && f.year ? ` · ${f.quarter} ${f.year}` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={() => onView(f)} className="btn-ghost px-2.5 py-1.5 text-xs"><Search className="h-3.5 w-3.5" /> Bekijken</button>
              <button onClick={() => onMeta(f)} className="btn-ghost px-2.5 py-1.5 text-xs"><Edit3 className="h-3.5 w-3.5" /> Categorie</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileMetadataModal({ file, onClose, onSaved }: { file: FileRow | null; onClose: () => void; onSaved: () => void }) {
  const { push } = useToast();
  const [category, setCategory] = useState<"income_overview" | "proof">("proof");
  const [quarter, setQuarter] = useState<string>("");
  const [year, setYear] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!file) return;
    setCategory((file.category ?? "proof") as "income_overview" | "proof");
    setQuarter(file.quarter ?? "");
    setYear(file.year ? String(file.year) : "");
  }, [file]);

  const handleSave = async () => {
    if (!file) return;
    setSaving(true);
    try {
      await api.dossierUpdateFileMetadata(file.id, {
        category,
        quarter: quarter || null,
        year: year ? Number(year) : null,
      });
      push("success", "Metadata opgeslagen.");
      onClose();
      onSaved();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Opslaan mislukt.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!file} onClose={onClose} title="Bestand categoriseren" size="sm"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Annuleren</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? <Spinner /> : <Save className="h-4 w-4" />} Opslaan
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink-700 mb-1.5">Categorie</label>
          <select value={category} onChange={(e) => setCategory(e.target.value as "income_overview" | "proof")} className="input">
            <option value="proof">Bewijsstuk</option>
            <option value="income_overview">Overzicht inkomsten en uitgaven</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1.5">Kwartaal</label>
            <select value={quarter} onChange={(e) => setQuarter(e.target.value)} className="input">
              <option value="">—</option>
              {QUARTERS.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1.5">Jaar</label>
            <input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="input tabular-nums" placeholder="2026" />
          </div>
        </div>
      </div>
    </Modal>
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

  const isPdf = mimeType === "application/pdf" || (file?.original_name?.toLowerCase().endsWith(".pdf") ?? false);
  const isImage = mimeType.startsWith("image/");
  const isCsv = mimeType === "text/csv" || mimeType === "text/plain" || (file?.original_name?.toLowerCase().match(/\.(csv|txt)$/) !== null);

  return (
    <Modal open={!!file} onClose={onClose} title={file?.original_name ?? ""} size="xl"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Sluiten</button>
          <button onClick={async () => {
            if (!file) return;
            try {
              const res = await api.userFileDownload(file.id);
              const a = document.createElement("a");
              a.href = res.url; a.download = file.original_name;
              document.body.appendChild(a); a.click(); a.remove();
            } catch { push("error", "Download mislukt."); }
          }} className="btn-primary"><Download className="h-4 w-4" /> Downloaden</button>
        </>
      }
    >
      <div className={`${isCsv ? "min-h-[50vh] max-h-[70vh] overflow-auto" : "h-[70vh]"} flex items-start justify-start bg-ink-50 rounded-lg overflow-hidden`}>
        {loading ? <div className="flex w-full h-full items-center justify-center"><Spinner className="h-6 w-6 text-ink-400" /></div> : url && isPdf ? (
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

// ===== Archive =====
function ArchiveTab({ customer }: { customer: CustomerRow }) {
  const { push } = useToast();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<ArchiveFolder[]>([]);
  const [folders, setFolders] = useState<ArchiveFolder[]>([]);
  const [files, setFiles] = useState<ArchiveFile[]>([]);
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [renameTarget, setRenameTarget] = useState<{ kind: "folder" | "file"; id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "folder" | "file"; id: string; name: string } | null>(null);
  const [notesTarget, setNotesTarget] = useState<{ kind: "folder" | "file"; id: string; name: string } | null>(null);
  const [editingNote, setEditingNote] = useState<UserNote | null>(null);
  const [viewAttachmentTarget, setViewAttachmentTarget] = useState<NoteAttachmentTarget>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.dossierArchive(customer.id, folderId);
      setFolders(res.folders);
      setFiles(res.files);
      setNotes(res.notes || []);
    } catch {
      push("error", "Archief kon niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }, [customer.id, folderId, push]);

  useEffect(() => { load(); }, [load]);

  const openFolder = async (folder: ArchiveFolder) => {
    setBreadcrumbs((b) => [...b, folder]);
    setFolderId(folder.id);
  };

  const goHome = () => {
    setBreadcrumbs([]);
    setFolderId(null);
  };

  const goToCrumb = (index: number) => {
    const next = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(next);
    setFolderId(next[next.length - 1]?.id ?? null);
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await api.dossierCreateFolder(customer.id, name, folderId);
      setNewFolderName("");
      setShowNewFolder(false);
      load();
      push("success", "Map aangemaakt.");
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Aanmaken mislukt.");
    }
  };

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      for (const f of Array.from(fileList)) {
        await api.dossierUploadArchiveFile(customer.id, f, folderId);
      }
      push("success", "Bestand(en) toegevoegd aan archief.");
      load();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Upload mislukt.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownload = async (f: ArchiveFile) => {
    try {
      const res = await api.dossierDownloadArchiveFile(f.id);
      const a = document.createElement("a");
      a.href = res.url; a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
    } catch {
      push("error", "Download mislukt.");
    }
  };

  const handleRename = async (name: string) => {
    if (!renameTarget) return;
    try {
      if (renameTarget.kind === "folder") {
        await api.dossierRenameFolder(renameTarget.id, name);
      } else {
        await api.dossierRenameArchiveFile(renameTarget.id, name);
      }
      push("success", "Hernoemd.");
      setRenameTarget(null);
      load();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Hernoemen mislukt.");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.kind === "folder") {
        await api.dossierDeleteFolder(deleteTarget.id);
      } else {
        await api.dossierDeleteArchiveFile(deleteTarget.id);
      }
      push("success", "Verwijderd.");
      setDeleteTarget(null);
      load();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Verwijderen mislukt.");
    }
  };

  const handleRestoreNote = async (noteId: string) => {
    try {
      await api.dossierRestoreNoteFromArchive(noteId);
      push("success", "Notitie teruggezet naar reguliere notities.");
      load();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Terugzetten mislukt.");
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      await api.dossierDeleteNote(noteId);
      push("success", "Notitie verwijderd.");
      load();
    } catch {
      push("error", "Verwijderen mislukt.");
    }
  };

  const handleViewAttachment = (filePath: string, fileName?: string, fileSize?: number) => {
    setViewAttachmentTarget({ filePath, fileName, fileSize });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-sm text-ink-500 flex-wrap">
          <button onClick={goHome} className="flex items-center gap-1 hover:text-ink-800">
            <Home className="h-3.5 w-3.5" /> Archief
          </button>
          {breadcrumbs.map((b, i) => (
            <span key={b.id} className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-ink-300" />
              <button onClick={() => goToCrumb(i)} className={i === breadcrumbs.length - 1 ? "font-medium text-ink-800" : "hover:text-ink-800"}>
                {b.name}
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowNewFolder(true)} className="btn-secondary"><FolderPlus className="h-4 w-4" /> Nieuwe map</button>
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="btn-primary">
            {uploading ? <Spinner /> : <FilePlus className="h-4 w-4" />} Bestand toevoegen
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6 text-ink-400" /></div>
      ) : folders.length === 0 && files.length === 0 && notes.length === 0 ? (
        <div className="card"><EmptyState icon={FolderArchive} title="Archief is leeg" subtitle="Voeg mappen of bestanden toe om documenten te bewaren." /></div>
      ) : (
        <div className="space-y-6">
          {(folders.length > 0 || files.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {folders.map((f) => (
                <div key={f.id} className="card p-4 group flex items-center gap-3 cursor-pointer hover:border-brand-300 transition-colors">
                  <button onClick={() => openFolder(f)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 flex-shrink-0">
                      <Folder className="h-5 w-5" />
                    </span>
                    <span className="text-sm font-medium text-ink-900 truncate">{f.name}</span>
                  </button>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setNotesTarget({ kind: "folder", id: f.id, name: f.name })} className="btn-ghost p-1.5" title="Mapnotities"><NotebookPen className="h-3.5 w-3.5" /></button>
                    <button onClick={() => setRenameTarget({ kind: "folder", id: f.id, name: f.name })} className="btn-ghost p-1.5" title="Hernoemen"><Edit3 className="h-3.5 w-3.5" /></button>
                    <button onClick={() => setDeleteTarget({ kind: "folder", id: f.id, name: f.name })} className="btn-ghost p-1.5 text-danger-600 hover:text-danger-700" title="Verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              ))}
              {files.map((f) => (
                <div key={f.id} className="card p-4 group flex items-center gap-3 hover:border-brand-300 transition-colors">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <FileIcon name={f.name} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-900 truncate">{f.name}</p>
                      <p className="text-xs text-ink-400">{formatBytes(f.size_bytes)} · {formatDate(f.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleDownload(f)} className="btn-ghost p-1.5" title="Downloaden"><Download className="h-3.5 w-3.5" /></button>
                    <button onClick={() => setNotesTarget({ kind: "file", id: f.id, name: f.name })} className="btn-ghost p-1.5" title="Bestandsnotities"><NotebookPen className="h-3.5 w-3.5" /></button>
                    <button onClick={() => setRenameTarget({ kind: "file", id: f.id, name: f.name })} className="btn-ghost p-1.5" title="Hernoemen"><Edit3 className="h-3.5 w-3.5" /></button>
                    <button onClick={() => setDeleteTarget({ kind: "file", id: f.id, name: f.name })} className="btn-ghost p-1.5 text-danger-600 hover:text-danger-700" title="Verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {notes.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2 border-b border-ink-150 pb-2">
                <StickyNote className="h-4 w-4 text-ink-500" />
                <h3 className="text-sm font-semibold text-ink-800">Gearchiveerde Notities ({notes.length})</h3>
              </div>
              <div className="space-y-3">
                {notes.map((n) => (
                  <div key={n.id} className="card p-4 bg-ink-50/30 border-ink-200">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {n.title && <h4 className="text-sm font-semibold text-ink-900">{n.title}</h4>}
                          {n.visible_to_customer && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700 border border-brand-200">
                              <Globe className="h-3 w-3" /> Zichtbaar voor klant
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-medium text-ink-600">
                            <FolderArchive className="h-3 w-3" /> Gearchiveerd
                          </span>
                        </div>
                        {n.body && <p className="text-sm text-ink-700 whitespace-pre-wrap mt-1.5">{n.body}</p>}

                        {/* Attachments */}
                        {n.attachments && n.attachments.length > 0 ? (
                          <div className="mt-3 space-y-2">
                            {n.attachments.map((att, idx) => (
                              <div key={att.id || idx} className="flex items-center gap-2 p-2 bg-white border border-ink-150 rounded-lg text-xs max-w-md">
                                <Paperclip className="h-3.5 w-3.5 text-ink-500 flex-shrink-0" />
                                <span className="font-medium text-ink-700 truncate flex-1" title={att.file_name}>
                                  {att.file_name}
                                </span>
                                {att.file_size && <span className="text-[10px] text-ink-400 font-mono">{formatBytes(att.file_size)}</span>}
                                <button
                                  onClick={() => handleViewAttachment(att.file_path, att.file_name, att.file_size)}
                                  className="btn-ghost py-1 px-2 text-brand-600 hover:text-brand-700 font-semibold"
                                >
                                  Inzien
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : n.file_path && (
                          <div className="mt-3 flex items-center gap-2 p-2 bg-white border border-ink-150 rounded-lg text-xs max-w-md">
                            <Paperclip className="h-3.5 w-3.5 text-ink-500 flex-shrink-0" />
                            <span className="font-medium text-ink-700 truncate flex-1" title={n.file_name ?? ""}>
                              {n.file_name || "Bijlage"}
                            </span>
                            {n.file_size && <span className="text-[10px] text-ink-400 font-mono">{formatBytes(n.file_size)}</span>}
                            <button
                              onClick={() => handleViewAttachment(n.file_path!, n.file_name || undefined, n.file_size || undefined)}
                              className="btn-ghost py-1 px-2 text-brand-600 hover:text-brand-700 font-semibold"
                            >
                              Inzien
                            </button>
                          </div>
                        )}

                        <p className="text-xs text-ink-400 mt-2">{formatDateTime(n.updated_at)}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleRestoreNote(n.id)}
                          className="btn-ghost p-1.5 text-brand-600 hover:text-brand-700 hover:bg-brand-50"
                          title="Terugzetten naar notities"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                        <button onClick={() => setEditingNote(n)} className="btn-ghost p-1.5" title="Wijzigen">
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => handleDeleteNote(n.id)} className="btn-ghost p-1.5 text-danger-600 hover:text-danger-700" title="Verwijderen">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showNewFolder && (
        <Modal open={showNewFolder} onClose={() => setShowNewFolder(false)} title="Nieuwe map" size="sm"
          footer={<><button onClick={() => setShowNewFolder(false)} className="btn-secondary">Annuleren</button><button onClick={handleCreateFolder} className="btn-primary"><FolderPlus className="h-4 w-4" /> Aanmaken</button></>}
        >
          <label className="block text-sm font-medium text-ink-700 mb-1.5">Mapnaam</label>
          <input type="text" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} className="input" autoFocus onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()} />
        </Modal>
      )}
      <RenameModal target={renameTarget} onClose={() => setRenameTarget(null)} onConfirm={handleRename} />
      <ConfirmDeleteModal target={deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} />
      <ArchiveNotesModal target={notesTarget} onClose={() => setNotesTarget(null)} />
      {editingNote && (
        <NoteFormModal customer={customer} note={editingNote} onClose={() => setEditingNote(null)} onSaved={load} />
      )}
      <NoteAttachmentModal attachment={viewAttachmentTarget} onClose={() => setViewAttachmentTarget(null)} />
    </div>
  );
}

function RenameModal({ target, onClose, onConfirm }: {
  target: { kind: "folder" | "file"; id: string; name: string } | null;
  onClose: () => void; onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => { setName(target?.name ?? ""); }, [target]);
  return (
    <Modal open={!!target} onClose={onClose} title="Hernoemen" size="sm"
      footer={<><button onClick={onClose} className="btn-secondary">Annuleren</button><button onClick={() => onConfirm(name)} className="btn-primary"><Save className="h-4 w-4" /> Opslaan</button></>}
    >
      <label className="block text-sm font-medium text-ink-700 mb-1.5">Naam</label>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input" autoFocus />
    </Modal>
  );
}

function ConfirmDeleteModal({ target, onClose, onConfirm }: {
  target: { kind: "folder" | "file"; id: string; name: string } | null;
  onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Modal open={!!target} onClose={onClose} title="Verwijderen" size="sm"
      footer={<><button onClick={onClose} className="btn-secondary">Annuleren</button><button onClick={onConfirm} className="btn-danger"><Trash2 className="h-4 w-4" /> Verwijderen</button></>}
    >
      <p className="text-sm text-ink-600">Weet u zeker dat u <span className="font-medium text-ink-800">{target?.name}</span> wilt verwijderen?</p>
    </Modal>
  );
}

function ArchiveNotesModal({ target, onClose }: {
  target: { kind: "folder" | "file"; id: string; name: string } | null;
  onClose: () => void;
}) {
  const { push } = useToast();
  const [notes, setNotes] = useState<ArchiveNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!target) return;
    setLoading(true);
    api.dossierArchiveNotes(target.kind, target.id)
      .then((res) => setNotes(res.notes))
      .catch(() => push("error", "Notities konden niet worden geladen."))
      .finally(() => setLoading(false));
  }, [target, push]);

  const handleAdd = async () => {
    if (!target || !body.trim()) return;
    try {
      const res = await api.dossierAddArchiveNote(target.kind, target.id, body.trim());
      setNotes((n) => [res.note, ...n]);
      setBody("");
      push("success", "Notitie toegevoegd.");
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Toevoegen mislukt.");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.dossierDeleteArchiveNote(id);
      setNotes((n) => n.filter((x) => x.id !== id));
    } catch {
      push("error", "Verwijderen mislukt.");
    }
  };

  return (
    <Modal open={!!target} onClose={onClose} title={target ? `Notities — ${target.name}` : ""} size="md"
      footer={<button onClick={onClose} className="btn-secondary">Sluiten</button>}
    >
      <div className="space-y-3 mb-4">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} className="input min-h-[80px]" placeholder="Notitie toevoegen..." />
        <div className="flex justify-end">
          <button onClick={handleAdd} className="btn-primary"><StickyNote className="h-4 w-4" /> Toevoegen</button>
        </div>
      </div>
      {loading ? <div className="flex justify-center py-6"><Spinner className="h-5 w-5 text-ink-400" /></div> : notes.length === 0 ? (
        <EmptyState icon={StickyNote} title="Geen notities" />
      ) : (
        <div className="space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="rounded-lg border border-ink-200 bg-ink-50/50 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-ink-800 whitespace-pre-wrap">{n.body}</p>
                <button onClick={() => handleDelete(n.id)} className="text-ink-400 hover:text-danger-600 flex-shrink-0"><X className="h-4 w-4" /></button>
              </div>
              <p className="text-xs text-ink-400 mt-1">{formatDateTime(n.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ===== Notes (internal) =====
function NotesTab({ customer }: { customer: CustomerRow }) {
  const { push } = useToast();
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<UserNote | null>(null);
  const [movingNote, setMovingNote] = useState<UserNote | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [viewAttachmentTarget, setViewAttachmentTarget] = useState<NoteAttachmentTarget>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.dossierNotes(customer.id);
      setNotes(res.notes);
    } catch {
      push("error", "Notities konden niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }, [customer.id]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    try {
      await api.dossierDeleteNote(id);
      push("success", "Notitie verwijderd.");
      load();
    } catch {
      push("error", "Verwijderen mislukt.");
    }
  };

  const handleViewAttachment = (filePath: string, fileName?: string, fileSize?: number) => {
    setViewAttachmentTarget({ filePath, fileName, fileSize });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-400 flex items-center gap-1.5">
          <StickyNote className="h-3.5 w-3.5" /> U kunt per notitie instellen of de klant deze mag inzien of deze verplaatsen naar een archiefmap.
        </p>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary"><NotebookPen className="h-4 w-4" /> Nieuwe notitie</button>
      </div>
      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6 text-ink-400" /></div>
      ) : notes.length === 0 ? (
        <div className="card"><EmptyState icon={StickyNote} title="Geen notities" subtitle="Maak interne aantekeningen voor deze klant." /></div>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {n.title && <h3 className="text-sm font-semibold text-ink-900">{n.title}</h3>}
                    {n.visible_to_customer && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700 border border-brand-200">
                        <Globe className="h-3 w-3" /> Zichtbaar voor klant
                      </span>
                    )}
                  </div>
                  {n.body && <p className="text-sm text-ink-700 whitespace-pre-wrap mt-1.5">{n.body}</p>}
                  
                  {/* Multiple Attachments List */}
                  {(n.attachments && n.attachments.length > 0) ? (
                    <div className="mt-3 space-y-2">
                      {n.attachments.map((att, idx) => (
                        <div key={att.id || idx} className="flex items-center gap-2 p-2 bg-ink-50/50 hover:bg-ink-50 border border-ink-150 rounded-lg text-xs max-w-md transition-colors">
                          <Paperclip className="h-3.5 w-3.5 text-ink-500 flex-shrink-0" />
                          <span className="font-medium text-ink-700 truncate flex-1" title={att.file_name}>
                            {att.file_name}
                          </span>
                          {att.file_size && <span className="text-[10px] text-ink-400 font-mono">{formatBytes(att.file_size)}</span>}
                          <button
                            onClick={() => handleViewAttachment(att.file_path, att.file_name, att.file_size)}
                            className="btn-ghost py-1 px-2 text-brand-600 hover:text-brand-700 font-semibold"
                          >
                            Inzien
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : n.file_path && (
                    <div className="mt-3 flex items-center gap-2 p-2 bg-ink-50/50 hover:bg-ink-50 border border-ink-150 rounded-lg text-xs max-w-md">
                      <Paperclip className="h-3.5 w-3.5 text-ink-500 flex-shrink-0" />
                      <span className="font-medium text-ink-700 truncate flex-1" title={n.file_name ?? ""}>
                        {n.file_name || "Bijlage"}
                      </span>
                      {n.file_size && <span className="text-[10px] text-ink-400 font-mono">{formatBytes(n.file_size)}</span>}
                      <button
                        onClick={() => handleViewAttachment(n.file_path!, n.file_name || undefined, n.file_size || undefined)}
                        className="btn-ghost py-1 px-2 text-brand-600 hover:text-brand-700 font-semibold"
                      >
                        Inzien
                      </button>
                    </div>
                  )}

                  <p className="text-xs text-ink-400 mt-2">{formatDateTime(n.updated_at)}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setMovingNote(n)}
                    className="btn-ghost p-1.5 text-ink-600 hover:text-brand-600"
                    title="Verplaatsen naar archiefmap"
                  >
                    <FolderSymlink className="h-4 w-4" />
                  </button>
                  <button onClick={() => { setEditing(n); setShowForm(true); }} className="btn-ghost p-1.5" title="Wijzigen"><Edit3 className="h-3.5 w-3.5" /></button>
                  <button onClick={() => handleDelete(n.id)} className="btn-ghost p-1.5 text-danger-600 hover:text-danger-700" title="Verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {showForm && <NoteFormModal customer={customer} note={editing} onClose={() => setShowForm(false)} onSaved={load} />}
      {movingNote && (
        <MoveNoteToArchiveModal
          customer={customer}
          note={movingNote}
          onClose={() => setMovingNote(null)}
          onMoved={load}
        />
      )}
      <NoteAttachmentModal attachment={viewAttachmentTarget} onClose={() => setViewAttachmentTarget(null)} />
    </div>
  );
}

function MoveNoteToArchiveModal({
  customer,
  note,
  onClose,
  onMoved,
}: {
  customer: CustomerRow;
  note: UserNote;
  onClose: () => void;
  onMoved: () => void;
}) {
  const { push } = useToast();
  const [folders, setFolders] = useState<ArchiveFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.dossierArchiveAllFolders(customer.id)
      .then((res) => {
        if (!active) return;
        setFolders(res.folders || []);
        if (res.folders && res.folders.length > 0) {
          setSelectedFolderId(res.folders[0].id);
        } else {
          setIsCreatingNew(true);
        }
      })
      .catch(() => {
        if (active) push("error", "Kon mappenlijst niet ophalen.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [customer.id, push]);

  const handleMove = async () => {
    setSubmitting(true);
    try {
      let targetFolderId = selectedFolderId;
      if (isCreatingNew) {
        const trimmedName = newFolderName.trim();
        if (!trimmedName) {
          push("error", "Vul een geldige mapnaam in.");
          setSubmitting(false);
          return;
        }
        const created = await api.dossierCreateFolder(customer.id, trimmedName, null);
        targetFolderId = created.folder.id;
      }

      if (!targetFolderId) {
        push("error", "Selecteer een doelmap.");
        setSubmitting(false);
        return;
      }

      await api.dossierMoveNoteToArchive(note.id, targetFolderId);
      push("success", "Notitie succesvol verplaatst naar het archief.");
      onClose();
      onMoved();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Verplaatsen mislukt.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Notitie verplaatsen naar archief"
      size="sm"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary" disabled={submitting}>
            Annuleren
          </button>
          <button onClick={handleMove} className="btn-primary" disabled={submitting || loading}>
            {submitting ? <Spinner className="h-4 w-4" /> : <FolderSymlink className="h-4 w-4" />} Verplaatsen
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-ink-600">
          Verplaats notitie <span className="font-semibold text-ink-900">{note.title || "zonder titel"}</span> naar een archiefmap. De notitie inclusief alle bijlagen blijft behouden.
        </p>

        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-5 w-5 text-ink-400" />
          </div>
        ) : (
          <div className="space-y-3">
            {folders.length > 0 && !isCreatingNew ? (
              <div>
                <label className="block text-xs font-medium text-ink-700 mb-1">
                  Kies archiefmap
                </label>
                <select
                  value={selectedFolderId}
                  onChange={(e) => setSelectedFolderId(e.target.value)}
                  className="input text-sm"
                >
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      📁 {f.name}
                    </option>
                  ))}
                </select>
                <div className="mt-2 text-right">
                  <button
                    type="button"
                    onClick={() => setIsCreatingNew(true)}
                    className="text-xs font-medium text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"
                  >
                    <FolderPlus className="h-3.5 w-3.5" /> Nieuwe map aanmaken
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-ink-700 mb-1">
                  Nieuwe archiefmap naam
                </label>
                <input
                  type="text"
                  placeholder="Bijv. Jaarwerk 2025, Belastingaangifte..."
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="input text-sm"
                  autoFocus
                />
                {folders.length > 0 && (
                  <div className="mt-2 text-right">
                    <button
                      type="button"
                      onClick={() => setIsCreatingNew(false)}
                      className="text-xs font-medium text-ink-600 hover:text-ink-900"
                    >
                      Bestaande map kiezen
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function NoteFormModal({ customer, note, onClose, onSaved }: { customer: CustomerRow; note: UserNote | null; onClose: () => void; onSaved: () => void }) {
  const { push } = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [visibleToCustomer, setVisibleToCustomer] = useState(false);
  const [saving, setSaving] = useState(false);

  // Multiple Attachments state
  const [attachments, setAttachments] = useState<{
    id?: string;
    file_path: string;
    file_name: string;
    file_size: number;
    mime_type: string;
  }[]>([]);
  
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitle(note?.title ?? "");
    setBody(note?.body ?? "");
    setVisibleToCustomer(note?.visible_to_customer ?? false);
    
    // Load existing attachments
    if (note?.attachments) {
      setAttachments(note.attachments);
    } else if (note?.file_path) {
      // Legacy fallback
      setAttachments([{
        file_path: note.file_path,
        file_name: note.file_name || "Bijlage",
        file_size: note.file_size || 0,
        mime_type: note.mime_type || "application/octet-stream"
      }]);
    } else {
      setAttachments([]);
    }
  }, [note]);

  const handleFileUpload = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      push("error", "Bestand mag niet groter zijn dan 50MB.");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.dossierUploadNoteAttachment(customer.id, formData);
      
      const newAttachment = {
        file_path: res.filePath,
        file_name: res.fileName,
        file_size: res.fileSize,
        mime_type: res.mimeType
      };
      
      setAttachments(prev => [...prev, newAttachment]);
      push("success", "Bestand succesvol geüpload.");
    } catch {
      push("error", "Uploaden van bestand mislukt.");
    } finally {
      setUploading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      // Handle all files
      Array.from(e.dataTransfer.files).forEach(file => handleFileUpload(file));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Convert to format API expects (mapping both for safety)
      const apiAttachments = attachments.map(a => ({
        filePath: a.file_path,
        fileName: a.file_name,
        fileSize: a.file_size,
        mimeType: a.mime_type
      }));

      if (note) {
        await api.dossierUpdateNote(note.id, title, body, undefined, undefined, undefined, undefined, visibleToCustomer, apiAttachments);
      } else {
        await api.dossierSaveNote(customer.id, title, body, undefined, undefined, undefined, undefined, visibleToCustomer, apiAttachments);
      }
      push("success", "Notitie opgeslagen.");
      onClose();
      onSaved();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Opslaan mislukt.");
    } finally {
      setSaving(false);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <Modal open={true} onClose={onClose} title={note ? "Notitie wijzigen" : "Nieuwe notitie"} size="md"
      footer={<><button onClick={onClose} className="btn-secondary">Annuleren</button><button onClick={handleSave} disabled={saving || uploading} className="btn-primary">{saving ? <Spinner /> : <Save className="h-4 w-4" />} Opslaan</button></>}
    >
      <div className="space-y-4">
        <div><label className="block text-sm font-medium text-ink-700 mb-1.5">Titel</label><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="Bijv. BTW aangifte controle" /></div>
        <div><label className="block text-sm font-medium text-ink-700 mb-1.5">Notitie</label><textarea value={body} onChange={(e) => setBody(e.target.value)} className="input min-h-[140px]" placeholder="Voer hier uw notitie of opmerkingen in..." /></div>
        
        {/* Attachment Upload Area */}
        <div>
          <label className="block text-sm font-medium text-ink-700 mb-1.5">Bijlagen</label>
          
          <div className="space-y-2 mb-3">
            {attachments.map((att, idx) => (
              <div key={att.id || idx} className="flex items-center justify-between p-3 border border-brand-200 bg-brand-50 rounded-xl text-sm">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Paperclip className="h-4 w-4 text-brand-600 flex-shrink-0" />
                  <div className="truncate">
                    <p className="font-medium text-ink-800 truncate">{att.file_name}</p>
                    <p className="text-xs text-ink-400">{formatBytes(att.file_size)}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeAttachment(idx)}
                  className="p-1 text-ink-400 hover:text-danger-600 transition-colors"
                  title="Bijlage verwijderen"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all flex flex-col items-center justify-center ${
              isDragOver ? "border-brand-500 bg-brand-50/20" : "border-ink-200 hover:border-brand-500 hover:bg-ink-50/50"
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => {
                if (e.target.files) {
                  Array.from(e.target.files).forEach(file => handleFileUpload(file));
                }
              }}
              multiple
              className="hidden"
            />
            {uploading ? (
              <div className="flex flex-col items-center py-2">
                <Spinner className="h-6 w-6 text-brand-600 mb-2" />
                <p className="text-xs font-medium text-ink-600">Bezig met uploaden...</p>
              </div>
            ) : (
              <>
                <FilePlus className="h-6 w-6 text-ink-400 mb-2" />
                <p className="text-xs font-semibold text-ink-700">Sleep bestanden hierheen of klik om toe te voegen</p>
                <p className="text-[10px] text-ink-400 mt-1">Maximale bestandsgrootte: 50MB</p>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="visibleToCustomer"
            checked={visibleToCustomer}
            onChange={(e) => setVisibleToCustomer(e.target.checked)}
            className="rounded border-ink-300 text-brand-600 focus:ring-brand-500"
          />
          <label htmlFor="visibleToCustomer" className="text-sm font-medium text-ink-700">Zichtbaar voor klant</label>
        </div>
        <p className="text-xs text-ink-500">Als dit is aangevinkt, kan de klant de notitie inzien, evenals alle bestanden/afbeeldingen die hieraan worden toegevoegd.</p>
      </div>
    </Modal>
  );
}

// ===== Communication =====
function CommunicationTab({ customer }: { customer: CustomerRow }) {
  const { push } = useToast();
  const [comms, setComms] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingComm, setEditingComm] = useState<Communication | null>(null);
  const [showLiveChat, setShowLiveChat] = useState(false);
  const [viewer, setViewer] = useState<Communication | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.dossierCommunications(customer.id);
      setComms(res.communications || []);
    } catch {
      push("error", "Communicatie kon niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }, [customer.id, push]);

  useEffect(() => { load(); }, [load]);

  const handleDirectSendDraft = async (comm: Communication) => {
    setSendingId(comm.id);
    try {
      await api.dossierSendDraftCommunication(customer.id, comm.id);
      push("success", "Concept succesvol per e-mail verzonden naar de klant.");
      if (viewer?.id === comm.id) {
        setViewer(null);
      }
      load();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Verzenden van concept mislukt.");
    } finally {
      setSendingId(null);
    }
  };

  const handleDeleteComm = async (commId: string) => {
    if (!window.confirm("Weet u zeker dat u dit concept wilt verwijderen?")) return;
    try {
      await api.dossierDeleteCommunication(customer.id, commId);
      push("success", "Bericht/concept verwijderd.");
      if (viewer?.id === commId) {
        setViewer(null);
      }
      load();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Verwijderen mislukt.");
    }
  };

  if (showLiveChat) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="flex justify-between items-center bg-ink-50 p-3 rounded-lg border border-ink-150">
          <div>
            <h3 className="font-medium text-ink-900 text-sm">Live Chat met {customer.name}</h3>
            <p className="text-xs text-ink-500">Stuur en ontvang in real-time berichten en bestanden</p>
          </div>
          <button onClick={() => setShowLiveChat(false)} className="btn-secondary py-1.5 text-xs">
            Terug naar Communicatie overzicht
          </button>
        </div>
        <ChatInterface customerId={customer.id} customerName={customer.name} currentUserRole="user" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-3">
        <button onClick={() => setShowLiveChat(true)} className="btn-secondary flex items-center gap-1.5 text-sm">
          <Send className="h-4 w-4 text-ink-500" /> Open Live Chat
        </button>
        <button
          onClick={() => {
            setEditingComm(null);
            setShowForm(true);
          }}
          className="btn-primary flex items-center gap-1.5 text-sm"
        >
          <Mail className="h-4 w-4" /> E-mail versturen
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6 text-ink-400" /></div>
      ) : comms.length === 0 ? (
        <div className="card"><EmptyState icon={Mail} title="Geen communicatie" subtitle="Verzonden e-mails en concepten verschijnen hier." /></div>
      ) : (
        <div className="card overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50/50 text-left text-xs font-medium text-ink-500 uppercase tracking-wide">
                <th className="px-4 py-3">Datum</th>
                <th className="px-4 py-3">Tijd</th>
                <th className="px-4 py-3">Kwartaal</th>
                <th className="px-4 py-3">Onderwerp</th>
                <th className="px-4 py-3">Ontvanger</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Acties</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {comms.map((c) => {
                const d = new Date(c.sent_at);
                const isDraft = c.status === "draft";
                const isSending = sendingId === c.id;
                const hasAttachments = c.attachments && c.attachments.length > 0;

                return (
                  <tr
                    key={c.id}
                    className="hover:bg-ink-50/50 transition-colors cursor-pointer"
                    onClick={() => setViewer(c)}
                  >
                    <td className="px-4 py-3 text-ink-700">{d.toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td className="px-4 py-3 text-ink-500 tabular-nums">{d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-4 py-3 text-ink-500">{c.quarter && c.year ? `${c.quarter} ${c.year}` : "—"}</td>
                    <td className="px-4 py-3 font-medium text-ink-900">
                      <div className="flex items-center gap-1.5">
                        <span>{c.subject}</span>
                        {hasAttachments && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-ink-100 text-[11px] text-ink-600 font-normal"
                            title={`${c.attachments!.length} ${c.attachments!.length === 1 ? "bijlage" : "bijlagen"}`}
                          >
                            <Paperclip className="h-3 w-3" />
                            {c.attachments!.length}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-600">{c.recipient}</td>
                    <td className="px-4 py-3">
                      {isDraft ? (
                        <span className="badge-neutral">Concept</span>
                      ) : (
                        <span className="badge-active">Verzonden</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {isDraft ? (
                          <>
                            <button
                              onClick={() => handleDirectSendDraft(c)}
                              disabled={isSending}
                              className="btn-primary py-1 px-2.5 text-xs flex items-center gap-1"
                              title="Concept nu versturen per e-mail"
                            >
                              {isSending ? <Spinner className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                              <span>Versturen</span>
                            </button>
                            <button
                              onClick={() => {
                                setEditingComm(c);
                                setShowForm(true);
                              }}
                              className="btn-secondary py-1 px-2 text-xs flex items-center gap-1"
                              title="Concept bewerken"
                            >
                              <Edit3 className="h-3.5 w-3.5 text-ink-600" />
                              <span>Bewerken</span>
                            </button>
                            <button
                              onClick={() => handleDeleteComm(c.id)}
                              className="btn-ghost py-1 px-1.5 text-xs text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                              title="Concept verwijderen"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setViewer(c)}
                            className="btn-secondary py-1 px-2 text-xs text-ink-600"
                          >
                            Bekijken
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {showForm && (
        <CommunicationFormModal
          customer={customer}
          initialComm={editingComm}
          onClose={() => {
            setShowForm(false);
            setEditingComm(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditingComm(null);
            load();
          }}
        />
      )}
      <CommunicationViewerModal
        comm={viewer}
        onClose={() => setViewer(null)}
        onEdit={(c) => {
          setViewer(null);
          setEditingComm(c);
          setShowForm(true);
        }}
        onSend={(c) => handleDirectSendDraft(c)}
        onDelete={(cId) => handleDeleteComm(cId)}
        sending={Boolean(viewer && sendingId === viewer.id)}
      />
    </div>
  );
}

function CommunicationViewerModal({
  comm,
  onClose,
  onEdit,
  onSend,
  onDelete,
  sending = false,
}: {
  comm: Communication | null;
  onClose: () => void;
  onEdit?: (comm: Communication) => void;
  onSend?: (comm: Communication) => void;
  onDelete?: (commId: string) => void;
  sending?: boolean;
}) {
  const { push } = useToast();
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [loadingUrls, setLoadingUrls] = useState(false);

  useEffect(() => {
    if (!comm || !comm.attachments || comm.attachments.length === 0) {
      setAttachmentUrls({});
      return;
    }

    let isMounted = true;
    setLoadingUrls(true);

    const loadUrls = async () => {
      const urls: Record<string, string> = {};
      for (const att of comm.attachments || []) {
        try {
          const res = await api.dossierCommunicationAttachmentView(att.file_path);
          if (res?.url) {
            urls[att.file_path] = res.url;
          }
        } catch (err) {
          console.error("Failed to load attachment url:", err);
        }
      }
      if (isMounted) {
        setAttachmentUrls(urls);
        setLoadingUrls(false);
      }
    };

    loadUrls();
    return () => {
      isMounted = false;
    };
  }, [comm]);

  if (!comm) return null;
  const d = new Date(comm.sent_at);
  const isDraft = comm.status === "draft";
  const attachments = comm.attachments || [];

  const handleOpenAttachment = async (att: CommunicationAttachment) => {
    try {
      let url = attachmentUrls[att.file_path];
      if (!url) {
        const res = await api.dossierCommunicationAttachmentView(att.file_path);
        url = res.url;
      }
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch {
      push("error", "Kan bijlage niet openen.");
    }
  };

  return (
    <Modal
      open={!!comm}
      onClose={onClose}
      title={comm.subject}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <div>
            {isDraft && onDelete && (
              <button
                onClick={() => onDelete(comm.id)}
                disabled={sending}
                className="btn-ghost text-rose-600 hover:bg-rose-50 text-xs flex items-center gap-1 px-2.5 py-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" /> Concept verwijderen
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-secondary">
              Sluiten
            </button>
            {isDraft && onEdit && (
              <button
                onClick={() => onEdit(comm)}
                disabled={sending}
                className="btn-secondary flex items-center gap-1.5"
              >
                <Edit3 className="h-4 w-4 text-ink-600" /> Bewerken
              </button>
            )}
            {isDraft && onSend && (
              <button
                onClick={() => onSend(comm)}
                disabled={sending}
                className="btn-primary flex items-center gap-1.5"
              >
                {sending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                Concept versturen
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-ink-100 pb-3">
          <div className="grid grid-cols-2 gap-4 text-sm flex-1">
            <div>
              <p className="text-xs text-ink-400">Datum</p>
              <p className="font-medium text-ink-800">
                {d.toLocaleString("nl-NL", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-400">Ontvanger</p>
              <p className="font-medium text-ink-800">{comm.recipient}</p>
            </div>
          </div>
          <div>
            {isDraft ? (
              <span className="badge-neutral text-xs">Concept</span>
            ) : (
              <span className="badge-active text-xs">Verzonden</span>
            )}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-ink-500 mb-1.5">Bericht</p>
          <div className="rounded-lg border border-ink-200 bg-ink-50/50 p-4 text-sm text-ink-700 whitespace-pre-wrap min-h-[100px]">
            {comm.body || "(geen berichtinhoud)"}
          </div>
        </div>

        {attachments.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-ink-500 flex items-center gap-1.5">
              <Paperclip className="h-3.5 w-3.5" />
              Bijlagen en afbeeldingen ({attachments.length})
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {attachments.map((att, idx) => {
                const isImg = att.mime_type?.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(att.file_name);
                const signedUrl = attachmentUrls[att.file_path];

                return (
                  <div
                    key={idx}
                    className="flex flex-col rounded-lg border border-ink-200 bg-white p-2.5 hover:border-brand-300 transition-colors shadow-xs"
                  >
                    {isImg && signedUrl && (
                      <div
                        onClick={() => handleOpenAttachment(att)}
                        className="w-full h-32 mb-2 rounded bg-ink-100 overflow-hidden cursor-pointer flex items-center justify-center border border-ink-150"
                      >
                        <img
                          src={signedUrl}
                          alt={att.file_name}
                          className="max-h-full max-w-full object-contain hover:scale-105 transition-transform"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {isImg ? (
                          <ImageIcon className="h-4 w-4 text-brand-600 flex-shrink-0" />
                        ) : (
                          <FileText className="h-4 w-4 text-ink-500 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-ink-800 truncate" title={att.file_name}>
                            {att.file_name}
                          </p>
                          <p className="text-[10px] text-ink-400">
                            {formatBytes(att.file_size)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenAttachment(att)}
                          className="p-1 rounded text-ink-500 hover:text-ink-900 hover:bg-ink-100 text-xs"
                          title="Openen"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function CommunicationFormModal({
  customer,
  initialComm,
  onClose,
  onSaved,
}: {
  customer: CustomerRow;
  initialComm?: Communication | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { push } = useToast();
  const [subject, setSubject] = useState(initialComm?.subject || "");
  const [body, setBody] = useState(initialComm?.body || "");
  const [quarter, setQuarter] = useState<string>(initialComm?.quarter || "");
  const [year, setYear] = useState<string>(initialComm?.year ? String(initialComm.year) : "");
  const [attachments, setAttachments] = useState<CommunicationAttachment[]>(initialComm?.attachments || []);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customerEmail, setCustomerEmail] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .dossierProfile(customer.id)
      .then((res) => setCustomerEmail(res.profile.email ?? ""))
      .catch(() => setCustomerEmail(""));
  }, [customer.id]);

  const processUploadFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setUploadingFiles(true);
    const newAttachments: CommunicationAttachment[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const formData = new FormData();
      formData.append("file", file);
      try {
        const uploaded = await api.dossierUploadCommunicationAttachment(customer.id, formData);
        newAttachments.push({
          file_path: uploaded.filePath,
          file_name: uploaded.fileName,
          file_size: uploaded.fileSize,
          mime_type: uploaded.mimeType,
        });
      } catch (err) {
        console.error("Upload error:", err);
        push("error", `Uploaden van ${file.name} mislukt.`);
      }
    }

    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments]);
      push("success", `${newAttachments.length} ${newAttachments.length === 1 ? "afbeelding/bestand" : "afbeeldingen/bestanden"} toegevoegd.`);
    }
    setUploadingFiles(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processUploadFiles(e.target.files);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processUploadFiles(e.dataTransfer.files);
    }
  };

  const handleRemoveAttachment = (idxToRemove: number) => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== idxToRemove));
  };

  const handleSave = async (asDraft: boolean) => {
    if (!subject.trim()) {
      push("error", "Onderwerp is vereist.");
      return;
    }
    if (!body.trim()) {
      push("error", "Bericht is vereist.");
      return;
    }
    setSaving(true);
    try {
      const res = await api.dossierLogCommunication(customer.id, {
        id: initialComm?.id,
        subject: subject.trim(),
        body: body.trim(),
        quarter: quarter || null,
        year: year ? Number(year) : null,
        status: asDraft ? "draft" : "sent",
        attachments,
      });
      if (res.warning) {
        push("warning", res.warning);
      } else {
        push("success", asDraft ? "Bericht opgeslagen als concept." : "E-mail succesvol verzonden.");
      }
      onClose();
      onSaved();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Opslaan mislukt.");
    } finally {
      setSaving(false);
    }
  };

  const emailInfo = customerEmail ? (
    <>
      Wordt verzonden naar: <span className="font-medium text-ink-800">{customerEmail}</span>
    </>
  ) : (
    <span className="text-warning-700">Deze klant heeft geen e-mailadres ingevuld — verzenden slaat het bericht op als concept.</span>
  );

  const modalTitle = initialComm ? "Concept bewerken & versturen" : "E-mail opstellen & versturen";

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={modalTitle}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Annuleren
          </button>
          <button onClick={() => handleSave(true)} disabled={saving || uploadingFiles} className="btn-secondary">
            {initialComm ? "Concept bijwerken" : "Opslaan als concept"}
          </button>
          <button onClick={() => handleSave(false)} disabled={saving || uploadingFiles} className="btn-primary">
            {saving ? <Spinner /> : <Mail className="h-4 w-4" />} Direct versturen
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-ink-50 px-3 py-2.5 text-xs text-ink-500 flex items-center gap-1.5">
          <Mail className="h-3.5 w-3.5 flex-shrink-0" /> {emailInfo}
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-700 mb-1.5">Onderwerp</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="input"
            placeholder="Bijv. Aanlevering kwartaalstukken Q1"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-700 mb-1.5">Bericht</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="input min-h-[140px]"
            placeholder="Type hier het bericht aan de klant..."
          />
        </div>

        {/* Attachment & Image Upload Section */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-ink-700">
              Afbeeldingen &amp; Bijlagen
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingFiles}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              <span>Afbeelding/bestand toevoegen</span>
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.zip"
            onChange={handleFileChange}
            className="hidden"
          />

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-lg border-2 border-dashed p-3.5 text-center transition-colors ${
              isDragging
                ? "border-brand-500 bg-brand-50/50"
                : "border-ink-200 bg-ink-50/40 hover:bg-ink-50 hover:border-ink-300"
            }`}
          >
            {uploadingFiles ? (
              <div className="flex items-center justify-center gap-2 py-1 text-xs text-ink-600">
                <Spinner className="h-4 w-4" />
                <span>Bestanden uploaden...</span>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-1 text-xs text-ink-500">
                <div className="flex items-center gap-2 text-ink-700 font-medium">
                  <UploadCloud className="h-4 w-4 text-brand-600" />
                  <span>Sleep afbeeldingen hierheen of klik om te selecteren</span>
                </div>
                <p className="text-[11px] text-ink-400">
                  Ondersteunt JPG, PNG, GIF, WebP, PDF en documenten. Afbeeldingen worden automatisch ingesloten in de e-mail.
                </p>
              </div>
            )}
          </div>

          {/* Attachments List */}
          {attachments.length > 0 && (
            <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {attachments.map((att, idx) => {
                const isImg = att.mime_type?.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(att.file_name);
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-xs shadow-2xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isImg ? (
                        <ImageIcon className="h-4 w-4 text-brand-600 flex-shrink-0" />
                      ) : (
                        <Paperclip className="h-4 w-4 text-ink-500 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-ink-800 truncate" title={att.file_name}>
                          {att.file_name}
                        </p>
                        <p className="text-[10px] text-ink-400">
                          {formatBytes(att.file_size)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveAttachment(idx);
                      }}
                      className="p-1 rounded text-ink-400 hover:text-rose-600 hover:bg-rose-50 flex-shrink-0 ml-2"
                      title="Verwijderen"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1.5">Kwartaal (optioneel)</label>
            <select value={quarter} onChange={(e) => setQuarter(e.target.value)} className="input">
              <option value="">—</option>
              {QUARTERS.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1.5">Jaar (optioneel)</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="input tabular-nums"
              placeholder={String(new Date().getFullYear())}
            />
          </div>
        </div>
        <p className="text-xs text-ink-400">
          De e-mail wordt verzonden via uw geconfigureerde SafeVault e-mailservice met het officiële SafeVault logo en meegestuurde afbeeldingen/bijlagen.
        </p>
      </div>
    </Modal>
  );
}

// ===== Status =====
function StatusTab({ customer }: { customer: CustomerRow }) {
  const { push } = useToast();
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [quarters, setQuarters] = useState<AdminStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.dossierStatus(customer.id, year);
      setQuarters(res.quarters);
    } catch {
      push("error", "Status kon niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }, [customer.id, year, push]);

  useEffect(() => { load(); }, [load]);

  const handleUpdate = async (quarter: string, status: string) => {
    setUpdating(quarter);
    try {
      await api.dossierUpdateStatus(customer.id, year, quarter, status);
      push("success", "Status bijgewerkt.");
      load();
    } catch {
      push("error", "Bijwerken mislukt.");
    } finally {
      setUpdating(null);
    }
  };

  const STATUS_LABELS: Record<string, string> = {
    not_submitted: "Nog niet ingeleverd",
    in_progress: "In behandeling",
    done: "Afgerond",
  };
  const STATUS_TONES: Record<string, string> = {
    not_submitted: "bg-warning-50 text-warning-700 border-warning-200",
    in_progress: "bg-brand-50 text-brand-700 border-brand-200",
    done: "bg-success-50 text-success-700 border-success-200",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-ink-700">Jaar</label>
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="input w-28 tabular-nums" />
      </div>
      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6 text-ink-400" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {quarters.map((q) => (
            <div key={q.quarter} className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-ink-900">{q.quarter} {year}</h3>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_TONES[q.status]}`}>
                  {STATUS_LABELS[q.status]}
                </span>
              </div>
              <div className="space-y-1.5">
                {Object.entries(STATUS_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => handleUpdate(q.quarter, key)}
                    disabled={updating === q.quarter}
                    className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                      q.status === key ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-100"
                    }`}
                  >
                    <span>{label}</span>
                    {updating === q.quarter && <Spinner className="h-3.5 w-3.5" />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Shared file icon =====
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
