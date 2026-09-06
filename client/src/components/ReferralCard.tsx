import { useState } from 'react';
import { Copy, Check, MessageCircle, Gift } from 'lucide-react';
import type { UserProfile } from '../context/UserContext';

interface Props {
  user: UserProfile;
}

export default function ReferralCard({ user }: Props) {
  const [copied, setCopied] = useState(false);

  const refCode = user.affiliate_code || user.email;
  const referralLink = `${window.location.origin}?ref=${encodeURIComponent(refCode)}`;

  const waMessage = `היי! מצאתי כלי מדהים ליצירת דפי נחיתה עם AI ✨\nהצטרף דרך הקישור שלי וקבלו ביחד 5 ✦ קרדיטים לארנק: ${referralLink}`;

  function copyLink() {
    navigator.clipboard.writeText(referralLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function shareWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(waMessage)}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <section className="rounded-xl bg-white border border-slate-200 p-5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
          <Gift size={15} className="text-slate-500" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">הזמנת חברים</h3>
          <p className="text-sm text-slate-500 mt-0.5 leading-relaxed">
            על כל חבר שיירשם דרך הלינק שלך, תקבל{' '}
            <span className="font-semibold text-slate-900">5 קרדיטים</span> לארנק
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 min-w-0">
        <span className="flex-1 text-xs font-mono text-slate-500 truncate" dir="ltr">
          {referralLink}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={copyLink}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium border transition-colors ${
            copied
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'הקישור הועתק' : 'העתק קישור'}
        </button>
        <button
          onClick={shareWhatsApp}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <MessageCircle size={14} className="text-[#25D366]" />
          שיתוף ב-WhatsApp
        </button>
      </div>
    </section>
  );
}
