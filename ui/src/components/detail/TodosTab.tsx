import { useState, useEffect, useCallback, useRef } from "react";
import {
  CheckSquare, Plus, Trash2, Loader2, Pencil, Check, X,
  Circle, Clock, PauseCircle, CheckCircle2, Sparkles,
} from "lucide-react";
import type { TodoItem, TodoStatus } from "@/types";
import { getTodos, addTodo, updateTodo, deleteTodo } from "@/lib/api";

interface TodosTabProps {
  dealId: string;
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  TodoStatus,
  { label: string; icon: typeof Circle; iconColor: string; badgeClass: string }
> = {
  pending:     { label: "Pending",     icon: Circle,       iconColor: "text-slate-400",  badgeClass: "bg-slate-100 text-slate-600" },
  in_progress: { label: "In Progress", icon: Clock,        iconColor: "text-blue-500",   badgeClass: "bg-blue-100 text-blue-700" },
  on_hold:     { label: "On Hold",     icon: PauseCircle,  iconColor: "text-amber-500",  badgeClass: "bg-amber-100 text-amber-700" },
  done:        { label: "Done",        icon: CheckCircle2, iconColor: "text-emerald-500", badgeClass: "bg-emerald-100 text-emerald-700" },
};

const STATUS_ORDER: TodoStatus[] = ["pending", "in_progress", "on_hold", "done"];

// ── Status picker popover ────────────────────────────────────────────────────

interface StatusPickerProps {
  current: TodoStatus;
  onChange: (s: TodoStatus) => void;
}

function StatusPicker({ current, onChange }: StatusPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const cfg = STATUS_CONFIG[current];
  const Icon = cfg.icon;

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Status: ${cfg.label}`}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors hover:opacity-80 ${cfg.badgeClass}`}
      >
        <Icon className="h-3 w-3" />
        {cfg.label}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 w-36 rounded-lg border border-slate-200 bg-white shadow-lg py-1">
          {STATUS_ORDER.map((s) => {
            const c = STATUS_CONFIG[s];
            const SIcon = c.icon;
            const isActive = s === current;
            return (
              <button
                key={s}
                onClick={() => { onChange(s); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-slate-50 ${isActive ? "font-semibold" : ""}`}
              >
                <SIcon className={`h-3.5 w-3.5 flex-shrink-0 ${c.iconColor}`} />
                {c.label}
                {isActive && <span className="ml-auto text-slate-400">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Todo card ────────────────────────────────────────────────────────────────

interface TodoCardProps {
  todo: TodoItem;
  dealId: string;
  onStatusChange: (id: number, status: TodoStatus) => void;
  onTextChange: (id: number, text: string) => void;
  onDelete: (id: number) => void;
}

function TodoCard({ todo, dealId, onStatusChange, onTextChange, onDelete }: TodoCardProps) {
  const [updating, setUpdating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(todo.text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleStatusChange = useCallback(async (newStatus: TodoStatus) => {
    if (newStatus === todo.status || updating) return;
    setUpdating(true);
    onStatusChange(todo.id, newStatus);
    try {
      await updateTodo(dealId, todo.id, { status: newStatus });
    } catch {
      onStatusChange(todo.id, todo.status);
    } finally {
      setUpdating(false);
    }
  }, [dealId, todo.id, todo.status, updating, onStatusChange]);

  const handleEditSave = useCallback(async () => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === todo.text) { setEditing(false); setEditText(todo.text); return; }
    setEditing(false);
    onTextChange(todo.id, trimmed);
    try {
      await updateTodo(dealId, todo.id, { text: trimmed });
    } catch {
      onTextChange(todo.id, todo.text);
      setEditText(todo.text);
    }
  }, [dealId, todo.id, todo.text, editText, onTextChange]);

  const handleEditCancel = () => { setEditing(false); setEditText(todo.text); };

  const isDone = todo.status === "done";

  // Backend stores naive UTC timestamps; append "Z" so Date() treats them as UTC.
  const createdLabel = todo.createdTime
    ? new Date(todo.createdTime.endsWith("Z") ? todo.createdTime : todo.createdTime + "Z")
        .toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className={`group flex items-start gap-2.5 rounded-lg px-3 py-2.5 border transition-colors ${
      isDone ? "border-slate-100 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-300"
    }`}>
      {/* Status picker */}
      <div className="flex-shrink-0 mt-0.5">
        {updating ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        ) : (
          <StatusPicker current={todo.status} onChange={handleStatusChange} />
        )}
      </div>

      {/* Text / edit input */}
      <div className="flex-1 min-w-0 pt-0.5">
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleEditSave(); if (e.key === "Escape") handleEditCancel(); }}
              className="flex-1 text-sm border border-blue-300 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <button onClick={handleEditSave} className="p-1 text-emerald-500 hover:bg-emerald-50 rounded" title="Save"><Check className="h-3.5 w-3.5" /></button>
            <button onClick={handleEditCancel} className="p-1 text-slate-400 hover:bg-slate-100 rounded" title="Cancel"><X className="h-3.5 w-3.5" /></button>
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-sm leading-snug ${isDone ? "text-slate-400 line-through" : "text-slate-700"}`}>
                {todo.text}
              </span>
              {todo.source === "agent" && (
                <span
                  title="Generated by AI from the email thread. Editing the text flips ownership to you and the agent will stop touching it."
                  className="inline-flex items-center gap-0.5 rounded-full bg-violet-50 border border-violet-200 px-1.5 py-0.5 text-[9px] font-medium text-violet-600"
                >
                  <Sparkles className="h-2.5 w-2.5" />
                  AI
                </span>
              )}
            </div>
            {createdLabel && (
              <span className="text-[10px] text-slate-400 mt-0.5">Created {createdLabel}</span>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      {!editing && (
        <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all mt-0.5">
          <button onClick={() => { setEditText(todo.text); setEditing(true); }} className="rounded p-1 text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition-colors" title="Edit">
            <Pencil className="h-3 w-3" />
          </button>
          <button onClick={() => onDelete(todo.id)} className="rounded p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Delete">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TodosTab({ dealId }: TodosTabProps) {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [newText, setNewText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    getTodos(dealId)
      .then(setTodos)
      .catch(() => setError("Failed to load todos"))
      .finally(() => setLoading(false));
  }, [dealId]);

  const handleAdd = useCallback(async () => {
    if (!newText.trim() || saving) return;
    setSaving(true);
    try {
      const todo = await addTodo(dealId, newText.trim());
      setTodos((prev) => [todo, ...prev]);
      setNewText("");
    } catch {
      setError("Failed to add item");
    } finally {
      setSaving(false);
    }
  }, [dealId, newText, saving]);

  const handleStatusChange = useCallback((id: number, status: TodoStatus) => {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, status, isCompleted: status === "done" } : t)));
  }, []);

  const handleTextChange = useCallback((id: number, text: string) => {
    // Editing an AI todo transfers ownership to the user (backend does the same
    // flip). Mirror that here so the AI chip disappears immediately.
    setTodos((prev) => prev.map((t) =>
      t.id === id
        ? { ...t, text, source: t.source === "agent" ? "user" : t.source }
        : t
    ));
  }, []);

  const handleDelete = useCallback(async (todoId: number) => {
    setTodos((prev) => prev.filter((t) => t.id !== todoId));
    try {
      await deleteTodo(dealId, todoId);
    } catch {
      // optimistic — ignore
    }
  }, [dealId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
  };

  const active = todos.filter((t) => t.status !== "done");
  const done = todos.filter((t) => t.status === "done");

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Add form */}
      <div className="p-4 border-b border-slate-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add an action item..."
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <button
            onClick={handleAdd}
            disabled={!newText.trim() || saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Add
          </button>
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : todos.length === 0 ? (
          <div className="text-center py-8">
            <CheckSquare className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400">No action items yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Active items */}
            {active.length > 0 && (
              <div className="space-y-2">
                {active.map((todo) => (
                  <TodoCard
                    key={todo.id}
                    todo={todo}
                    dealId={dealId}
                    onStatusChange={handleStatusChange}
                    onTextChange={handleTextChange}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}

            {/* Done items */}
            {done.length > 0 && (
              <div>
                <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-2">
                  Done ({done.length})
                </p>
                <div className="space-y-2">
                  {done.map((todo) => (
                    <TodoCard
                      key={todo.id}
                      todo={todo}
                      dealId={dealId}
                      onStatusChange={handleStatusChange}
                      onTextChange={handleTextChange}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
