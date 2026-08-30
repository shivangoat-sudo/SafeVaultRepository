import { useState, useEffect } from "react";
import { Download, FileText } from "lucide-react";
import { Modal } from "./Modal";
import { Spinner, EmptyState, CsvViewer } from "./ui";
import { useToast } from "./Toast";
import { api } from "../api";

export type NoteAttachmentTarget = {
  filePath: string;
  fileName?: string;
  fileSize?: number;
} | null;

export function NoteAttachmentModal({
  attachment,
  onClose,
}: {
  attachment: NoteAttachmentTarget;
  onClose: () => void;
}) {
  const { push } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (!attachment) {
      setUrl(null);
      setError(false);
      setImgError(false);
      return;
    }
    setLoading(true);
    setError(false);
    setImgError(false);
    setUrl(null);

    api.dossierNoteAttachmentView(attachment.filePath)
      .then((res) => {
        setUrl(res.url);
      })
      .catch(() => {
        setError(true);
        push("error", "Bijlage kon niet worden geladen.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [attachment, push]);

  if (!attachment) return null;

  const fileName = attachment.fileName || "Bijlage";
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const isKnownNonImage = ["pdf", "csv", "txt", "xlsx", "docx", "zip"].includes(ext);
  const isPdf = ext === "pdf";
  const isCsvOrTxt = ["csv", "txt"].includes(ext);

  const handleDownload = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <Modal
      open={!!attachment}
      onClose={onClose}
      title={fileName}
      size="xl"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Sluiten
          </button>
          {url && (
            <button onClick={handleDownload} className="btn-primary flex items-center gap-1.5">
              <Download className="h-4 w-4" /> Downloaden
            </button>
          )}
        </>
      }
    >
      <div className="min-h-[50vh] max-h-[75vh] flex items-center justify-center bg-ink-50 rounded-xl overflow-hidden p-3 border border-ink-100">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Spinner className="h-8 w-8 text-brand-600" />
            <p className="text-xs text-ink-500 font-medium">Afbeelding laden...</p>
          </div>
        ) : error ? (
          <EmptyState icon={FileText} title="Bijlage kon niet worden geladen" subtitle="Probeer het later opnieuw." />
        ) : url && isPdf ? (
          <iframe src={url} className="w-full h-[70vh] rounded-lg border-0" title={fileName} />
        ) : url && isCsvOrTxt ? (
          <CsvViewer url={url} fileName={fileName} />
        ) : url && !isKnownNonImage && !imgError ? (
          <div className="w-full h-full flex items-center justify-center overflow-auto p-2">
            <img
              src={url}
              alt={fileName}
              onError={() => setImgError(true)}
              className="max-h-[70vh] max-w-full object-contain rounded-lg shadow-sm border border-ink-200/60 bg-white"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <EmptyState
              icon={FileText}
              title="Geen voorbeeld beschikbaar"
              subtitle="Gebruik de knop hieronder om het bestand te downloaden."
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
