// Small badge used across the Google-promotion product to make it obvious, at every
// step, WHO does what: "we" = the product, "you" = the customer.
export function RoleTag({ who, soon = false }: { who: 'we' | 'you'; soon?: boolean }) {
  const we = who === 'we';
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span
        className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
          we ? 'bg-blue-50 text-[#2E63F6]' : 'bg-amber-50 text-amber-700'
        }`}
      >
        {we ? 'אנחנו' : 'אתם'}
      </span>
      {soon && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">בקרוב</span>}
    </span>
  );
}
