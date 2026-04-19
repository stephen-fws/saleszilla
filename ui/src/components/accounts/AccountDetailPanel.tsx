import { useEffect, useState } from "react";
import {
  Briefcase,
  Building2,
  Check,
  Clock,
  DollarSign,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  Pencil,
  Phone,
  User,
  Users,
  X,
} from "lucide-react";
import { getAccountDetail, updateAccount, updateContact } from "@/lib/api";
import type { UpdateAccountPayload, UpdateContactPayload } from "@/lib/api";
import type { AccountDetail, AccountDetailContact, AccountDetailPotential, AccountActivityItem } from "@/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  prospect: "bg-slate-100 text-slate-600",
  qualification: "bg-blue-100 text-blue-700",
  proposal: "bg-amber-100 text-amber-700",
  negotiation: "bg-purple-100 text-purple-700",
  "closed-won": "bg-emerald-100 text-emerald-700",
  "closed-lost": "bg-red-100 text-red-600",
};

function formatStage(stage: string): string {
  return stage.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function formatValue(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value}`;
}

function timeAgo(dateStr: string): string {
  const utc = dateStr.endsWith("Z") || dateStr.includes("+") ? dateStr : dateStr + "Z";
  const diff = Date.now() - new Date(utc).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Editable field ────────────────────────────────────────────────────────────

function EditableField({
  label,
  value,
  type = "text",
  onSave,
}: {
  label: string;
  value: string | number | null | undefined;
  type?: "text" | "number";
  onSave: (val: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const [saving, setSaving] = useState(false);

  async function commit() {
    if (draft === String(value ?? "")) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); setEditing(false); }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") { setDraft(String(value ?? "")); setEditing(false); }
  }

  if (editing) {
    return (
      <div className="py-0.5">
        <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-0.5">{label}</p>
        <div className="flex items-center gap-1">
          <input
            autoFocus
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKey}
            onBlur={commit}
            className="flex-1 rounded border border-blue-300 px-1 py-0.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-400 -mx-1"
          />
          {saving && <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />}
        </div>
      </div>
    );
  }

  return (
    <div className="py-0.5">
      <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-0.5">{label}</p>
      <p
        className="text-xs text-slate-700 cursor-text rounded px-1 -mx-1 py-0.5 hover:bg-slate-50 transition-colors"
        onClick={() => { setDraft(String(value ?? "")); setEditing(true); }}
      >
        {value != null && value !== "" ? String(value) : <span className="text-slate-300">—</span>}
      </p>
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

type AccountTab = "overview" | "contacts" | "potentials" | "activity";

function TabBar({
  active,
  onChange,
  contactCount,
  potentialCount,
}: {
  active: AccountTab;
  onChange: (t: AccountTab) => void;
  contactCount: number;
  potentialCount: number;
}) {
  const tabs: { id: AccountTab; label: string; count?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "contacts", label: "Contacts", count: contactCount },
    { id: "potentials", label: "Potentials", count: potentialCount },
    { id: "activity", label: "Activity" },
  ];
  return (
    <div className="flex items-center border-b border-slate-200 px-3 overflow-x-auto scrollbar-none shrink-0">
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`inline-flex items-center gap-1 px-2.5 py-2.5 text-xs font-medium transition-colors relative whitespace-nowrap ${
              isActive ? "text-blue-600" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                isActive ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
              }`}>
                {tab.count}
              </span>
            )}
            {isActive && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t" />}
          </button>
        );
      })}
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({
  account,
  onFieldSave,
}: {
  account: AccountDetail;
  onFieldSave: (field: keyof UpdateAccountPayload, value: string) => Promise<void>;
}) {
  const totalValue = account.potentials.reduce((s, p) => s + (p.value ?? 0), 0);
  const wonPotentials = account.potentials.filter((p) => p.stage === "closed-won");
  const wonValue = wonPotentials.reduce((s, p) => s + (p.value ?? 0), 0);

  return (
    <div className="p-4 space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-slate-50 p-3 text-center">
          <p className="text-lg font-bold text-slate-900">{account.potentials.length}</p>
          <p className="text-[10px] text-slate-500 uppercase font-medium">Potentials</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-center">
          <p className="text-lg font-bold text-emerald-600">{formatValue(totalValue)}</p>
          <p className="text-[10px] text-slate-500 uppercase font-medium">Pipeline</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-center">
          <p className="text-lg font-bold text-slate-900">{account.contacts.length}</p>
          <p className="text-[10px] text-slate-500 uppercase font-medium">Contacts</p>
        </div>
      </div>

      {wonValue > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-2">
          <Check className="h-4 w-4 text-emerald-600 shrink-0" />
          <span className="text-sm font-medium text-emerald-700">
            {formatValue(wonValue)} closed won ({wonPotentials.length} {wonPotentials.length === 1 ? "potential" : "potentials"})
          </span>
        </div>
      )}

      {/* Company info */}
      <div className="rounded-lg border border-slate-200 p-3">
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="h-4 w-4 text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Company Info</h3>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <div className="col-span-2">
            <EditableField label="Account Name *" value={account.name} onSave={(v) => onFieldSave("name", v)} />
          </div>
          <EditableField label="Phone *" value={account.phone} onSave={(v) => onFieldSave("phone", v)} />
          <EditableField label="Industry" value={account.industry} onSave={(v) => onFieldSave("industry", v)} />
          <EditableField label="Website" value={account.website} onSave={(v) => onFieldSave("website", v)} />
          <EditableField label="Employees" value={account.employees} type="number" onSave={(v) => onFieldSave("employees", v)} />
          <EditableField label="Revenue" value={account.revenue} type="number" onSave={(v) => onFieldSave("revenue", v)} />
          <EditableField label="Street *" value={account.billingStreet} onSave={(v) => onFieldSave("billing_street", v)} />
          <EditableField label="City *" value={account.billingCity} onSave={(v) => onFieldSave("billing_city", v)} />
          <EditableField label="State *" value={account.billingState} onSave={(v) => onFieldSave("billing_state", v)} />
          <EditableField label="Postal Code *" value={account.billingCode} onSave={(v) => onFieldSave("billing_code", v)} />
          <EditableField label="Country *" value={account.billingCountry} onSave={(v) => onFieldSave("billing_country", v)} />
        </div>

        {/* Website quick link */}
        {account.website && (
          <div className="mt-2 pt-2 border-t border-slate-100">
            <a
              href={account.website.startsWith("http") ? account.website : `https://${account.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open website
            </a>
          </div>
        )}

        <div className="mt-2 pt-2 border-t border-slate-100">
          <EditableField label="Description" value={account.description} onSave={(v) => onFieldSave("description", v)} />
        </div>
      </div>
    </div>
  );
}

// ── Contacts tab ──────────────────────────────────────────────────────────────

function ContactsTab({
  contacts,
  potentials,
  onContactFieldSave,
}: {
  contacts: AccountDetailContact[];
  potentials: AccountDetailPotential[];
  onContactFieldSave: (contactId: string, field: keyof UpdateContactPayload, value: string) => Promise<void>;
}) {
  if (contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <Users className="h-8 w-8 text-slate-300 mb-2" />
        <p className="text-sm text-slate-500">No contacts yet</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {contacts.map((contact) => {
        const contactPotentials = potentials.filter((p) => p.contact?.id === contact.id);
        return (
          <div key={contact.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-start gap-2.5 mb-3">
              <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <User className="h-4 w-4 text-slate-500" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{contact.name ?? "—"}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div className="col-span-2">
                <EditableField
                  label="Name *"
                  value={contact.name}
                  onSave={(v) => onContactFieldSave(contact.id, "name", v)}
                />
              </div>
              <EditableField
                label="Email *"
                value={contact.email}
                onSave={(v) => onContactFieldSave(contact.id, "email", v)}
              />
              <EditableField
                label="Phone *"
                value={contact.phone}
                onSave={(v) => onContactFieldSave(contact.id, "phone", v)}
              />
              <EditableField
                label="Title"
                value={contact.title}
                onSave={(v) => onContactFieldSave(contact.id, "title", v)}
              />
              <EditableField
                label="Department"
                value={contact.department}
                onSave={(v) => onContactFieldSave(contact.id, "department", v)}
              />
              <EditableField
                label="Mobile"
                value={contact.mobile}
                onSave={(v) => onContactFieldSave(contact.id, "mobile", v)}
              />
            </div>

            {/* Quick links */}
            {(contact.email || contact.phone || contact.mobile) && (
              <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                {contact.email && (
                  <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1 hover:text-blue-600">
                    <Mail className="h-3 w-3" />
                    Email
                  </a>
                )}
                {contact.phone && (
                  <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1 hover:text-blue-600">
                    <Phone className="h-3 w-3" />
                    {contact.phone}
                  </a>
                )}
                {contact.mobile && (
                  <a href={`tel:${contact.mobile}`} className="inline-flex items-center gap-1 hover:text-blue-600">
                    <Phone className="h-3 w-3" />
                    {contact.mobile}
                  </a>
                )}
              </div>
            )}

          </div>
        );
      })}
    </div>
  );
}

// ── Potentials tab ────────────────────────────────────────────────────────────

function PotentialsTab({
  potentials,
  onNavigate,
}: {
  potentials: AccountDetailPotential[];
  onNavigate: (id: string) => void;
}) {
  if (potentials.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <Briefcase className="h-8 w-8 text-slate-300 mb-2" />
        <p className="text-sm text-slate-500">No potentials yet</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2">
      {potentials.map((p) => (
        <button
          key={p.id}
          onClick={() => onNavigate(p.id)}
          className="w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-slate-900 truncate">{p.title ?? "Untitled"}</span>
            {p.value != null && (
              <span className="text-sm font-semibold text-emerald-600 shrink-0 ml-2">{formatValue(p.value)}</span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500 truncate">
              {p.contact?.name ?? ""}
              {p.contact?.title ? ` · ${p.contact.title}` : ""}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {p.stage && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STAGE_COLORS[p.stage] ?? "bg-slate-100 text-slate-600"}`}>
                  {formatStage(p.stage)}
                </span>
              )}
              {p.probability != null && (
                <span className="text-[10px] text-slate-400">{p.probability}%</span>
              )}
            </div>
          </div>
          {p.service && <p className="text-[10px] text-slate-400 mt-1">{p.service}</p>}
        </button>
      ))}
    </div>
  );
}

// ── Activity tab ──────────────────────────────────────────────────────────────

function ActivityTab({ activities }: { activities: AccountActivityItem[] }) {
  const ICONS: Record<string, typeof Clock> = {
    email_sent: Mail,
    email_received: Mail,
    call: Phone,
    meeting: Users,
    note: Briefcase,
    "deal-created": DollarSign,
  };

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <Clock className="h-8 w-8 text-slate-300 mb-2" />
        <p className="text-sm text-slate-500">No activity yet</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      {activities.map((a, i) => {
        const Icon = ICONS[a.activityType] ?? Clock;
        return (
          <div key={a.id} className="flex gap-3 pb-4">
            <div className="flex flex-col items-center">
              <div className="h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <Icon className="h-3.5 w-3.5 text-slate-500" />
              </div>
              {i < activities.length - 1 && <div className="w-px flex-1 bg-slate-200 mt-1" />}
            </div>
            <div className="flex-1 pt-0.5 min-w-0">
              <p className="text-xs text-slate-700">{a.description ?? a.activityType}</p>
              {a.createdTime && (
                <p className="text-[10px] text-slate-400 mt-0.5">{timeAgo(a.createdTime)}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface AccountDetailPanelProps {
  accountId: string;
  onPotentialNavigate: (dealId: string) => void;
}

export default function AccountDetailPanel({ accountId, onPotentialNavigate }: AccountDetailPanelProps) {
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<AccountTab>("overview");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAccount(null);
    setActiveTab("overview");
    getAccountDetail(accountId)
      .then((d) => { if (!cancelled) setAccount(d); })
      .catch(() => { if (!cancelled) setAccount(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId]);

  async function handleFieldSave(field: keyof UpdateAccountPayload, raw: string) {
    const payload: UpdateAccountPayload = {};
    if (field === "employees" || field === "revenue") {
      const n = parseFloat(raw);
      if (!isNaN(n)) (payload as Record<string, unknown>)[field] = n;
    } else {
      (payload as Record<string, unknown>)[field] = raw;
    }
    const updated = await updateAccount(accountId, payload);
    setAccount(updated);
  }

  async function handleContactFieldSave(contactId: string, field: keyof UpdateContactPayload, raw: string) {
    const payload: UpdateContactPayload = { [field]: raw };
    const updated = await updateContact(contactId, payload);
    setAccount((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        contacts: prev.contacts.map((c) => (c.id === contactId ? { ...c, ...updated } : c)),
      };
    });
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!account) return null;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">
      {/* Header */}
      <div className="shrink-0 border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
            <Building2 className="h-5 w-5 text-blue-600" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 truncate">{account.name ?? "—"}</h2>
            <p className="text-xs text-slate-500 truncate">{account.industry ?? ""}</p>
          </div>
        </div>
        {account.website && (
          <a
            href={account.website.startsWith("http") ? account.website : `https://${account.website}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
          >
            <Globe className="h-3.5 w-3.5" />
            Website
          </a>
        )}
      </div>

      <TabBar
        active={activeTab}
        onChange={setActiveTab}
        contactCount={account.contacts.length}
        potentialCount={account.potentials.length}
      />

      <div className="flex-1 overflow-y-auto">
        {activeTab === "overview" && <OverviewTab account={account} onFieldSave={handleFieldSave} />}
        {activeTab === "contacts" && <ContactsTab contacts={account.contacts} potentials={account.potentials} onContactFieldSave={handleContactFieldSave} />}
        {activeTab === "potentials" && <PotentialsTab potentials={account.potentials} onNavigate={onPotentialNavigate} />}
        {activeTab === "activity" && <ActivityTab activities={account.activities} />}
      </div>
    </div>
  );
}
