import { useState } from 'react';
import { Copy, Check, MessageCircle } from 'lucide-react';
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
    <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none select-none">🎁</span>
        <div>
          <h3 className="font-bold text-slate-800 text-sm">הזמן חברים וקבל קרדיטים!</h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            על כל חבר שיירשם דרך הלינק שלך, תקבל{' '}
            <span className="font-semibold text-indigo-600">5 ✦ קרדיטים</span> לארנק
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 min-w-0">
        <span className="flex-1 text-xs font-mono text-slate-400 truncate" dir="ltr">
          {referralLink}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={copyLink}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
            copied
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'הועתק!' : 'העתק קישור'}
        </button>
        <button
          onClick={shareWhatsApp}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] active:bg-[#18a851] text-white px-4 py-2 text-sm font-medium transition-colors"
        >
          <MessageCircle size={14} />
          שתף
        </button>
      </div>
    </div>
  );
}
