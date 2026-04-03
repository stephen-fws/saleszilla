import { useState, useEffect, useCallback } from "react";
import { X, Plus, Building2, User, Briefcase, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { createPotential } from "@/lib/api";
import { FILTER_STAGES, FILTER_SERVICES } from "@/types";

const STAGE_PROBABILITY: Record<string, number> = {
  "Prospects": 10,
  "Pre Qualified": 20,
  "Requirements Capture": 35,
  "Proposal": 50,
  "Contracting": 75,
  "Closed": 100,
  "Contact Later": 10,
  "Sleeping": 5,
  "Low Value": 10,
  "Disqualified": 0,
  "Lost": 0,
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

const LEAD_SOURCES = ["Website", "Referral", "Cold Outreach", "Conference", "Partner", "LinkedIn", "Other"];

const INDUSTRIES = [
  "Healthcare", "Financial Services", "Insurance", "Technology", "Retail",
  "Manufacturing", "Real Estate", "Education", "Government", "Telecom",
  "Banking", "Logistics", "Media", "Other",
];

interface NewPotentialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (dealId: string) => void;
  availableStages?: string[];
  availableServices?: string[];
}

export default function NewPotentialModal({
  isOpen,
  onClose,
  onCreated,
  availableStages,
  availableServices,
}: NewPotentialModalProps) {
  const stages = availableStages && availableStages.length > 0 ? availableStages : [...FILTER_STAGES];
  const services = availableServices && availableServices.length > 0 ? availableServices : [...FILTER_SERVICES];

  // Company
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");

  // Contact
  const [contactName, setContactName] = useState("");
  const [contactTitle, setContactTitle] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  // Deal
  const [dealTitle, setDealTitle] = useState("");
  const [dealValue, setDealValue] = useState("");
  const [stage, setStage] = useState(stages[0] ?? "Prospects");
  const [probability, setProbability] = useState(STAGE_PROBABILITY[stages[0] ?? "Prospects"] ?? 10);
  const [service, setService] = useState("");
  const [subService, setSubService] = useState("");

  // Advanced
  const [leadSource, setLeadSource] = useState("");
  const [closingDate, setClosingDate] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // UI
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});

  // Reset on open
  useEffect(() => {
    if (!isOpen) return;
    setCompanyName(""); setIndustry(""); setWebsite("");
    setContactName(""); setContactTitle(""); setContactEmail(""); setContactPhone("");
    setDealTitle(""); setDealValue("");
    const defaultStage = stages[0] ?? "Prospects";
    setStage(defaultStage);
    setProbability(STAGE_PROBABILITY[defaultStage] ?? 10);
    setService(""); setSubService("");
    setLeadSource(""); setClosingDate(""); setNextStep("");
    setShowAdvanced(false); setSaving(false); setError(null); setFieldErrors({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Auto-suggest deal title
  useEffect(() => {
    if (service && companyName && !dealTitle) {
      setDealTitle(`${service} for ${companyName}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, companyName]);

  // Reset sub-service when service changes
  useEffect(() => { setSubService(""); }, [service]);

  const handleStageChange = useCallback((newStage: string) => {
    setStage(newStage);
    setProbability(STAGE_PROBABILITY[newStage] ?? 10);
  }, []);

  function validate(): boolean {
    const errors: Record<string, boolean> = {};
    if (!companyName.trim()) errors.companyName = true;
    if (!contactName.trim()) errors.contactName = true;
    if (!contactTitle.trim()) errors.contactTitle = true;
    if (!contactEmail.trim()) errors.contactEmail = true;
    if (!dealTitle.trim()) errors.dealTitle = true;
    if (!dealValue || Number(dealValue) <= 0) errors.dealValue = true;
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await createPotential({
        company: {
          name: companyName.trim(),
          industry: industry || undefined,
          website: website.trim() || undefined,
        },
        contact: {
          name: contactName.trim(),
          title: contactTitle.trim() || undefined,
          email: contactEmail.trim() || undefined,
          phone: contactPhone.trim() || undefined,
        },
        potential_name: dealTitle.trim(),
        amount: Number(dealValue),
        stage,
        probability,
        service: service || undefined,
        sub_service: subService || undefined,
        lead_source: leadSource || undefined,
        closing_date: closingDate || undefined,
        next_step: nextStep.trim() || undefined,
      });
      onCreated(result.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create potential");
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  const subServiceOptions = service ? (SUB_SERVICES[service] ?? []) : [];

  const inputCls = (field: string) =>
    `w-full rounded-lg border ${fieldErrors[field] ? "border-red-300 bg-red-50 focus:ring-red-300" : "border-slate-200 bg-white focus:ring-blue-300"} px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2`;

  const selectCls = (field = "") =>
    `w-full rounded-lg border ${fieldErrors[field] ? "border-red-300 bg-red-50 focus:ring-red-300" : "border-slate-200 bg-white focus:ring-blue-300"} px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 appearance-none cursor-pointer`;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex-shrink-0">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              <span className="font-semibold text-sm">New Potential</span>
            </div>
            <button onClick={onClose} className="p-1 rounded-full hover:bg-white/20 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>
            )}

            {/* Company */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <Building2 className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Company</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Company Name *"
                  value={companyName}
                  onChange={(e) => { setCompanyName(e.target.value); setFieldErrors((p) => ({ ...p, companyName: false })); }}
                  className={inputCls("companyName")}
                />
                <div className="relative">
                  <select value={industry} onChange={(e) => setIndustry(e.target.value)} className={selectCls()}>
                    <option value="">Industry</option>
                    {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                </div>
                <div className="col-span-2">
                  <input
                    type="url"
                    placeholder="Website (optional)"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    className={inputCls("")}
                  />
                </div>
              </div>
            </div>

            {/* Contact */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <User className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Contact</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Contact Name *"
                  value={contactName}
                  onChange={(e) => { setContactName(e.target.value); setFieldErrors((p) => ({ ...p, contactName: false })); }}
                  className={inputCls("contactName")}
                />
                <input
                  type="text"
                  placeholder="Title / Role *"
                  value={contactTitle}
                  onChange={(e) => { setContactTitle(e.target.value); setFieldErrors((p) => ({ ...p, contactTitle: false })); }}
                  className={inputCls("contactTitle")}
                />
                <input
                  type="email"
                  placeholder="Email *"
                  value={contactEmail}
                  onChange={(e) => { setContactEmail(e.target.value); setFieldErrors((p) => ({ ...p, contactEmail: false })); }}
                  className={inputCls("contactEmail")}
                />
                <input
                  type="tel"
                  placeholder="Phone"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className={inputCls("")}
                />
              </div>
            </div>

            {/* Deal */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <Briefcase className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Deal</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Deal Title *"
                  value={dealTitle}
                  onChange={(e) => { setDealTitle(e.target.value); setFieldErrors((p) => ({ ...p, dealTitle: false })); }}
                  className={inputCls("dealTitle")}
                />
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="Value *"
                    value={dealValue}
                    onChange={(e) => { setDealValue(e.target.value); setFieldErrors((p) => ({ ...p, dealValue: false })); }}
                    className={`${inputCls("dealValue")} pl-7`}
                  />
                </div>
                <div className="relative">
                  <select value={service} onChange={(e) => setService(e.target.value)} className={selectCls()}>
                    <option value="">Service Line</option>
                    {services.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                </div>
                <div className="relative">
                  <select
                    value={subService}
                    onChange={(e) => setSubService(e.target.value)}
                    disabled={!service || subServiceOptions.length === 0}
                    className={`${selectCls()} ${(!service || subServiceOptions.length === 0) ? "opacity-50" : ""}`}
                  >
                    <option value="">Sub-Service</option>
                    {subServiceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                </div>
                <div className="relative">
                  <select value={stage} onChange={(e) => handleStageChange(e.target.value)} className={selectCls()}>
                    {stages.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                </div>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="Probability %"
                    value={probability}
                    onChange={(e) => setProbability(Math.min(100, Math.max(0, Number(e.target.value))))}
                    className={`${inputCls("")} pr-7`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
                </div>
              </div>
            </div>

            {/* More Details */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
              >
                {showAdvanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                More Details
              </button>
              {showAdvanced && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="relative">
                    <select value={leadSource} onChange={(e) => setLeadSource(e.target.value)} className={selectCls()}>
                      <option value="">Lead Source</option>
                      {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  </div>
                  <input
                    type="date"
                    value={closingDate}
                    onChange={(e) => setClosingDate(e.target.value)}
                    className={inputCls("")}
                  />
                  <div className="col-span-2">
                    <input
                      type="text"
                      placeholder="Next Step (e.g. Schedule discovery call)"
                      value={nextStep}
                      onChange={(e) => setNextStep(e.target.value)}
                      className={inputCls("")}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex-shrink-0">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {saving ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />Creating...</>
              ) : (
                <><Plus className="h-3.5 w-3.5" />Create Potential</>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
