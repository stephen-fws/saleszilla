import { useState, useRef, useEffect, useCallback } from "react";
import { Search, Briefcase, Building2, User, Loader2 } from "lucide-react";
import { globalSearch } from "@/lib/api";
import type {
  GlobalSearchResults,
  GlobalSearchPotential,
  GlobalSearchAccount,
  GlobalSearchContact,
} from "@/types";

type NavigatePayload =
  | { type: "potential"; id: string }
  | { type: "account"; id: string }
  | { type: "contact"; accountId: string }
  | { type: "contact-potential"; potentialId: string };

interface GlobalSearchProps {
  onNavigate: (payload: NavigatePayload) => void;
}

function highlight(text: string, query: string) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-100 text-amber-900 rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

const TOTAL_ITEMS = (r: GlobalSearchResults) =>
  r.potentials.length + r.accounts.length + r.contacts.length;

export default function GlobalSearch({ onNavigate }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults(null); setOpen(false); return; }
    setLoading(true);
    try {
      const data = await globalSearch(q);
      setResults(data);
      setOpen(true);
      setCursor(-1);
    } catch {
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 300);
  }

  // Flatten all results for keyboard nav
  function flatItems(): NavigatePayload[] {
    if (!results) return [];
    const items: NavigatePayload[] = [];
    results.potentials.forEach((p) => items.push({ type: "potential", id: p.id }));
    results.accounts.forEach((a) => items.push({ type: "account", id: a.id }));
    results.contacts.forEach((c) => {
      if (c.accountId) items.push({ type: "contact", accountId: c.accountId });
      else if (c.potentialId) items.push({ type: "contact-potential", potentialId: c.potentialId });
    });
    return items;
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const items = flatItems();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && cursor >= 0 && items[cursor]) {
      e.preventDefault();
      handleSelect(items[cursor]);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  function handleSelect(payload: NavigatePayload) {
    setOpen(false);
    setQuery("");
    setResults(null);
    onNavigate(payload);
  }

  function getPotentialPayload(p: GlobalSearchPotential): NavigatePayload {
    return { type: "potential", id: p.id };
  }
  function getAccountPayload(a: GlobalSearchAccount): NavigatePayload {
    return { type: "account", id: a.id };
  }
  function getContactPayload(c: GlobalSearchContact): NavigatePayload {
    if (c.accountId) return { type: "contact", accountId: c.accountId };
    if (c.potentialId) return { type: "contact-potential", potentialId: c.potentialId };
    return { type: "contact", accountId: "" }; // fallback
  }

  // Compute flat index for cursor highlight
  let flatIdx = -1;
  function nextIdx() { return ++flatIdx; }

  const hasResults = results && TOTAL_ITEMS(results) > 0;

  return (
    <div ref={containerRef} className="relative flex-1 max-w-sm">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 animate-spin" />
        )}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results && TOTAL_ITEMS(results) > 0) setOpen(true); }}
          placeholder="Search potentials, accounts, contacts…"
          className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-8 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 transition-colors"
        />
      </div>

      {open && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
          {!hasResults ? (
            <p className="px-4 py-3 text-xs text-slate-400 text-center">No results for "{query}"</p>
          ) : (
            <div className="max-h-80 overflow-y-auto scrollbar-thin py-1">
              {/* Potentials */}
              {results!.potentials.length > 0 && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                    Potentials
                  </p>
                  {results!.potentials.map((p) => {
                    const idx = nextIdx();
                    return (
                      <button
                        key={p.id}
                        onClick={() => handleSelect(getPotentialPayload(p))}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${cursor === idx ? "bg-blue-50" : "hover:bg-slate-50"}`}
                      >
                        <Briefcase className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-slate-800 truncate">
                            {highlight(p.label, query)}
                          </p>
                          {p.sublabel && (
                            <p className="text-[10px] text-slate-400 truncate">{highlight(p.sublabel, query)}</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Accounts */}
              {results!.accounts.length > 0 && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                    Accounts
                  </p>
                  {results!.accounts.map((a) => {
                    const idx = nextIdx();
                    return (
                      <button
                        key={a.id}
                        onClick={() => handleSelect(getAccountPayload(a))}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${cursor === idx ? "bg-blue-50" : "hover:bg-slate-50"}`}
                      >
                        <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-slate-800 truncate">
                            {highlight(a.label, query)}
                          </p>
                          {a.sublabel && (
                            <p className="text-[10px] text-slate-400 truncate">{a.sublabel}</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Contacts */}
              {results!.contacts.length > 0 && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                    Contacts
                  </p>
                  {results!.contacts.map((c) => {
                    const idx = nextIdx();
                    const navigable = !!(c.accountId || c.potentialId);
                    return (
                      <button
                        key={c.id}
                        onClick={() => navigable && handleSelect(getContactPayload(c))}
                        disabled={!navigable}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors disabled:opacity-40 ${cursor === idx ? "bg-blue-50" : "hover:bg-slate-50"}`}
                      >
                        <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-slate-800 truncate">
                            {highlight(c.label, query)}
                          </p>
                          {c.sublabel && (
                            <p className="text-[10px] text-slate-400 truncate">{highlight(c.sublabel, query)}</p>
                          )}
                        </div>
                        {!c.accountId && !c.potentialId && (
                          <span className="text-[9px] text-slate-300 shrink-0">No account</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
