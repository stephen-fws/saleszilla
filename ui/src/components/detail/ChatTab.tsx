import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Loader2, Trash2, Bot, User, AlertCircle, Square, Pencil, Globe, Calendar } from "lucide-react";
import { getChatHistory, clearChatHistory, getChatSuggestions } from "@/lib/api";
import type { ChatMessage } from "@/lib/api";
import { tokenStore } from "@/lib/tokenStore";
import MarkdownBlock from "@/components/chat/MarkdownBlock";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  isStreaming,
  isEditing,
  onEdit,
}: {
  msg: ChatMessage;
  isStreaming?: boolean;
  isEditing?: boolean;
  onEdit?: () => void;
}) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-2.5 group ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${isUser ? "bg-slate-300" : "bg-slate-700"}`}>
        {isUser
          ? <User className="h-3 w-3 text-slate-600" />
          : <Bot className="h-3 w-3 text-white" />}
      </div>
      {/* Bubble + edit button */}
      <div className={`flex items-start gap-1.5 max-w-[80%] min-w-0 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
        <div className={`rounded-xl px-3.5 py-2.5 min-w-0 max-w-full overflow-hidden ${
          isUser
            ? `bg-slate-100 border border-slate-200 text-slate-800 rounded-tr-sm ${isEditing ? "ring-2 ring-offset-1 ring-blue-300 opacity-60" : ""}`
            : "bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm"
        }`}>
          {isUser ? (
            <p className="text-sm leading-normal whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <MarkdownBlock content={msg.content} compact />
          )}
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-slate-500 rounded-sm animate-pulse ml-0.5 align-middle" />
          )}
        </div>
        {isUser && onEdit && !isStreaming && (
          <button
            onClick={onEdit}
            title="Edit and resend"
            className="mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 rounded-md text-slate-400 hover:text-blue-500 hover:bg-slate-100"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ChatTabProps {
  dealId: string;
}

export default function ChatTab({ dealId }: ChatTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [isSearchingWeb, setIsSearchingWeb] = useState(false);
  // Client-side tool currently executing (e.g. list_meetings). Cleared as
  // soon as text starts streaming back from the model.
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [editFromIndex, setEditFromIndex] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load history on mount / deal change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setSuggestions([]);
    setError(null);
    setEditFromIndex(null);
    getChatHistory(dealId)
      .then((msgs) => {
        if (!cancelled) {
          setMessages(msgs);
          // Only fetch suggestions if there's no history
          if (msgs.length === 0) {
            setLoadingSuggestions(true);
            getChatSuggestions(dealId)
              .then((qs) => { if (!cancelled) setSuggestions(qs); })
              .catch(() => {})
              .finally(() => { if (!cancelled) setLoadingSuggestions(false); });
          }
        }
      })
      .catch(() => { if (!cancelled) setError("Failed to load chat history"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dealId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);
    setError(null);

    // If editing, truncate messages from that index
    if (editFromIndex !== null) {
      setMessages((prev) => prev.slice(0, editFromIndex));
      setEditFromIndex(null);
    }

    // Optimistically add user message
    const tempUserMsg: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: text,
      createdTime: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    // Stream assistant response
    const token = tokenStore.getAccessToken();
    abortRef.current = new AbortController();

    try {
      const res = await fetch(`${API_BASE}/potentials/${dealId}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: text }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "searching") {
              setIsSearchingWeb(true);
            } else if (data.type === "tool") {
              // Client-side tool started (e.g. list_meetings). Show an
              // indicator until text starts arriving.
              setRunningTool(data.name ?? "tool");
            } else if (data.type === "text") {
              setIsSearchingWeb(false);
              setRunningTool(null);
              accumulated += data.content;
              setStreamingContent(accumulated);
            } else if (data.type === "done") {
              // Commit the streamed message
              const assistantMsg: ChatMessage = {
                id: data.message_id,
                role: "assistant",
                content: accumulated,
                createdTime: new Date().toISOString(),
              };
              setMessages((prev) => [...prev, assistantMsg]);
              setStreamingContent("");
              accumulated = "";
            } else if (data.type === "error") {
              throw new Error(data.message);
            }
          } catch (parseErr) {
            // Skip malformed SSE lines
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") {
        setStreamingContent("");
      } else {
        setError("Failed to get response. Please try again.");
        setStreamingContent("");
      }
    } finally {
      setSending(false);
      setIsSearchingWeb(false);
      setRunningTool(null);
      inputRef.current?.focus();
    }
  }, [input, sending, dealId]);

  async function handleClear() {
    if (!confirm("Clear all chat history for this potential?")) return;
    await clearChatHistory(dealId);
    setMessages([]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const isStreaming = !!streamingContent;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 shrink-0">
        <div className="flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">AI Assistant</span>
          <span className="text-[10px] text-slate-300">· context-aware</span>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-red-500 transition-colors"
            title="Clear chat history"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
          </div>
        ) : messages.length === 0 && !isStreaming ? (
          <div className="flex flex-col items-center justify-center h-full px-5 py-6">
            <div className="w-11 h-11 rounded-full bg-violet-100 flex items-center justify-center mb-3">
              <Bot className="h-5 w-5 text-violet-500" />
            </div>
            <p className="text-sm font-semibold text-slate-700 mb-1">Your AI potential co-pilot is ready</p>
            <p className="text-xs text-slate-400 text-center mb-5">I know this potential inside out — the contact, account, notes, emails, and every AI insight. What would you like to tackle?</p>
            {loadingSuggestions ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                Setting up your conversation…
              </div>
            ) : suggestions.length > 0 ? (
              <div className="flex flex-col gap-2 w-full max-w-xs">
                {suggestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 0); }}
                    className="text-left text-xs text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg px-3 py-2 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                isEditing={editFromIndex === idx}
                onEdit={msg.role === "user" && !sending ? () => {
                  setInput(msg.content);
                  setEditFromIndex(idx);
                  setTimeout(() => inputRef.current?.focus(), 0);
                } : undefined}
              />
            ))}
            {sending && !streamingContent && !isSearchingWeb && !runningTool && (
              <div className="flex gap-2.5">
                <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="h-3 w-3 text-white" />
                </div>
                <div className="bg-slate-100 rounded-xl rounded-tl-sm px-4 py-3 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
            {isSearchingWeb && (
              <div className="flex items-center gap-1.5 text-[11px] text-violet-500 px-1">
                <Globe className="h-3 w-3 animate-pulse" />
                Searching the web…
              </div>
            )}
            {runningTool && (() => {
              // Per-tool label/icon. Add cases here as new client-side tools land.
              const toolMeta: Record<string, { label: string; Icon: typeof Loader2 }> = {
                list_meetings: { label: "Looking up your meetings…", Icon: Calendar },
              };
              const meta = toolMeta[runningTool] ?? { label: `Running ${runningTool}…`, Icon: Loader2 };
              const Icon = meta.Icon;
              return (
                <div className="flex items-center gap-1.5 text-[11px] text-violet-500 px-1">
                  <Icon className="h-3 w-3 animate-pulse" />
                  {meta.label}
                </div>
              );
            })()}
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

      {/* Input */}
      <div className="shrink-0 border-t border-slate-200 px-3 py-2.5">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this potential… (Enter to send, Shift+Enter for newline)"
            rows={1}
            disabled={loading || sending || loadingSuggestions}
            className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:bg-white transition-colors disabled:opacity-50 max-h-32 overflow-y-auto"
            style={{ minHeight: "38px" }}
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = `${Math.min(t.scrollHeight, 128)}px`;
            }}
          />
          {sending ? (
            <button
              onClick={() => abortRef.current?.abort()}
              className="shrink-0 flex items-center justify-center w-9 h-9 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors"
              title="Stop generating"
            >
              <Square className="h-4 w-4 fill-white" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading || loadingSuggestions}
              className="shrink-0 flex items-center justify-center w-9 h-9 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="text-[9px] text-slate-300 mt-1 px-1">Context: potential · contact · account · notes · todos · emails · AI insights</p>
      </div>
    </div>
  );
}
