import { Building2, User, Briefcase, Mail, Globe } from "lucide-react";
import type { PotentialDetail } from "@/types";

interface DetailsTabProps {
  detail: PotentialDetail;
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  const display = (() => {
    if (value === null || value === undefined || value === "") return "—";
    return String(value);
  })();
  return (
    <div className="py-1.5">
      <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-0.5">{label}</p>
      <p className="text-sm text-slate-700">{display}</p>
    </div>
  );
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return null;
  return `$${Number(value).toLocaleString()}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return value;
  }
}

const STAGE_COLORS: Record<string, string> = {
  prospect: "bg-slate-100 text-slate-700",
  qualification: "bg-blue-100 text-blue-700",
  proposal: "bg-amber-100 text-amber-700",
  negotiation: "bg-orange-100 text-orange-700",
  "closed-won": "bg-emerald-100 text-emerald-700",
  "closed-lost": "bg-red-100 text-red-700",
};

export default function DetailsTab({ detail }: DetailsTabProps) {
  const { contact, company } = detail;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 space-y-4">

        {/* Deal / Opportunity */}
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
            <Briefcase className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-800">Deal / Opportunity</h3>
            {detail.stage && (
              <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${STAGE_COLORS[detail.stage] ?? "bg-slate-100 text-slate-700"}`}>
                {detail.stage}
              </span>
            )}
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
              <div className="col-span-2">
                <Field label="Title" value={detail.title} />
              </div>
              <Field label="Value" value={formatCurrency(detail.value)} />
              <Field label="Probability" value={detail.probability != null ? `${detail.probability}%` : null} />
              <Field label="Service" value={detail.service} />
              <Field label="Sub-service" value={detail.subService} />
              <Field label="Lead Source" value={detail.leadSource} />
              <Field label="Owner" value={detail.ownerName} />
              <Field label="Closing Date" value={formatDate(detail.closingDate)} />
              <Field label="Stage" value={detail.stage} />
              {detail.nextStep && (
                <div className="col-span-2">
                  <Field label="Next Step" value={detail.nextStep} />
                </div>
              )}
              {detail.description && (
                <div className="col-span-2">
                  <Field label="Description" value={detail.description} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Contact */}
        {contact && (
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <User className="h-4 w-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-800">Contact</h3>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                <Field label="Name" value={contact.name} />
                <Field label="Title" value={contact.title} />
                <div className="col-span-2 flex items-center gap-2">
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 mt-1"
                    >
                      <Mail className="h-3 w-3" />
                      {contact.email}
                    </a>
                  )}
                </div>
                {contact.phone && (
                  <div className="flex items-center gap-1">
                    <div className="flex-1">
                      <Field label="Phone" value={contact.phone} />
                    </div>
                  </div>
                )}
                {contact.mobile && (
                  <div className="flex items-center gap-1">
                    <div className="flex-1">
                      <Field label="Mobile" value={contact.mobile} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Company */}
        {company && (
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <Building2 className="h-4 w-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-800">Company</h3>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                <div className="col-span-2">
                  <Field label="Name" value={company.name} />
                </div>
                <Field label="Industry" value={company.industry} />
                <Field label="Location" value={company.location} />
                <Field label="Employees" value={company.employees} />
                <Field label="Revenue" value={formatCurrency(company.revenue)} />
                {company.website && (
                  <div className="col-span-2 flex items-center gap-1 mt-1">
                    <a
                      href={company.website.startsWith("http") ? company.website : `https://${company.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                    >
                      <Globe className="h-3 w-3" />
                      {company.website}
                    </a>
                  </div>
                )}
                {company.description && (
                  <div className="col-span-2">
                    <Field label="Description" value={company.description} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
