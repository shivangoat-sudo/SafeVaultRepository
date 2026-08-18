import { useState, useEffect, useCallback } from "react";
import { api } from "@/api";
import { useToast } from "@/components/Toast";
import { formatBytes, formatDateTime, Spinner, EmptyState } from "@/components/ui";
import type { ArchiveFolder, ArchiveFile } from "@/types";
import { Folder, FileText, Download, ChevronRight, Home } from "lucide-react";

export function CustomerArchiveTab() {
  const { push } = useToast();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<ArchiveFolder[]>([]);
  const [folders, setFolders] = useState<ArchiveFolder[]>([]);
  const [files, setFiles] = useState<ArchiveFile[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.customerArchive(folderId);
      setFolders(res.folders);
      setFiles(res.files);
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Archief laden mislukt.");
    } finally {
      setLoading(false);
    }
  }, [folderId, push]);

  useEffect(() => { load(); }, [load]);

  const openFolder = (folder: ArchiveFolder) => {
    setBreadcrumbs(prev => [...prev, folder]);
    setFolderId(folder.id);
  };

  const goHome = () => {
    setBreadcrumbs([]);
    setFolderId(null);
  };

  const goUp = (index: number) => {
    const newCrumbs = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newCrumbs);
    setFolderId(newCrumbs[newCrumbs.length - 1].id);
  };

  const downloadFile = async (fileId: string) => {
    try {
      const res = await api.customerArchiveDownload(fileId);
      const a = document.createElement("a");
      a.href = res.url;
      a.download = res.name;
      a.click();
    } catch {
      push("error", "Downloaden mislukt.");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-medium text-ink-900">Archief</h2>
      </div>

      <div className="flex items-center gap-2 text-sm text-ink-600 bg-ink-50 px-4 py-3 rounded-lg border border-ink-100">
        <button onClick={goHome} className="hover:text-primary-600 transition-colors flex items-center gap-1">
          <Home className="h-4 w-4" /> Root
        </button>
        {breadcrumbs.map((crumb, idx) => (
          <div key={crumb.id} className="flex items-center gap-2">
            <ChevronRight className="h-4 w-4 text-ink-400" />
            <button onClick={() => goUp(idx)} className="hover:text-primary-600 transition-colors truncate max-w-[150px]">
              {crumb.name}
            </button>
          </div>
        ))}
      </div>

      <div className="card divide-y divide-ink-100">
        {loading ? (
          <div className="py-12 flex justify-center"><Spinner className="h-6 w-6 text-ink-400" /></div>
        ) : folders.length === 0 && files.length === 0 ? (
          <EmptyState icon={Folder} title="Lege map" subtitle="Er zijn hier nog geen bestanden of mappen." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-50 text-ink-500 font-medium">
                <tr>
                  <th className="px-4 py-3">Naam</th>
                  <th className="px-4 py-3">Grootte</th>
                  <th className="px-4 py-3">Toegevoegd</th>
                  <th className="px-4 py-3 text-right">Acties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {folders.map(f => (
                  <tr key={f.id} className="hover:bg-ink-50/50 transition-colors group">
                    <td className="px-4 py-3 flex items-center gap-3">
                      <Folder className="h-5 w-5 text-ink-400" />
                      <button onClick={() => openFolder(f)} className="font-medium text-ink-900 hover:text-primary-600">{f.name}</button>
                    </td>
                    <td className="px-4 py-3 text-ink-500">-</td>
                    <td className="px-4 py-3 text-ink-500">{formatDateTime(f.created_at)}</td>
                    <td className="px-4 py-3 text-right"></td>
                  </tr>
                ))}
                {files.map(f => (
                  <tr key={f.id} className="hover:bg-ink-50/50 transition-colors group">
                    <td className="px-4 py-3 flex items-center gap-3">
                      <FileText className="h-5 w-5 text-ink-400" />
                      <span className="text-ink-900 font-medium">{f.name}</span>
                    </td>
                    <td className="px-4 py-3 text-ink-500">{formatBytes(f.size_bytes)}</td>
                    <td className="px-4 py-3 text-ink-500">{formatDateTime(f.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => downloadFile(f.id)} className="p-2 text-ink-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors" title="Downloaden">
                        <Download className="h-4 w-4" />
                      </button>
                    </td>
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
