import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/api";
import { useToast } from "@/components/Toast";
import { Spinner, formatDateTime } from "@/components/ui";
import { Send, Paperclip, FileText, Download, X } from "lucide-react";
import type { Communication } from "@/types";

interface ChatInterfaceProps {
  customerId: string;
  customerName: string;
  currentUserRole: "customer" | "user" | "owner" | string;
}

export function ChatInterface({ customerId, customerName, currentUserRole }: ChatInterfaceProps) {
  const { push } = useToast();
  const [messages, setMessages] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isFirstLoadRef = useRef(true);
  const prevMessagesCountRef = useRef(0);

  // Load message history
  const loadMessages = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      let res;
      if (currentUserRole === "customer") {
        res = await api.customerCommunications();
      } else {
        res = await api.dossierCommunications(customerId);
      }
      // Sort oldest first for chat flow
      const sorted = [...res.communications].sort(
        (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
      );
      setMessages(sorted);
    } catch (err) {
      console.error("Failed to load chat history:", err);
      if (!isSilent) push("error", "Laden van chatgeschiedenis mislukt.");
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [customerId, currentUserRole, push]);

  // Set up polling for real-time message exchange
  useEffect(() => {
    loadMessages();
    const interval = setInterval(() => {
      loadMessages(true);
    }, 1500); // Poll every 1.5 seconds for snappy updates

    return () => clearInterval(interval);
  }, [loadMessages]);

  // Auto scroll to bottom
  const scrollToBottom = (behavior: "smooth" | "auto" = "smooth") => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior
      });
    }
  };

  useEffect(() => {
    // Reset first load when opening a different chat
    isFirstLoadRef.current = true;
    prevMessagesCountRef.current = 0;
  }, [customerId]);

  useEffect(() => {
    if (messages.length === 0) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    if (isFirstLoadRef.current) {
      scrollToBottom("auto");
      isFirstLoadRef.current = false;
    } else if (messages.length > prevMessagesCountRef.current) {
      // Only auto-scroll if the user is already near the bottom (within 200px)
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      if (isNearBottom) {
        scrollToBottom("smooth");
      }
    }
    prevMessagesCountRef.current = messages.length;
  }, [messages]);

  // Handle Send Message
  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() && !selectedFile) return;

    setSending(true);
    try {
      const form = new FormData();
      form.append("customerId", customerId);
      form.append("body", inputText.trim());
      form.append("subject", "Live Chat");
      if (selectedFile) {
        form.append("file", selectedFile);
      }

      await api.sendChatMessageMultipart(form);
      
      setInputText("");
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      
      // Snappy update
      await loadMessages(true);
      // Force scroll to bottom when current user sends a message
      setTimeout(() => scrollToBottom("smooth"), 50);
    } catch {
      push("error", "Versturen van bericht mislukt.");
    } finally {
      setSending(false);
    }
  };

  // Drag and Drop files
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
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  };

  // Helper to format file size
  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // File Download Handler
  const handleDownload = async (fileId: string) => {
    try {
      const res = await api.userFileDownload(fileId);
      window.open(res.url, "_blank");
    } catch {
      push("error", "Kan bestand niet downloaden.");
    }
  };

  // Parse custom attachment structure in messages
  const parseMessage = (body: string) => {
    const attachmentRegex = /📎\s*\[attachment:([^:]+):([^:]+):([^:]+):([^\]]+)\]/;
    const match = body.match(attachmentRegex);

    if (match) {
      const [fullMatch, fileId, name, sizeStr, mimeType] = match;
      const size = parseInt(sizeStr, 10);
      const textMessage = body.replace(fullMatch, "").trim();

      return {
        hasAttachment: true,
        attachment: { fileId, name, size, mimeType },
        text: textMessage
      };
    }

    return {
      hasAttachment: false,
      attachment: null,
      text: body
    };
  };

  return (
    <div 
      className={`flex flex-col h-[600px] border border-ink-200 rounded-xl bg-white shadow-sm overflow-hidden relative ${
        isDragOver ? "border-brand-500 bg-brand-50/10" : ""
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="bg-ink-50 px-4 py-3 border-b border-ink-150 flex items-center justify-between">
        <div>
          <h3 className="font-medium text-ink-900 text-sm">
            {currentUserRole === "customer" ? "Chat met Boekhouder" : `Berichten - ${customerName}`}
          </h3>
          <p className="text-xs text-ink-500">SafeVault Beveiligde Verbinding</p>
        </div>
        {currentUserRole !== "customer" && (
          <div className="text-xs bg-ink-200 text-ink-700 px-2 py-1 rounded">
            Klant ID: {customerId.slice(0, 8)}
          </div>
        )}
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-ink-50/20" ref={scrollContainerRef}>
        {loading ? (
          <div className="flex justify-center items-center h-full">
            <Spinner className="h-6 w-6 text-ink-400" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <div className="h-12 w-12 bg-ink-100 rounded-full flex items-center justify-center text-ink-400 mb-2">
              <Send className="h-5 w-5" />
            </div>
            <p className="font-medium text-ink-800 text-sm">Nog geen berichten</p>
            <p className="text-xs text-ink-500 max-w-[240px] mt-1">
              Start het gesprek door hieronder een bericht of bestand te sturen.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const parsed = parseMessage(msg.body);
            // Is this message sent by the customer?
            // In our system:
            // - For client portal, if recipient is "Boekhouder", user sent it (the customer).
            // - For bookkeeper portal, if recipient is "Klant", bookkeeper sent it.
            // Let's deduce sender from msg.recipient & current portal
            const isCustomerSender = msg.recipient === "Boekhouder";
            const isMe = currentUserRole === "customer" ? isCustomerSender : !isCustomerSender;

            return (
              <div
                key={msg.id}
                className={`flex flex-col max-w-[75%] ${isMe ? "ml-auto items-end" : "mr-auto items-start"}`}
              >
                {/* Sender Name bubble prefix */}
                <span className="text-[10px] text-ink-400 mb-1 px-1">
                  {isMe ? "U" : (isCustomerSender ? "Klant" : "Boekhouder")} • {formatDateTime(msg.sent_at)}
                </span>

                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm ${
                    isMe
                      ? "bg-brand-600 text-white rounded-tr-none shadow-sm"
                      : "bg-white text-ink-800 border border-ink-150 rounded-tl-none shadow-sm"
                  }`}
                >
                  {/* Attachment card rendering */}
                  {parsed.hasAttachment && parsed.attachment && (
                    <div 
                      className={`mb-2 flex items-center justify-between gap-4 p-3 rounded-xl border text-xs max-w-sm ${
                        isMe 
                          ? "bg-brand-700/50 border-brand-500/30 text-white" 
                          : "bg-ink-50 border-ink-200 text-ink-700"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-5 w-5 flex-shrink-0 opacity-85" />
                        <div className="min-w-0">
                          <p className="font-medium truncate" title={parsed.attachment.name}>
                            {parsed.attachment.name}
                          </p>
                          <p className={`text-[10px] ${isMe ? "text-brand-200" : "text-ink-400"}`}>
                            {formatSize(parsed.attachment.size)}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDownload(parsed.attachment!.fileId)}
                        className={`p-1.5 rounded-lg transition-colors hover:bg-black/10 flex-shrink-0`}
                        title="Bestand downloaden"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {parsed.text && (
                    <p className="whitespace-pre-wrap break-words leading-relaxed">{parsed.text}</p>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Drag Over Overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-brand-600/10 backdrop-blur-[1px] border-2 border-dashed border-brand-500 flex flex-col items-center justify-center p-6 z-10">
          <Paperclip className="h-10 w-10 text-brand-600 animate-bounce mb-2" />
          <p className="font-medium text-brand-900 text-sm">Sleep bestanden hierheen</p>
          <p className="text-xs text-brand-700 mt-1">Om direct te uploaden en te versturen</p>
        </div>
      )}

      {/* Selected File Preview Box */}
      {selectedFile && (
        <div className="bg-ink-50 px-4 py-2 border-t border-ink-150 flex items-center justify-between text-xs text-ink-700 animate-slide-up">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-ink-500 flex-shrink-0" />
            <span className="font-medium truncate max-w-[200px]">{selectedFile.name}</span>
            <span className="text-ink-400">({formatSize(selectedFile.size)})</span>
          </div>
          <button
            onClick={() => {
              setSelectedFile(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            className="p-1 hover:bg-ink-200 rounded-full text-ink-500 hover:text-ink-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Footer / Input form */}
      <form onSubmit={handleSend} className="bg-white p-3 border-t border-ink-150 flex items-center gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              setSelectedFile(e.target.files[0]);
            }
          }}
          className="hidden"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          className="p-2 text-ink-500 hover:text-ink-700 hover:bg-ink-50 rounded-lg flex-shrink-0 transition-colors"
          title="Bijlage toevoegen"
        >
          <Paperclip className="h-5 w-5" />
        </button>

        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={sending ? "Bezig met versturen..." : "Typ uw bericht hier..."}
          disabled={sending}
          className="flex-1 bg-ink-50 border border-ink-250 focus:border-brand-500 focus:bg-white rounded-lg px-3 py-2 text-sm focus:outline-none transition-colors"
        />

        <button
          type="submit"
          disabled={sending || (!inputText.trim() && !selectedFile)}
          className="p-2 bg-brand-600 hover:bg-brand-700 disabled:bg-ink-200 disabled:text-ink-400 text-white rounded-lg flex-shrink-0 transition-all flex items-center justify-center"
          title="Bericht verzenden"
        >
          {sending ? (
            <Spinner className="h-5 w-5 text-ink-400" />
          ) : (
            <Send className="h-5 w-5" />
          )}
        </button>
      </form>
    </div>
  );
}
