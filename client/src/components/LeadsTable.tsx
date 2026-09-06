import { Download, Inbox } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeadRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  message: string | null;
  created_at: string;
  landing_page_id: string;
  landing_pages: { business_name: string; slug: string } | null;
}

interface LeadsTableProps {
  leads: LeadRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function toWhatsAppHref(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const intl = digits.startsWith('972') ? digits : `972${digits.replace(/^0/, '')}`;
  return `https://wa.me/${intl}`;
}

function exportToCSV(leads: LeadRow[]) {
  const headers = ['שם', 'טלפון', 'אימייל', 'הודעה', 'תאריך', 'מקור'];
  const rows = leads.map((l) => [
    l.name,
    l.phone,
    l.email ?? '',
    l.message ?? '',
    formatDate(l.created_at),
    l.landing_pages?.business_name ?? l.landing_page_id,
  ]);

  const csvContent = [headers, ...rows]
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','),
    )
    .join('\n');

  // BOM ensures Excel opens Hebrew UTF-8 correctly
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function WhatsAppButton({ phone }: { phone: string }) {
  return (
    <a
      href={toWhatsAppHref(phone)}
      target="_blank"
      rel="noopener noreferrer"
      title="פתח שיחה ב-WhatsApp"
      className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-slate-200 bg-white hover:bg-slate-50 transition flex-shrink-0"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="#25D366" aria-hidden>
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    </a>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LeadsTable({ leads }: LeadsTableProps) {
  if (leads.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 px-8 flex flex-col items-center gap-3 text-center">
        <span className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
          <Inbox size={18} className="text-slate-400" />
        </span>
        <p className="text-sm font-semibold text-slate-900">אין עדיין לידים</p>
        <p className="text-sm text-slate-500 max-w-xs leading-relaxed">
          כל פנייה שתתקבל מטופס באחד הדפים שלך תופיע כאן, עם אפשרות לייצוא.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          <span className="font-semibold text-slate-900 tabular-nums">{leads.length}</span> לידים
        </p>
        <button
          onClick={() => exportToCSV(leads)}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <Download size={14} className="text-slate-400" />
          ייצוא ל-Excel / CSV
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-right" dir="rtl">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['שם', 'טלפון', 'אימייל', 'הודעה', 'תאריך', 'מקור (דף)'].map((col) => (
                  <th
                    key={col}
                    className="px-4 py-2.5 text-[11px] font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((lead, i) => (
                <tr
                  key={lead.id}
                  className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                    i === leads.length - 1 ? 'border-b-0' : ''
                  }`}
                >
                  {/* Name */}
                  <td className="px-4 py-3">
                    <span className="text-sm font-medium text-slate-900">{lead.name}</span>
                  </td>

                  {/* Phone + WA button */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-700 font-mono tabular-nums" dir="ltr">{lead.phone}</span>
                      <WhatsAppButton phone={lead.phone} />
                    </div>
                  </td>

                  {/* Email */}
                  <td className="px-4 py-3 hidden sm:table-cell">
                    {lead.email ? (
                      <a
                        href={`mailto:${lead.email}`}
                        className="text-sm text-[#2E63F6] hover:text-[#1E4FD6] hover:underline transition font-mono"
                        dir="ltr"
                      >
                        {lead.email}
                      </a>
                    ) : (
                      <span className="text-slate-300 text-sm">—</span>
                    )}
                  </td>

                  {/* Message */}
                  <td className="px-4 py-3 hidden md:table-cell max-w-[200px]">
                    {lead.message ? (
                      <span
                        className="text-sm text-slate-600 line-clamp-2 leading-relaxed"
                        title={lead.message}
                      >
                        {lead.message}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-sm">—</span>
                    )}
                  </td>

                  {/* Date */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-xs text-slate-500 tabular-nums">{formatDate(lead.created_at)}</span>
                  </td>

                  {/* Source page */}
                  <td className="px-4 py-3">
                    {lead.landing_pages ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 whitespace-nowrap">
                        {lead.landing_pages.business_name}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-xs font-mono">{lead.landing_page_id.slice(0, 8)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
