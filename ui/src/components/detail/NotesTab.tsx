import { useState, useEffect, useCallback, useRef } from "react";
import { StickyNote, Plus, Trash2, Loader2, Pencil, Check, X } from "lucide-react";
import type { NoteItem } from "@/types";
import { getNotes, addNote, editNote, deleteNote } from "@/lib/api";

interface NotesTabProps {
  dealId: string;
}

function timeAgo(dateStr: string | null) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface NoteCardProps {
  note: NoteItem;
  dealId: string;
  onUpdate: (id: number, content: string) => void;
  onDelete: (id: number) => void;
}

function NoteCard({ note, dealId, onUpdate, onDelete }: NoteCardProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(note.content);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const startEdit = () => {
    setEditValue(note.content);
    setEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditValue(note.content);
  };

  const saveEdit = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === note.content) {
      cancelEdit();
      return;
    }
    setSaving(true);
    try {
      await editNote(dealId, note.id, trimmed);
      onUpdate(note.id, trimmed);
      setEditing(false);
    } catch {
      // keep editing open on error
    } finally {
      setSaving(false);
    }
  }, [dealId, note.id, note.content, editValue, onUpdate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit();
    if (e.key === "Escape") cancelEdit();
  };

  return (
    <div className="group rounded-lg border border-slate-200 p-3 hover:border-slate-300 transition-colors">
      {editing ? (
        <>
          <textarea
            ref={textareaRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            className="w-full rounded border border-blue-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
          />
          <div className="flex items-center justify-between mt-2">
            <p className="text-[10px] text-slate-400">Ctrl+Enter to save · Esc to cancel</p>
            <div className="flex items-center gap-1">
              <button
                onClick={cancelEdit}
                className="rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={saveEdit}
                disabled={!editValue.trim() || saving}
                className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Save
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{note.content}</p>
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-slate-400">{timeAgo(note.createdTime)}</span>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={startEdit}
                className="rounded p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                title="Edit note"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={() => onDelete(note.id)}
                className="rounded p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="Delete note"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function NotesTab({ dealId }: NotesTabProps) {
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [newNote, setNewNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    getNotes(dealId)
      .then(setNotes)
      .catch(() => setError("Failed to load notes"))
      .finally(() => setLoading(false));
  }, [dealId]);

  const handleAdd = useCallback(async () => {
    if (!newNote.trim() || saving) return;
    setSaving(true);
    try {
      const note = await addNote(dealId, newNote.trim());
      setNotes((prev) => [note, ...prev]);
      setNewNote("");
    } catch {
      setError("Failed to save note");
    } finally {
      setSaving(false);
    }
  }, [dealId, newNote, saving]);

  const handleUpdate = useCallback((id: number, content: string) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, content } : n)));
  }, []);

  const handleDelete = useCallback(async (noteId: number) => {
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
    try {
      await deleteNote(dealId, noteId);
    } catch {
      // optimistic — ignore error
    }
  }, [dealId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAdd();
  };

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Add note form */}
      <div className="p-4 border-b border-slate-200 flex-shrink-0">
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          placeholder="Write a note..."
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
        />
        <div className="flex items-center justify-between mt-2">
          <p className="text-[10px] text-slate-400">Ctrl+Enter to save</p>
          <button
            onClick={handleAdd}
            disabled={!newNote.trim() || saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Add Note
          </button>
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : notes.length === 0 ? (
          <div className="text-center py-8">
            <StickyNote className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400">No notes yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                dealId={dealId}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
