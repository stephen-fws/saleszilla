import { useState, useEffect, useCallback, useRef } from "react";
import {
  X, Plus, Building2, User, Briefcase, ChevronDown, ChevronRight,
  Loader2, Search, Check, AlertCircle,
} from "lucide-react";
import { createPotential, searchAccounts, searchContacts } from "@/lib/api";
import type { AccountSearchResult, ContactSearchResult } from "@/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGE_PROBABILITY: Record<string, number> = {
  "Prospects": 10, "Pre Qualified": 20, "Requirements Capture": 35,
  "Proposal": 50, "Contracting": 75, "Closed": 100,
  "Contact Later": 10, "Sleeping": 5, "Low Value": 10,
  "Disqualified": 0, "Lost": 0,
};

const SUB_SERVICES: Record<string, string[]> = {
  "Data Entry": ["Data Processing", "Data Conversion", "Back-office Processing", "Document Digitization"],
  "Finance & Accounting": ["Bookkeeping", "Accounts Payable", "Accounts Receivable", "Financial Reporting"],
  "Healthcare BPO": ["Claims Processing", "Medical Coding", "Revenue Cycle Management", "Patient Support"],
  "Customer Support": ["Inbound Support", "Outbound Support", "Omnichannel Support", "Multilingual Support", "Call Center Operations"],
  "IT Services": ["IT Helpdesk", "Infrastructure Management", "Cloud Services", "Cybersecurity"],
  "Digital Marketing": ["SEO", "PPC", "Social Media", "Content Marketing"],
  "Legal Process Outsourcing": ["Contract Review", "Paralegal Services", "Legal Research", "Compliance Support"],
  "Research & Analytics": ["Market Research", "Data Analytics", "Business Intelligence", "Competitive Analysis"],
};

const LEAD_SOURCES = ["Website", "Referral", "Cold Outreach", "Conference", "Partner", "LinkedIn", "Existing Client", "Other"];
const DEAL_TYPES = ["New Business", "Existing Business"];
const DEAL_SIZES = ["Small", "Medium", "Large", "Enterprise"];
const INDUSTRIES = [
  "Healthcare", "Financial Services", "Insurance", "Technology", "Retail",
  "Manufacturing", "Real Estate", "Education", "Government", "Telecom",
  "Banking", "Logistics", "Media", "Pharmaceuticals", "Energy", "Other",
];

// Comprehensive country list for agent payload (customerCountry)
const COUNTRIES = [
  "Australia", "Austria", "Bahrain", "Bangladesh", "Belgium", "Brazil",
  "Canada", "Chile", "China", "Colombia", "Czech Republic", "Denmark",
  "Egypt", "Finland", "France", "Germany", "Ghana", "Greece", "Hong Kong",
  "Hungary", "India", "Indonesia", "Ireland", "Israel", "Italy", "Japan",
  "Jordan", "Kenya", "Kuwait", "Malaysia", "Mexico", "Morocco", "Netherlands",
  "New Zealand", "Nigeria", "Norway", "Oman", "Pakistan", "Philippines",
  "Poland", "Portugal", "Qatar", "Romania", "Saudi Arabia", "Singapore",
  "South Africa", "South Korea", "Spain", "Sri Lanka", "Sweden", "Switzerland",
  "Taiwan", "Thailand", "Turkey", "UAE", "Uganda", "Ukraine",
  "United Kingdom", "United States", "Vietnam", "Other",
];


// ── Search combobox ───────────────────────────────────────────────────────────

interface ComboboxOption { id: string; primary: string; secondary?: string; }

function SearchCombobox({
  placeholder, selected, options, loading, query,
  onQueryChange, onSelect, onClear, onCreateNew, createLabel, error,
}: {
  placeholder: string;
  selected: ComboboxOption | null;
  options: ComboboxOption[];
  loading: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (opt: ComboboxOption) => void;
  onClear: () => void;
  onCreateNew: () => void;
  createLabel: string;
  error?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (selected) {
    return (
      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${error ? "border-red-300 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}>
        <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 truncate">{selected.primary}</p>
          {selected.secondary && <p className="text-[11px] text-slate-500 truncate">{selected.secondary}</p>}
        </div>
        <button type="button" onClick={onClear} className="p-0.5 rounded text-slate-400 hover:text-red-500 transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${error ? "border-red-300 bg-red-50 focus-within:ring-2 focus-within:ring-red-200" : "border-slate-200 bg-white focus-within:ring-2 focus-within:ring-blue-200"}`}>
        <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <input
          type="text" value={query}
          onChange={(e) => { onQueryChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="flex-1 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none bg-transparent"
        />
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 shrink-0" />}
      </div>
      {open && (query.length > 0 || options.length > 0) && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white rounded-lg border border-slate-200 shadow-lg overflow-hidden max-h-52 overflow-y-auto">
          {options.map((opt) => (
            <button key={opt.id} type="button"
              onClick={() => { onSelect(opt); setOpen(false); onQueryChange(""); }}
              className="w-full flex items-start gap-2 px-3 py-2 hover:bg-blue-50 transition-colors text-left">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-900 truncate">{opt.primary}</p>
                {opt.secondary && <p className="text-[11px] text-slate-500 truncate">{opt.secondary}</p>}
              </div>
            </button>
          ))}
          {options.length === 0 && query.length > 0 && !loading && (
            <p className="px-3 py-2 text-xs text-slate-400">No matches found</p>
          )}
          <button type="button" onClick={() => { onCreateNew(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 border-t border-slate-100 hover:bg-slate-50 transition-colors text-left">
            <Plus className="h-3.5 w-3.5 text-blue-500" />
            <span className="text-xs font-medium text-blue-600">{createLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface NewPotentialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (dealId: string) => void;
  availableStages?: string[];
  availableServices?: string[];
  subServiceMap?: Record<string, string[]>;
  industries?: string[];
}

export default function NewPotentialModal({
  isOpen, onClose, onCreated, availableStages, availableServices, subServiceMap, industries,
}: NewPotentialModalProps) {
  const stages = availableStages?.length ? availableStages : Object.keys(STAGE_PROBABILITY);
  const services = availableServices?.length ? availableServices : Object.keys(SUB_SERVICES);
  const subSvcMap = subServiceMap && Object.keys(subServiceMap).length ? subServiceMap : SUB_SERVICES;

  // ── Account ────────────────────────────────────────────────────────────────
  const [accountQuery, setAccountQuery] = useState("");
  const [accountOptions, setAccountOptions] = useState<AccountSearchResult[]>([]);
  const [accountLoading, setAccountLoading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<AccountSearchResult | null>(null);
  const [newAccount, setNewAccount] = useState(false);
  // New account fields
  const [accName, setAccName] = useState("");
  const [accIndustry, setAccIndustry] = useState("");
  const [accWebsite, setAccWebsite] = useState("");
  const [accCountry, setAccCountry] = useState("");
  // Supplemental fields for existing account (fill in missing agent-critical data)
  const [suppWebsite, setSuppWebsite] = useState("");
  const [suppCountry, setSuppCountry] = useState("");

  // ── Contact ────────────────────────────────────────────────────────────────
  const [contactQuery, setContactQuery] = useState("");
  const [contactOptions, setContactOptions] = useState<ContactSearchResult[]>([]);
  const [contactLoading, setContactLoading] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactSearchResult | null>(null);
  const [newContact, setNewContact] = useState(false);
  const [ctName, setCtName] = useState("");
  const [ctTitle, setCtTitle] = useState("");
  const [ctEmail, setCtEmail] = useState("");
  const [ctPhone, setCtPhone] = useState("");

  // ── Deal ───────────────────────────────────────────────────────────────────
  const [dealTitle, setDealTitle] = useState("");
  const [dealValue, setDealValue] = useState("");
  const defaultStage = stages.includes("Open") ? "Open" : (stages[0] ?? "Open");
  const [stage, setStage] = useState(defaultStage);
  const [probability, setProbability] = useState<number>(STAGE_PROBABILITY[defaultStage] ?? 20);
  const [service, setService] = useState("");
  const [subService, setSubService] = useState("");
  const [description, setDescription] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [dealType, setDealType] = useState("");
  const [dealSize, setDealSize] = useState("");
  const [closingDate, setClosingDate] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── UI ─────────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const accountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contactTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Missing agent fields on the selected existing account
  const existingMissingWebsite = selectedAccount && !selectedAccount.website;
  const existingMissingCountry = selectedAccount && !selectedAccount.country;
  const hasSupplementalFields = existingMissingWebsite || existingMissingCountry;

  // Reset on open
  useEffect(() => {
    if (!isOpen) return;
    setAccountQuery(""); setAccountOptions([]); setSelectedAccount(null); setNewAccount(false);
    setAccName(""); setAccIndustry(""); setAccWebsite(""); setAccCountry("");
    setSuppWebsite(""); setSuppCountry("");
    setContactQuery(""); setContactOptions([]); setSelectedContact(null); setNewContact(false);
    setCtName(""); setCtTitle(""); setCtEmail(""); setCtPhone("");
    setDealTitle(""); setDealValue("");
    const s0 = stages.includes("Open") ? "Open" : (stages[0] ?? "Open");
    setStage(s0); setProbability(STAGE_PROBABILITY[s0] ?? 20);
    setService(""); setSubService(""); setDescription("");
    setLeadSource(""); setDealType(""); setDealSize("");
    setClosingDate(""); setNextStep("");
    setShowAdvanced(false); setSaving(false); setError(null); setFieldErrors({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Auto-suggest deal title
  useEffect(() => {
    const company = selectedAccount?.name || accName;
    if (service && company && !dealTitle) setDealTitle(`${service} for ${company}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, selectedAccount, accName]);

  useEffect(() => { setSubService(""); }, [service]);
  useEffect(() => { setProbability(STAGE_PROBABILITY[stage] ?? 10); }, [stage]);

  // Reset supplemental fields when account changes
  useEffect(() => { setSuppWebsite(""); setSuppCountry(""); }, [selectedAccount]);

  // Debounced account search
  const handleAccountQuery = useCallback((q: string) => {
    setAccountQuery(q);
    if (accountTimerRef.current) clearTimeout(accountTimerRef.current);
    if (!q.trim()) { setAccountOptions([]); return; }
    accountTimerRef.current = setTimeout(async () => {
      setAccountLoading(true);
      try { setAccountOptions(await searchAccounts(q)); } catch { setAccountOptions([]); }
      finally { setAccountLoading(false); }
    }, 300);
  }, []);

  // Debounced contact search
  const handleContactQuery = useCallback((q: string) => {
    setContactQuery(q);
    if (contactTimerRef.current) clearTimeout(contactTimerRef.current);
    if (!q.trim()) { setContactOptions([]); return; }
    contactTimerRef.current = setTimeout(async () => {
      setContactLoading(true);
      try { setContactOptions(await searchContacts(q, selectedAccount?.id)); }
      catch { setContactOptions([]); }
      finally { setContactLoading(false); }
    }, 300);
  }, [selectedAccount]);

  function handleSelectAccount(opt: ComboboxOption) {
    const acc = accountOptions.find((a) => a.id === opt.id);
    if (acc) { setSelectedAccount(acc); setNewAccount(false); }
  }
  function handleSelectContact(opt: ComboboxOption) {
    const ct = contactOptions.find((c) => c.id === opt.id);
    if (ct) { setSelectedContact(ct); setNewContact(false); }
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errors: Record<string, boolean> = {};
    if (!selectedAccount && !newAccount) errors.account = true;
    if (newAccount && !accName.trim()) errors.accName = true;
    if (!selectedContact && !newContact) errors.contact = true;
    if (newContact && !ctName.trim()) errors.ctName = true;
    if (!dealTitle.trim()) errors.dealTitle = true;
    if (!dealValue || Number(dealValue) <= 0) errors.dealValue = true;
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!validate()) return;
    setSaving(true); setError(null);
    try {
      const payload: Parameters<typeof createPotential>[0] = {
        potential_name: dealTitle.trim(),
        amount: Number(dealValue),
        stage, probability,
        service: service || undefined,
        sub_service: subService || undefined,
        description: description.trim() || undefined,
        lead_source: leadSource || undefined,
        closing_date: closingDate || undefined,
        next_step: nextStep.trim() || undefined,
        deal_type: dealType || undefined,
        deal_size: dealSize || undefined,
      };

      if (selectedAccount) {
        payload.account_id = selectedAccount.id;
        // Pass supplemental data to fill in missing agent-critical fields
        const suppWebsiteTrimmed = suppWebsite.trim();
        const suppCountryVal = suppCountry;
        if (suppWebsiteTrimmed || suppCountryVal) {
          payload.company = {
            name: selectedAccount.name,
            website: suppWebsiteTrimmed || undefined,
            country: suppCountryVal || undefined,
          };
        }
      } else {
        payload.company = {
          name: accName.trim(),
          industry: accIndustry || undefined,
          website: accWebsite.trim() || undefined,
          country: accCountry || undefined,
        };
      }

      if (selectedContact) {
        payload.contact_id = selectedContact.id;
      } else {
        payload.contact = {
          name: ctName.trim(),
          title: ctTitle.trim() || undefined,
          email: ctEmail.trim() || undefined,
          phone: ctPhone.trim() || undefined,
        };
      }

      const result = await createPotential(payload);
      onCreated(result.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create potential");
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  const inputCls = (field: string) =>
    `w-full rounded-lg border ${fieldErrors[field] ? "border-red-300 bg-red-50 focus:ring-red-200" : "border-slate-200 bg-white focus:ring-blue-200"} px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2`;

  const selectCls = (field = "") =>
    `w-full rounded-lg border ${fieldErrors[field] ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"} px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200 appearance-none cursor-pointer`;

  const subServiceOptions = service ? (subSvcMap[service] ?? []) : [];

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white shrink-0">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              <span className="font-semibold text-sm">New Potential</span>
            </div>
            <button onClick={onClose} className="p-1 rounded-full hover:bg-white/20 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

{/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 scrollbar-thin">
            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}

            {/* ── Account ── */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Account / Company</span>
                  {fieldErrors.account && <span className="text-[10px] text-red-500 font-medium">Required</span>}
                </div>
                {!selectedAccount && (
                  <button type="button" onClick={() => { setNewAccount((v) => !v); setSelectedAccount(null); }}
                    className="text-[11px] font-medium text-blue-500 hover:text-blue-700 transition-colors">
                    {newAccount ? "Search existing" : "+ New account"}
                  </button>
                )}
              </div>

              {newAccount ? (
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-400 mb-1 block">Company Name *</label>
                    <input type="text" placeholder="e.g. Acme Corporation" value={accName}
                      onChange={(e) => { setAccName(e.target.value); setFieldErrors((p) => ({ ...p, accName: false })); }}
                      className={inputCls("accName")} />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-1 block">Website</label>
                    <input type="url" placeholder="https://company.com" value={accWebsite}
                      onChange={(e) => setAccWebsite(e.target.value)} className={inputCls("")} />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-1 block">Country</label>
                    <input list="country-list" placeholder="Select or type country" value={accCountry}
                      onChange={(e) => setAccCountry(e.target.value)} className={inputCls("")} />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-1 block">Industry</label>
                    <div className="relative">
                      <input
                        type="text"
                        list="industry-list"
                        value={accIndustry}
                        onChange={(e) => setAccIndustry(e.target.value)}
                        placeholder="Type to search…"
                        className={inputCls("")}
                      />
                      <datalist id="industry-list">
                        {(industries ?? INDUSTRIES).map((i) => <option key={i} value={i} />)}
                      </datalist>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <SearchCombobox
                    placeholder="Search by company name…"
                    selected={selectedAccount ? { id: selectedAccount.id, primary: selectedAccount.name, secondary: [selectedAccount.industry, selectedAccount.country].filter(Boolean).join(" · ") || undefined } : null}
                    options={accountOptions.map((a) => ({ id: a.id, primary: a.name, secondary: [a.industry, a.country, a.website].filter(Boolean).join(" · ") || undefined }))}
                    loading={accountLoading} query={accountQuery}
                    onQueryChange={handleAccountQuery} onSelect={handleSelectAccount}
                    onClear={() => { setSelectedAccount(null); setAccountQuery(""); setAccountOptions([]); }}
                    onCreateNew={() => setNewAccount(true)} createLabel="Create new account"
                    error={fieldErrors.account}
                  />
                  {/* Supplemental fields for existing account with missing agent data */}
                  {hasSupplementalFields && (
                    <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2.5">
                      <p className="text-[11px] text-amber-700">
                        Some fields are missing for this account. Add them now:
                      </p>
                      <div className="grid grid-cols-2 gap-2.5">
                        {existingMissingWebsite && (
                          <div>
                            <label className="text-[10px] text-slate-500 mb-1 block">Website</label>
                            <input type="url" placeholder="https://company.com" value={suppWebsite}
                              onChange={(e) => setSuppWebsite(e.target.value)} className={inputCls("")} />
                          </div>
                        )}
                        {existingMissingCountry && (
                          <div>
                            <label className="text-[10px] text-slate-500 mb-1 block">Country</label>
                            <input list="country-list" placeholder="Select or type country" value={suppCountry}
                              onChange={(e) => setSuppCountry(e.target.value)} className={inputCls("")} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Contact ── */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Contact Person</span>
                  {fieldErrors.contact && <span className="text-[10px] text-red-500 font-medium">Required</span>}
                  {selectedAccount && <span className="text-[10px] text-slate-400">· filtered by {selectedAccount.name}</span>}
                </div>
                {!selectedContact && (
                  <button type="button" onClick={() => { setNewContact((v) => !v); setSelectedContact(null); }}
                    className="text-[11px] font-medium text-blue-500 hover:text-blue-700 transition-colors">
                    {newContact ? "Search existing" : "+ New contact"}
                  </button>
                )}
              </div>

              {newContact ? (
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[10px] text-slate-400 mb-1 block">Full Name *</label>
                    <input type="text" placeholder="e.g. Jane Smith" value={ctName}
                      onChange={(e) => { setCtName(e.target.value); setFieldErrors((p) => ({ ...p, ctName: false })); }}
                      className={inputCls("ctName")} />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-1 block">Title / Role</label>
                    <input type="text" placeholder="e.g. CFO" value={ctTitle}
                      onChange={(e) => setCtTitle(e.target.value)} className={inputCls("")} />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-1 block">Email</label>
                    <input type="email" placeholder="jane@company.com" value={ctEmail}
                      onChange={(e) => setCtEmail(e.target.value)} className={inputCls("")} />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-1 block">Phone</label>
                    <input type="tel" placeholder="+1 555 000 0000" value={ctPhone}
                      onChange={(e) => setCtPhone(e.target.value)} className={inputCls("")} />
                  </div>
                </div>
              ) : (
                <SearchCombobox
                  placeholder={selectedAccount ? `Search contacts at ${selectedAccount.name}…` : "Search by name or email…"}
                  selected={selectedContact ? { id: selectedContact.id, primary: selectedContact.name, secondary: [selectedContact.title, selectedContact.email].filter(Boolean).join(" · ") || undefined } : null}
                  options={contactOptions.map((c) => ({ id: c.id, primary: c.name, secondary: [c.title, c.email, c.accountName].filter(Boolean).join(" · ") || undefined }))}
                  loading={contactLoading} query={contactQuery}
                  onQueryChange={handleContactQuery} onSelect={handleSelectContact}
                  onClear={() => { setSelectedContact(null); setContactQuery(""); setContactOptions([]); }}
                  onCreateNew={() => setNewContact(true)} createLabel="Create new contact"
                  error={fieldErrors.contact}
                />
              )}
            </div>

            {/* ── Deal ── */}
            <div>
              <div className="flex items-center gap-1.5 mb-2.5">
                <Briefcase className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Potential Details</span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="col-span-2">
                  <input type="text" placeholder="Potential Title *" value={dealTitle}
                    onChange={(e) => { setDealTitle(e.target.value); setFieldErrors((p) => ({ ...p, dealTitle: false })); }}
                    className={inputCls("dealTitle")} />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 mb-1 block">Potential Value *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                    <input type="number" min="0" placeholder="0" value={dealValue}
                      onChange={(e) => { setDealValue(e.target.value); setFieldErrors((p) => ({ ...p, dealValue: false })); }}
                      className={`${inputCls("dealValue")} pl-7`} />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 mb-1 block">Stage</label>
                  <div className="relative">
                    <select value={stage} onChange={(e) => setStage(e.target.value)} className={selectCls()}>
                      {stages.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 mb-1 block">Service Line</label>
                  <div className="relative">
                    <select value={service} onChange={(e) => setService(e.target.value)} className={selectCls()}>
                      <option value="">Select service…</option>
                      {services.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 mb-1 block">Sub-Service</label>
                  <div className="relative">
                    <select value={subService} onChange={(e) => setSubService(e.target.value)}
                      disabled={!service || subServiceOptions.length === 0}
                      className={`${selectCls()} ${(!service || subServiceOptions.length === 0) ? "opacity-50" : ""}`}>
                      <option value="">Select sub-service…</option>
                      {subServiceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Customer Requirements ── */}
            <div>
              <label className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-1.5 block">
                Customer Requirements
              </label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the customer's requirements, pain points, project scope, volumes, timelines…"
                rows={4}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-y" />
            </div>

            {/* ── More Details ── */}
            <div>
              <button type="button" onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors">
                {showAdvanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                More Details
              </button>
              {showAdvanced && (
                <div className="grid grid-cols-2 gap-2.5 mt-3">
                  <div>
                    <label className="text-[10px] text-slate-400 mb-1 block">Probability %</label>
                    <div className="relative">
                      <input type="number" min="0" max="100" value={probability}
                        onChange={(e) => setProbability(Math.min(100, Math.max(0, Number(e.target.value))))}
                        className={`${inputCls("")} pr-7`} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-1 block">Closing Date</label>
                    <input type="date" value={closingDate} onChange={(e) => setClosingDate(e.target.value)} className={inputCls("")} />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-1 block">Lead Source</label>
                    <div className="relative">
                      <select value={leadSource} onChange={(e) => setLeadSource(e.target.value)} className={selectCls()}>
                        <option value="">Lead Source</option>
                        {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-1 block">Potential Type</label>
                    <div className="relative">
                      <select value={dealType} onChange={(e) => setDealType(e.target.value)} className={selectCls()}>
                        <option value="">Potential Type</option>
                        {DEAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-1 block">Potential Size</label>
                    <div className="relative">
                      <select value={dealSize} onChange={(e) => setDealSize(e.target.value)} className={selectCls()}>
                        <option value="">Potential Size</option>
                        {DEAL_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-400 mb-1 block">Next Step</label>
                    <input type="text" placeholder="e.g. Schedule discovery call" value={nextStep}
                      onChange={(e) => setNextStep(e.target.value)} className={inputCls("")} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-3.5 border-t border-slate-100 bg-slate-50 shrink-0">
            <button onClick={onClose} disabled={saving}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm">
              {saving
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Creating…</>
                : <><Plus className="h-3.5 w-3.5" />Create Potential</>}
            </button>
          </div>
        </div>
      </div>

      {/* Country datalist */}
      <datalist id="country-list">
        {COUNTRIES.map((c) => <option key={c} value={c} />)}
      </datalist>
    </>
  );
}
