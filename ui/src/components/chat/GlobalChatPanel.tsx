/**
 * GlobalChatPanel — full-screen overlay for cross-entity AI chat.
 *
 * Talks to /chat/global endpoints. Streams Claude responses with multi-turn
 * tool use. Shows tool indicators (e.g. "Searching potentials…") when Claude
 * calls a CRM query tool.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Send, Loader2, Trash2, User, AlertCircle, Square, Sparkles, X,
  Search, Briefcase, Building2, Users, BarChart3, DollarSign, Clock, Layers, MessageSquare,
  Copy, Check, Download, Plus, MessageCircle, Paperclip, FileText, FileSpreadsheet, FileCode, File as FileIcon,
} from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  listGlobalConversations,
  createGlobalConversation,
  deleteGlobalConversation,
  getGlobalConversationMessages,
} from "@/lib/api";
import type { ChatMessage, GlobalChatConversation } from "@/lib/api";
import { tokenStore } from "@/lib/tokenStore";
import MarkdownBlock from "@/components/chat/MarkdownBlock";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

// ── Suggested starter questions ──────────────────────────────────────────────

const STARTERS: { icon: typeof Briefcase; label: string; question: string }[] = [
  { icon: DollarSign, label: "Revenue", question: "What's the total expected revenue of my pipeline this quarter?" },
  { icon: Clock, label: "Closing soon", question: "Which potentials are closing in the next 7 days?" },
  { icon: BarChart3, label: "Pipeline by stage", question: "Show me the breakdown of my pipeline by stage." },
  { icon: Layers, label: "Stale deals", question: "Which of my deals have had no activity in the last 14 days?" },
  { icon: Briefcase, label: "Hot deals", question: "List my Diamond and Platinum potentials with their stages and amounts." },
  { icon: Building2, label: "Top accounts", question: "Which accounts have the most open potentials right now?" },
];

// ── Tool name → friendly indicator label ─────────────────────────────────────

const TOOL_LABELS: Record<string, { label: string; icon: typeof Search }> = {
  search_potentials: { label: "Searching potentials…", icon: Briefcase },
  get_potential_details: { label: "Loading deal details…", icon: Briefcase },
  get_potential_full_context: { label: "Loading full deal context…", icon: Briefcase },
  search_accounts: { label: "Searching accounts…", icon: Building2 },
  get_account_360: { label: "Loading 360° view…", icon: Building2 },
  search_contacts: { label: "Searching contacts…", icon: Users },
  get_contact_details: { label: "Loading contact…", icon: Users },
  pipeline_summary: { label: "Calculating pipeline summary…", icon: BarChart3 },
  revenue_summary: { label: "Calculating revenue…", icon: DollarSign },
  time_based_query: { label: "Running time query…", icon: Clock },
  recent_activity: { label: "Checking recent activity…", icon: Clock },
  list_owners: { label: "Looking up owners…", icon: Users },
};

// ── Follow-up parsing ────────────────────────────────────────────────────────

function parseFollowups(content: string): { display: string; followups: string[] | null } {
  // Complete tag
  const match = content.match(/<followups>\s*([\s\S]*?)\s*<\/followups>/);
  if (match) {
    const display = (content.slice(0, match.index!) + content.slice(match.index! + match[0].length)).trim();
    try {
      const arr = JSON.parse(match[1]);
      if (Array.isArray(arr)) return { display, followups: arr.map(String).slice(0, 5) };
    } catch {
      // Fall through
    }
    return { display, followups: null };
  }
  // Partial tag while streaming — hide everything from `<followups` onward
  const partialIdx = content.indexOf("<followups");
  if (partialIdx !== -1) {
    return { display: content.slice(0, partialIdx).trimEnd(), followups: null };
  }
  return { display: content, followups: null };
}

// ── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  isStreaming,
  onFollowup,
}: {
  msg: ChatMessage;
  isStreaming?: boolean;
  onFollowup?: (q: string) => void;
}) {
  const isUser = msg.role === "user";
  const { display, followups } = isUser
    ? { display: msg.content, followups: null }
    : parseFollowups(msg.content);

  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(display);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleDownload = () => {
    // Render the same MarkdownBlock to a static HTML string
    const innerHtml = renderToStaticMarkup(<MarkdownBlock content={display} />);

    const fullDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Salezilla AI Response</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-width: 780px;
    margin: 32px auto;
    padding: 24px;
    color: #1e293b;
    line-height: 1.55;
    font-size: 13px;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
    padding-bottom: 14px;
    border-bottom: 2px solid #1a73e8;
  }
  .header-icon {
    width: 32px; height: 32px;
    background: linear-gradient(135deg, #1a73e8, #1967d2);
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    color: white; font-size: 16px;
  }
  .header-title { font-size: 18px; font-weight: 700; color: #1967d2; }
  .header-meta { margin-left: auto; font-size: 11px; color: #64748b; text-align: right; }
  h1, h2, h3, h4, h5, h6 { color: #0f172a; margin: 18px 0 8px 0; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 11px; }
  th { background: #e2e8f0; padding: 6px 8px; text-align: left; border: 1px solid #cbd5e1; font-weight: 600; color: #334155; }
  td { padding: 6px 8px; border: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  ul, ol { padding-left: 22px; margin: 8px 0; }
  li { margin: 2px 0; }
  pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; overflow-x: auto; font-size: 11px; line-height: 1.4; }
  hr { border: 0; border-top: 1px solid #e2e8f0; margin: 16px 0; }
  strong { color: #0f172a; }
  p { margin: 6px 0; }
  .footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
  @media print {
    body { margin: 0; padding: 16px; }
    @page { margin: 16mm; }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="header-icon">✦</div>
    <div class="header-title">Salezilla AI</div>
    <div class="header-meta">${new Date().toLocaleString()}</div>
  </div>
  ${innerHtml}
  <div class="footer">Generated by Salezilla AI · ${new Date().toLocaleString()}</div>
</body>
</html>`;

    const popup = window.open("", "_blank", "width=900,height=720");
    if (!popup) {
      alert("Please allow popups for this site to download as PDF.");
      return;
    }
    popup.document.open();
    popup.document.write(fullDoc);
    popup.document.close();

    // Trigger print dialog after the document has rendered
    const triggerPrint = () => {
      popup.focus();
      popup.print();
    };
    if (popup.document.readyState === "complete") {
      setTimeout(triggerPrint, 200);
    } else {
      popup.onload = () => setTimeout(triggerPrint, 200);
    }
  };

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${isUser ? "bg-slate-300" : "bg-gradient-to-br from-blue-500 to-blue-600"}`}>
        {isUser ? <User className="h-3.5 w-3.5 text-slate-600" /> : <Sparkles className="h-3.5 w-3.5 text-white" />}
      </div>
      <div className={`flex flex-col gap-2 max-w-[75%] ${isUser ? "items-end" : "items-start"}`}>
        <div className={`rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-slate-100 border border-slate-200 text-slate-800 rounded-tr-sm"
            : "bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm"
        }`}>
          {isUser ? (
            <p className="text-sm leading-normal whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <MarkdownBlock content={display} />
          )}
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-blue-500 rounded-sm animate-pulse ml-0.5 align-middle" />
          )}
        </div>

        {/* Action toolbar — copy / download (assistant only, not while streaming) */}
        {!isUser && !isStreaming && display.trim() && (
          <div className="flex items-center gap-1 -mt-0.5 px-1">
            <button
              onClick={handleCopy}
              title={copied ? "Copied!" : "Copy to clipboard"}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-blue-600 transition-colors px-1.5 py-0.5 rounded"
            >
              {copied ? <Check className="h-3 w-3 text-blue-500" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={handleDownload}
              title="Save as PDF"
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-blue-600 transition-colors px-1.5 py-0.5 rounded"
            >
              <Download className="h-3 w-3" />
              PDF
            </button>
          </div>
        )}

        {/* Follow-up question chips (only on committed assistant messages) */}
        {!isUser && !isStreaming && followups && followups.length > 0 && onFollowup && (
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {followups.map((q) => (
              <button
                key={q}
                onClick={() => onFollowup(q)}
                className="text-left text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-full px-3 py-1.5 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const utc = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z";
  const diff = Date.now() - new Date(utc).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(utc).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Main panel ───────────────────────────────────────────────────────────────

interface GlobalChatPanelProps {
  onClose: () => void;
}

export default function GlobalChatPanel({ onClose }: GlobalChatPanelProps) {
  // Conversations
  const [conversations, setConversations] = useState<GlobalChatConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [convSearch, setConvSearch] = useState("");

  // Messages of the active conversation
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Composer
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load conversation list on mount, auto-select most recent (or create new if none)
  useEffect(() => {
    let cancelled = false;
    setLoadingConvs(true);
    listGlobalConversations()
      .then(async (convs) => {
        if (cancelled) return;
        setConversations(convs);
        if (convs.length > 0) {
          setActiveConvId(convs[0].id);
        } else {
          // No history → create a fresh one
          try {
            const fresh = await createGlobalConversation();
            if (!cancelled) {
              setConversations([fresh]);
              setActiveConvId(fresh.id);
            }
          } catch {
            if (!cancelled) setError("Failed to start a new chat");
          }
        }
      })
      .catch(() => { if (!cancelled) setError("Failed to load chat history"); })
      .finally(() => { if (!cancelled) setLoadingConvs(false); });
    return () => { cancelled = true; };
  }, []);

  // Load messages whenever active conversation changes
  useEffect(() => {
    if (activeConvId == null) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingMessages(true);
    setMessages([]);
    setStreamingContent("");
    setActiveTool(null);
    setError(null);
    getGlobalConversationMessages(activeConvId)
      .then((msgs) => { if (!cancelled) setMessages(msgs); })
      .catch(() => { if (!cancelled) setError("Failed to load conversation"); })
      .finally(() => { if (!cancelled) setLoadingMessages(false); });
    return () => { cancelled = true; };
  }, [activeConvId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, activeTool]);

  // ESC closes panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !sending) onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [sending, onClose]);

  const handleSend = useCallback(async (text?: string) => {
    const message = (text ?? input).trim();
    if ((!message && pendingFiles.length === 0) || sending || activeConvId == null) return;
    if (!message && pendingFiles.length > 0) {
      // Files without text — supply a default prompt
      // (not strictly needed; the backend accepts empty message + files)
    }

    setInput("");
    const filesForThisSend = pendingFiles;
    setPendingFiles([]);
    setSending(true);
    setError(null);
    setActiveTool(null);

    // Optimistic user message — show file references inline
    const fileLine = filesForThisSend.length > 0
      ? `\n\n📎 ${filesForThisSend.map((f) => f.name).join(", ")}`
      : "";
    const tempUserMsg: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: message + fileLine,
      createdTime: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    const token = tokenStore.getAccessToken();
    abortRef.current = new AbortController();

    try {
      let res: Response;
      if (filesForThisSend.length > 0) {
        // Multipart upload path
        const formData = new FormData();
        formData.append("message", message || "(no text — see attachments)");
        for (const f of filesForThisSend) formData.append("files", f, f.name);
        res = await fetch(`${API_BASE}/chat/global/conversations/${activeConvId}/upload`, {
          method: "POST",
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: formData,
          signal: abortRef.current.signal,
        });
      } else {
        res = await fetch(`${API_BASE}/chat/global/conversations/${activeConvId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ message }),
          signal: abortRef.current.signal,
        });
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "tool") {
              setActiveTool(data.name);
            } else if (data.type === "text") {
              setActiveTool(null);
              accumulated += data.content;
              setStreamingContent(accumulated);
            } else if (data.type === "done") {
              const assistantMsg: ChatMessage = {
                id: data.message_id ?? Date.now(),
                role: "assistant",
                content: accumulated,
                createdTime: new Date().toISOString(),
              };
              if (accumulated.trim()) {
                setMessages((prev) => [...prev, assistantMsg]);
              }
              setStreamingContent("");
              setActiveTool(null);
              accumulated = "";
            } else if (data.type === "title") {
              // Backend generated a title for this conversation
              setConversations((prev) =>
                prev.map((c) => (c.id === activeConvId ? { ...c, title: data.title } : c))
              );
            } else if (data.type === "error") {
              throw new Error(data.message);
            }
          } catch {
            // skip malformed
          }
        }
      }

      // Bump this conversation to the top of the list
      setConversations((prev) => {
        const updated = prev.map((c) =>
          c.id === activeConvId
            ? { ...c, updatedTime: new Date().toISOString(), lastMessageTime: new Date().toISOString(), messageCount: c.messageCount + 2 }
            : c
        );
        return [...updated].sort((a, b) => (b.updatedTime ?? "").localeCompare(a.updatedTime ?? ""));
      });
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") {
        setStreamingContent("");
      } else {
        setError("Failed to get response. Please try again.");
        setStreamingContent("");
      }
    } finally {
      setSending(false);
      setActiveTool(null);
      inputRef.current?.focus();
    }
  }, [input, sending, activeConvId, pendingFiles]);

  const handleNewChat = useCallback(async () => {
    if (sending) return;
    // If the current conversation is already empty (no messages), just stay on it
    const current = conversations.find((c) => c.id === activeConvId);
    if (current && current.messageCount === 0) {
      inputRef.current?.focus();
      return;
    }
    try {
      const fresh = await createGlobalConversation();
      setConversations((prev) => [fresh, ...prev]);
      setActiveConvId(fresh.id);
    } catch {
      setError("Failed to create new chat");
    }
  }, [sending, conversations, activeConvId]);

  const handleDeleteConversation = useCallback(async (id: number) => {
    if (!confirm("Delete this conversation?")) return;
    try {
      await deleteGlobalConversation(id);
      setConversations((prev) => {
        const remaining = prev.filter((c) => c.id !== id);
        // If we deleted the active one, switch to most recent (or create new)
        if (id === activeConvId) {
          if (remaining.length > 0) {
            setActiveConvId(remaining[0].id);
          } else {
            createGlobalConversation().then((fresh) => {
              setConversations([fresh]);
              setActiveConvId(fresh.id);
            });
          }
        }
        return remaining;
      });
    } catch {
      setError("Failed to delete conversation");
    }
  }, [activeConvId]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setPendingFiles((prev) => [...prev, ...files]);
    if (e.target) e.target.value = "";
  }

  function removePendingFile(idx: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function fileIconFor(name: string) {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "pdf") return FileText;
    if (["doc", "docx"].includes(ext)) return FileText;
    if (["xls", "xlsx", "csv", "tsv"].includes(ext)) return FileSpreadsheet;
    if (["py", "js", "ts", "tsx", "jsx", "html", "css", "json", "yml", "yaml", "xml", "sh", "sql"].includes(ext)) return FileCode;
    return FileIcon;
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  const isStreaming = !!streamingContent;
  const showEmpty = !loadingMessages && messages.length === 0 && !sending && !isStreaming;
  const toolMeta = activeTool ? TOOL_LABELS[activeTool] : null;
  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;

  const filteredConversations = convSearch.trim()
    ? conversations.filter((c) =>
        (c.title || "New chat").toLowerCase().includes(convSearch.trim().toLowerCase())
      )
    : conversations;

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              {activeConv?.title || "Salezilla AI"}
            </h2>
            <p className="text-[11px] text-slate-500">Ask anything across potentials, accounts & contacts</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          title="Close (Esc)"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Body — sidebar + main */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
          <div className="p-3 border-b border-slate-100 space-y-2">
            <button
              onClick={handleNewChat}
              disabled={sending}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white text-xs font-semibold px-3 py-2.5 hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              New chat
            </button>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={convSearch}
                onChange={(e) => setConvSearch(e.target.value)}
                placeholder="Search chats…"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-7 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:bg-white transition-colors"
              />
              {convSearch && (
                <button
                  onClick={() => setConvSearch("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
                  title="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
            {loadingConvs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
              </div>
            ) : conversations.length === 0 ? (
              <p className="text-[11px] text-slate-400 text-center py-8 px-2">No conversations yet</p>
            ) : filteredConversations.length === 0 ? (
              <p className="text-[11px] text-slate-400 text-center py-8 px-2">
                No matches for "<span className="font-medium text-slate-500">{convSearch}</span>"
              </p>
            ) : (
              <div className="space-y-0.5">
                <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider px-2 pt-1 pb-1.5">
                  {convSearch ? `${filteredConversations.length} match${filteredConversations.length !== 1 ? "es" : ""}` : "Recent"}
                </p>
                {filteredConversations.map((c) => {
                  const isActive = c.id === activeConvId;
                  const title = c.title || "New chat";
                  return (
                    <div
                      key={c.id}
                      className={`group relative rounded-lg cursor-pointer transition-colors ${
                        isActive
                          ? "bg-blue-50 border border-blue-200"
                          : "hover:bg-slate-50 border border-transparent"
                      }`}
                    >
                      <button
                        onClick={() => setActiveConvId(c.id)}
                        className="w-full text-left px-2.5 py-2 pr-7"
                      >
                        <div className="flex items-start gap-2">
                          <MessageCircle className={`h-3 w-3 mt-0.5 shrink-0 ${isActive ? "text-blue-600" : "text-slate-400"}`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-medium truncate ${isActive ? "text-blue-700" : "text-slate-700"}`}>
                              {title}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {relativeTime(c.lastMessageTime ?? c.updatedTime)}
                              {c.messageCount > 0 && ` · ${c.messageCount} msg${c.messageCount !== 1 ? "s" : ""}`}
                            </p>
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteConversation(c.id); }}
                        className="absolute top-1.5 right-1.5 p-1 rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all"
                        title="Delete conversation"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Main message area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <div className="max-w-3xl mx-auto px-6 py-6 space-y-5">
          {loadingMessages ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
            </div>
          ) : showEmpty ? (
            <div className="flex flex-col items-center justify-center text-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg mb-4">
                <Sparkles className="h-7 w-7 text-white" />
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">Hi, I'm Salezilla AI</h3>
              <p className="text-sm text-slate-500 max-w-md mb-8">
                I have full access to your CRM data — potentials, accounts, contacts, notes, emails, and AI insights.
                Ask me anything about your pipeline.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-2xl">
                {STARTERS.map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.question}
                      onClick={() => handleSend(s.question)}
                      className="text-left px-4 py-3 rounded-xl border border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50 transition-all group"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-100 group-hover:bg-blue-200 flex items-center justify-center shrink-0 transition-colors">
                          <Icon className="h-4 w-4 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider mb-0.5">{s.label}</p>
                          <p className="text-xs text-slate-700 leading-snug">{s.question}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} onFollowup={(q) => handleSend(q)} />
              ))}

              {/* Typing indicator (sending, before any text or tool fired) */}
              {sending && !streamingContent && !activeTool && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1 shadow-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}

              {/* Tool indicator pill */}
              {toolMeta && (
                <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-3 py-1.5 w-fit ml-10">
                  <toolMeta.icon className="h-3.5 w-3.5 animate-pulse" />
                  <span className="font-medium">{toolMeta.label}</span>
                </div>
              )}

              {/* Streaming response */}
              {isStreaming && (
                <MessageBubble
                  msg={{ id: -1, role: "assistant", content: streamingContent, createdTime: null }}
                  isStreaming
                />
              )}
            </>
          )}

              {error && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {error}
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>

          {/* Input — inside main column so it stays under messages */}
          <div className="shrink-0 border-t border-slate-200 bg-white">
            <div className="max-w-3xl mx-auto px-6 py-4">
              {/* Pending file chips */}
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {pendingFiles.map((f, i) => {
                    const Icon = fileIconFor(f.name);
                    return (
                      <div
                        key={`${f.name}-${i}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 pl-2 pr-1 py-1 text-[11px] text-slate-700"
                      >
                        <Icon className="h-3 w-3 text-blue-600 shrink-0" />
                        <span className="max-w-[180px] truncate font-medium">{f.name}</span>
                        <span className="text-slate-400">{formatBytes(f.size)}</span>
                        <button
                          onClick={() => removePendingFile(i)}
                          className="ml-0.5 p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600"
                          title="Remove file"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-end gap-2">
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,.md,.csv,.tsv,.json,.log,.py,.js,.ts,.tsx,.jsx,.html,.htm,.css,.sql,.yaml,.yml,.xml,.sh,.ini,.cfg,.toml"
                  className="hidden"
                  onChange={handleFilesPicked}
                />

                {/* Paperclip — attach files */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending || loadingMessages || activeConvId == null}
                  className="shrink-0 flex items-center justify-center w-11 h-11 rounded-xl border border-slate-300 bg-white text-slate-500 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  title="Attach files (PDF, DOCX, TXT, CSV, code…)"
                >
                  <Paperclip className="h-4 w-4" />
                </button>

                <div className="flex-1 relative">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about your pipeline, accounts, contacts… (Enter to send, Shift+Enter for newline)"
                    rows={1}
                    disabled={loadingMessages || sending || activeConvId == null}
                    className="w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 pr-12 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 transition-colors disabled:opacity-50 max-h-40 overflow-y-auto"
                    style={{ minHeight: "46px" }}
                    onInput={(e) => {
                      const t = e.currentTarget;
                      t.style.height = "auto";
                      t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
                    }}
                  />
                </div>
                {sending ? (
                  <button
                    onClick={() => abortRef.current?.abort()}
                    className="shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors shadow-sm"
                    title="Stop generating"
                  >
                    <Square className="h-4 w-4 fill-white" />
                  </button>
                ) : (
                  <button
                    onClick={() => handleSend()}
                    disabled={(!input.trim() && pendingFiles.length === 0) || loadingMessages || activeConvId == null}
                    className="shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p className="text-[10px] text-slate-400 mt-2 px-1 flex items-center gap-1.5">
                <MessageSquare className="h-2.5 w-2.5" />
                Salezilla AI uses live data from your CRM. Attach PDF, DOCX, TXT, CSV or code files. Esc to close.
              </p>
            </div>
          </div>
        </div>
        {/* /Main message area */}
      </div>
      {/* /Body */}
    </div>
  );
}
