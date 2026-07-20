import { useState } from 'react';
import { motion } from 'framer-motion';
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
    <div className="rounded-3xl bg-gradient-to-l from-[#EEF1FB] to-orange-50/60 border border-[#C6D2F2] shadow-sm shadow-blue-100 p-5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <motion.span
          animate={{ rotate: [0, -8, 8, -4, 0] }}
          transition={{ repeat: Infinity, repeatDelay: 3, duration: 0.5 }}
          className="text-3xl leading-none select-none flex-shrink-0 mt-0.5"
        >
          🎁
        </motion.span>
        <div>
          <h3 className="font-black text-slate-800 text-sm">
            הזמן חברים וקבל קרדיטים!
          </h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            על כל חבר שיירשם דרך הלינק שלך, תקבל{' '}
            <span className="font-bold text-[#2E63F6]">5 ✦ קרדיטים</span> לארנק
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-2xl bg-white/80 border border-[#C6D2F2] px-3 py-2.5 min-w-0">
        <span className="flex-1 text-xs font-mono text-slate-400 truncate" dir="ltr">
          {referralLink}
        </span>
      </div>

      <div className="flex gap-2">
        <motion.button
          onClick={copyLink}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 10 }}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-bold transition-colors ${
            copied
              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
              : 'bg-white border border-[#C6D2F2] text-[#1E4FD6] hover:bg-[#EEF1FB]'
          }`}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'איזה יופי! הועתק 🔥' : 'העתק קישור'}
        </motion.button>
        <motion.button
          onClick={shareWhatsApp}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 10 }}
          className="flex items-center justify-center gap-1.5 rounded-full bg-[#25D366] hover:bg-[#1ebe5d] active:bg-[#18a851] text-white px-4 py-2 text-sm font-bold transition-colors"
        >
          <MessageCircle size={14} />
          שתף
        </motion.button>
      </div>
    </div>
  );
}
