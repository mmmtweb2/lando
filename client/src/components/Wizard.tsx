import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useUser } from '../context/UserContext';
import { LandoBot } from './Lando';
import { authFetch } from '../lib/api';
import {
  Building2,
  Phone,
  AlignLeft,
  Upload,
  Image,
  Sparkles,
  ChevronLeft,
  X,
  CheckCircle2,
  ExternalLink,
  FileText,
  Mail,
  Link2,
  Loader2,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type ImageSource = 'none' | 'upload' | 'stock' | 'ai';
type DesignStyle = '' | 'luxury' | 'vibrant' | 'minimal' | 'warm';
type PageGoal = 'lead_gen' | 'direct_sale' | 'donation' | 'registration';

interface FormState {
  page_goal: PageGoal | '';
  business_name: string;
  vibe: string;
  phone_number: string;
  design_style: DesignStyle;
  user_provided_text: string;
  email: string;
  facebook_url: string;
  instagram_url: string;
  external_link: string;
  cta_type: 'whatsapp' | 'email' | 'phone' | 'link';
  enable_form: boolean;
  include_testimonials: boolean;
  logo: File | null;
  primary_color: string;
  secondary_color: string;
  auto_extract_colors: boolean;
  wants_images: boolean;
  image_source: ImageSource;
  user_images: File[];
}

interface LandingPageRecord {
  id: string;
  slug: string;
  business_name: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STEPS = ['מטרת הדף', 'פרטי העסק', 'לוגו', 'קשר ולינקים', 'תמונות'];

interface GoalLabels {
  businessName: string;
  businessNamePlaceholder: string;
  vibe: string;
  vibePlaceholder: string;
  userText: string;
  userTextPlaceholder: string;
  externalLinkLabel: string | null;
  externalLinkPlaceholder: string;
}

function getGoalLabels(goal: PageGoal | ''): GoalLabels {
  switch (goal) {
    case 'donation':
      return {
        businessName: 'שם העמותה *',
        businessNamePlaceholder: 'לדוגמה: "עמותת ידידים"',
        vibe: 'תחום / מטרת העמותה *',
        vibePlaceholder: 'לדוגמה: "עמותה לסיוע לילדים בסיכון"',
        userText: 'מידע על העמותה',
        userTextPlaceholder: 'ספרו על הפעילות, הייעוד, והאנשים שאתם עוזרים להם — ה-AI ישתמש בזה לכתיבה',
        externalLinkLabel: 'קישור לדף תרומה (PayBox / bit / אחר)',
        externalLinkPlaceholder: 'https://paybox.co.il/...',
      };
    case 'direct_sale':
      return {
        businessName: 'שם המוצר / השירות *',
        businessNamePlaceholder: 'לדוגמה: "קורס צילום מקצועי"',
        vibe: 'קטגוריה / תיאור *',
        vibePlaceholder: 'לדוגמה: "קורס דיגיטלי לצילום נוף"',
        userText: 'תיאור המוצר ויתרונותיו',
        userTextPlaceholder: 'מה כולל המוצר? מה הייחוד שלו? מה הלקוח מקבל?',
        externalLinkLabel: 'קישור לדף תשלום / סליקה',
        externalLinkPlaceholder: 'https://...',
      };
    case 'registration':
      return {
        businessName: 'שם הקורס / האירוע *',
        businessNamePlaceholder: 'לדוגמה: "וובינר חינם: שיווק ברשתות חברתיות"',
        vibe: 'נושא הקורס / האירוע *',
        vibePlaceholder: 'לדוגמה: "קורס לתכנון כלכלי אישי"',
        userText: 'מידע על הקורס / האירוע',
        userTextPlaceholder: 'מה ילמדו המשתתפים? מי המרצה? מה המועד?',
        externalLinkLabel: null,
        externalLinkPlaceholder: '',
      };
    default:
      return {
        businessName: 'שם העסק *',
        businessNamePlaceholder: 'לדוגמה: "מאפיית הלחם של דני"',
        vibe: 'תחום / סגנון *',
        vibePlaceholder: 'לדוגמה: "מאפייה ביתית שמתמחה בלחמי שאור"',
        userText: 'טקסט שיווקי קיים או מידע נוסף על העסק',
        userTextPlaceholder: 'הדביקו כאן טקסטים מהאתר הישן, מסמכי שיווק, תיאור העסק, יתרונות — ה-AI ישתמש בזה כבסיס לכתיבה',
        externalLinkLabel: null,
        externalLinkPlaceholder: '',
      };
  }
}

const PAGE_GOAL_OPTIONS: { value: PageGoal; label: string; desc: string; emoji: string }[] = [
  { value: 'lead_gen',      label: 'גיוס לידים ופניות',         emoji: '📩', desc: 'קבלת פניות ובקשות מלקוחות פוטנציאליים' },
  { value: 'direct_sale',   label: 'מכירת מוצר / שירות',        emoji: '🛒', desc: 'מכירה ישירה מהדף עם קריאה לפעולה ברורה' },
  { value: 'donation',      label: 'גיוס תרומות לעמותה',        emoji: '❤️', desc: 'עידוד תרומות למטרה חברתית או עמותה' },
  { value: 'registration',  label: 'הרשמה לקורס / וובינר',      emoji: '🎓', desc: 'הרשמת משתתפים לאירוע, קורס או הכשרה' },
];

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const DESIGN_STYLE_OPTIONS: { value: Exclude<DesignStyle, ''>; label: string; desc: string; emoji: string }[] = [
  { value: 'luxury',  label: 'יוקרתי ומאופק',   emoji: '✦', desc: 'כהה, אלגנטי, מרשים' },
  { value: 'vibrant', label: 'צבעוני ונועז',     emoji: '⚡', desc: 'אנרגטי, חי, בולט' },
  { value: 'minimal', label: 'נקי ומינימליסטי',  emoji: '○', desc: 'פשוט, לבן, מרווח' },
  { value: 'warm',    label: 'חמים ואורגני',     emoji: '☀', desc: 'נעים, אדמתי, קרוב' },
];

const IMAGE_OPTIONS: { value: ImageSource; label: string; desc: string; icon: React.ReactNode }[] = [
  { value: 'upload', label: 'העלאת תמונות שלי',           desc: 'העלו עד 3 תמונות מהמכשיר שלכם', icon: <Upload size={20} /> },
  { value: 'stock',  label: 'תמונות אווירה ממאגר חינמי', desc: 'תמונות מקצועיות מ-Unsplash',     icon: <Image size={20} /> },
  { value: 'ai',     label: 'יצירת תמונות עם AI',        desc: 'תמונות שנוצרו עבור העסק שלכם',  icon: <Sparkles size={20} /> },
];

const PREVIEW_PALETTE: Record<string, { from: string; to: string }> = {
  luxury:  { from: '#1e3a5f', to: '#2d5282' },
  vibrant: { from: '#7c3aed', to: '#db2777' },
  minimal: { from: '#334155', to: '#475569' },
  warm:    { from: '#b45309', to: '#d97706' },
};

// ─── Animation ────────────────────────────────────────────────────────────────

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 48 : -48, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit:  (dir: number) => ({ x: dir > 0 ? -48 : 48, opacity: 0 }),
};

const spring = { type: 'spring' as const, stiffness: 400, damping: 35 };
const fadeIn = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2 } };

// ─── Shared UI primitives ─────────────────────────────────────────────────────

function Step({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-800">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
        {icon && <span className="text-indigo-500">{icon}</span>}
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition';

// ─── Toggle switch ────────────────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 w-full rounded-xl border-2 px-4 py-3 transition-colors text-right"
      style={{
        borderColor: checked ? '#2E63F6' : '#e2e8f0',
        backgroundColor: checked ? '#eef2ff' : '#ffffff',
      }}
    >
      <div
        className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 ${
          checked ? 'bg-indigo-500' : 'bg-slate-200'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </div>
      <span className={`text-sm font-medium leading-snug ${checked ? 'text-indigo-700' : 'text-slate-600'}`}>
        {label}
      </span>
    </button>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
          <div
            className={`h-1.5 w-full rounded-full transition-all duration-500 ${
              i < current ? 'bg-indigo-500' : i === current ? 'bg-indigo-300' : 'bg-slate-200'
            }`}
          />
          <span className={`text-xs font-medium transition-colors ${
            i === current ? 'text-indigo-600' : i < current ? 'text-slate-500' : 'text-slate-300'
          }`}>
            {STEPS[i]}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Design style picker ──────────────────────────────────────────────────────

function DesignStyleCards({
  value,
  onChange,
}: {
  value: DesignStyle;
  onChange: (v: Exclude<DesignStyle, ''>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {DESIGN_STYLE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex flex-col gap-1 rounded-xl border-2 px-3 py-2.5 text-right transition-all ${
            value === opt.value ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:border-indigo-200'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <span className={`text-base ${value === opt.value ? 'text-indigo-500' : 'text-slate-400'}`}>{opt.emoji}</span>
            <p className={`text-xs font-semibold leading-tight ${value === opt.value ? 'text-indigo-700' : 'text-slate-700'}`}>
              {opt.label}
            </p>
          </div>
          <p className="text-xs text-slate-400">{opt.desc}</p>
        </button>
      ))}
    </div>
  );
}

// ─── Page goal cards ─────────────────────────────────────────────────────────

function PageGoalCards({
  value,
  onChange,
}: {
  value: PageGoal | '';
  onChange: (v: PageGoal) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3">
      {PAGE_GOAL_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-4 rounded-2xl border-2 px-5 py-4 text-right transition-all ${
            value === opt.value
              ? 'border-indigo-500 bg-indigo-50 shadow-md'
              : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50'
          }`}
        >
          <span className="text-2xl flex-shrink-0">{opt.emoji}</span>
          <div className="flex flex-col gap-0.5 flex-1">
            <p className={`text-sm font-semibold leading-snug ${value === opt.value ? 'text-indigo-700' : 'text-slate-800'}`}>
              {opt.label}
            </p>
            <p className="text-xs text-slate-400 leading-snug">{opt.desc}</p>
          </div>
          <div className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
            value === opt.value ? 'border-indigo-500 bg-indigo-500' : 'border-slate-300'
          }`}>
            {value === opt.value && (
              <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
                <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── Brand color picker ───────────────────────────────────────────────────────

function ColorPickerRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
}) {
  const isValid = /^#[0-9a-fA-F]{6}$/.test(value);
  const swatchColor = isValid ? value : '#e2e8f0';

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <div className={`flex items-center gap-2 rounded-xl border px-2 py-1.5 transition ${
        disabled ? 'border-slate-100 bg-slate-50 opacity-50' : 'border-slate-200 bg-white'
      }`}>
        {/* Colour swatch — clicking opens the native picker via the hidden input */}
        <div className="relative flex-shrink-0 w-9 h-9">
          <div
            className="w-9 h-9 rounded-lg border border-slate-200 cursor-pointer"
            style={{ backgroundColor: swatchColor }}
          />
          <input
            type="color"
            value={isValid ? value : '#2E63F6'}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer disabled:cursor-not-allowed"
          />
        </div>
        {/* Hex text input */}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            if (e.target.value && !/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
              onChange('');
            }
          }}
          placeholder="#2E63F6"
          disabled={disabled}
          dir="ltr"
          maxLength={7}
          className="flex-1 text-sm font-mono text-slate-700 placeholder-slate-300 outline-none bg-transparent disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}

function BrandColorSection({
  primaryColor,
  secondaryColor,
  autoExtract,
  hasLogo,
  onPrimaryChange,
  onSecondaryChange,
  onAutoExtractChange,
}: {
  primaryColor: string;
  secondaryColor: string;
  autoExtract: boolean;
  hasLogo: boolean;
  onPrimaryChange: (v: string) => void;
  onSecondaryChange: (v: string) => void;
  onAutoExtractChange: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3 pt-3 border-t border-slate-100">
      <p className="text-sm font-semibold text-slate-700">מיתוג וצבעים</p>

      {/* Auto-extract toggle */}
      <button
        type="button"
        role="switch"
        aria-checked={autoExtract}
        disabled={!hasLogo}
        onClick={() => hasLogo && onAutoExtractChange(!autoExtract)}
        className={`flex items-start gap-3 rounded-xl border-2 px-4 py-3 text-right transition-colors ${
          autoExtract
            ? 'border-indigo-500 bg-indigo-50'
            : hasLogo
            ? 'border-slate-200 bg-white hover:border-indigo-200'
            : 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed'
        }`}
      >
        <div
          className={`relative flex-shrink-0 mt-0.5 w-10 h-5 rounded-full transition-colors duration-200 ${
            autoExtract ? 'bg-indigo-500' : 'bg-slate-200'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${
              autoExtract ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={`text-sm font-medium ${autoExtract ? 'text-indigo-700' : 'text-slate-700'}`}>
            שאב צבעים אוטומטית מהלוגו
          </span>
          <span className="text-xs text-slate-400">
            {hasLogo
              ? 'ה-AI יזהה את צבעי המותג ישירות מהלוגו שהעליתם'
              : 'יש להעלות לוגו כדי לאפשר אפשרות זו'}
          </span>
        </div>
      </button>

      {/* Manual color pickers */}
      <div className={`grid grid-cols-2 gap-3 transition-opacity ${autoExtract ? 'opacity-40 pointer-events-none' : ''}`}>
        <ColorPickerRow
          label="צבע ראשי"
          value={primaryColor}
          onChange={onPrimaryChange}
          disabled={autoExtract}
        />
        <ColorPickerRow
          label="צבע משני"
          value={secondaryColor}
          onChange={onSecondaryChange}
          disabled={autoExtract}
        />
      </div>
      {autoExtract && (
        <p className="text-xs text-indigo-500 text-center -mt-1">
          הצבעים ייחלצו אוטומטית מהלוגו שהעליתם
        </p>
      )}
      {!autoExtract && !primaryColor && !secondaryColor && (
        <p className="text-xs text-slate-400 text-center -mt-1">
          השאירו ריק כדי לאפשר ל-AI לבחור את הצבעים
        </p>
      )}
    </div>
  );
}

// ─── Logo upload ──────────────────────────────────────────────────────────────

function LogoUpload({ file, onChange }: { file: File | null; onChange: (f: File | null, err?: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const preview = file ? URL.createObjectURL(file) : null;

  function handleFile(picked: File | undefined) {
    if (!picked) return;
    if (picked.size > MAX_FILE_BYTES) {
      onChange(null, 'הקובץ גדול מדי — הגודל המקסימלי הוא 10MB');
      if (ref.current) ref.current.value = '';
      return;
    }
    onChange(picked);
  }

  return (
    <div
      onClick={() => !file && ref.current?.click()}
      className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition cursor-pointer ${
        file ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
      }`}
    >
      <input ref={ref} type="file" accept="image/*" className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])} />
      {preview ? (
        <>
          <img src={preview} alt="לוגו" className="h-20 w-20 rounded-lg object-contain" />
          <button type="button"
            onClick={(e) => { e.stopPropagation(); onChange(null); if (ref.current) ref.current.value = ''; }}
            className="absolute top-2 left-2 rounded-full bg-white p-1 shadow text-slate-500 hover:text-red-500 transition">
            <X size={14} />
          </button>
          <p className="text-xs text-indigo-600 font-medium">{file?.name}</p>
        </>
      ) : (
        <>
          <div className="rounded-full bg-slate-100 p-3 text-slate-400"><Upload size={20} /></div>
          <p className="text-sm text-slate-500"><span className="font-medium text-indigo-600">לחצו להעלאה</span></p>
          <p className="text-xs text-slate-400">PNG, JPG, WEBP עד 10MB</p>
        </>
      )}
    </div>
  );
}

// ─── Multi-image upload ───────────────────────────────────────────────────────

function UserImagesUpload({ files, onChange }: { files: File[]; onChange: (files: File[], err?: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);

  function handlePick(list: FileList | null) {
    if (!list) return;
    const picked = Array.from(list);
    for (const f of picked) {
      if (f.size > MAX_FILE_BYTES) {
        onChange(files, `"${f.name}" גדול מדי — מקסימום 10MB לקובץ`);
        if (ref.current) ref.current.value = '';
        return;
      }
    }
    const combined = [...files, ...picked].slice(0, 3);
    onChange(combined);
    if (ref.current) ref.current.value = '';
  }

  return (
    <div className="flex flex-col gap-3">
      {files.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {files.map((f, i) => (
            <div key={i} className="relative aspect-square">
              <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover rounded-xl" />
              <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="absolute top-1 right-1 rounded-full bg-black/50 p-0.5 text-white hover:bg-black/70 transition">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {files.length < 3 && (
        <div onClick={() => ref.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-4 text-center cursor-pointer hover:border-indigo-300 hover:bg-slate-50 transition">
          <input ref={ref} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => handlePick(e.target.files)} />
          <Upload size={16} className="text-slate-400" />
          <p className="text-xs text-slate-500">
            <span className="font-medium text-indigo-600">הוסיפו תמונות</span>{' '}({files.length}/3)
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Image source cards ───────────────────────────────────────────────────────

function ImageSourceCards({ value, onChange }: { value: ImageSource; onChange: (v: ImageSource) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {IMAGE_OPTIONS.map((opt) => (
        <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
          className={`flex items-start gap-3 rounded-xl border-2 px-4 py-3 text-right transition-all ${
            value === opt.value ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:border-indigo-200'
          }`}>
          <div className={`mt-0.5 rounded-lg p-1.5 flex-shrink-0 transition-colors ${
            value === opt.value ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'
          }`}>
            {opt.icon}
          </div>
          <div>
            <p className={`text-sm font-semibold ${value === opt.value ? 'text-indigo-700' : 'text-slate-700'}`}>{opt.label}</p>
            <p className="text-xs text-slate-500 mt-0.5">{opt.desc}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── Idle skeleton preview ────────────────────────────────────────────────────

function IdleSkeletonPreview({ businessName, designStyle }: { businessName: string; designStyle: DesignStyle }) {
  const pal = PREVIEW_PALETTE[designStyle] ?? { from: '#2E63F6', to: '#6FE7FF' };
  const gradient = `linear-gradient(150deg, ${pal.from}, ${pal.to})`;
  const displayName = businessName.trim() || 'שם העסק שלכם';

  return (
    <div className="w-full h-full overflow-y-auto" dir="rtl">
      {/* Mini header */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-white/90 backdrop-blur-sm border-b border-slate-100">
        <span className="text-xs font-bold text-slate-700 truncate max-w-[55%]">{displayName}</span>
        <div
          className="rounded-lg px-3 py-1.5 text-[10px] font-semibold text-white"
          style={{ background: gradient }}
        >
          צור קשר
        </div>
      </div>

      {/* Hero section */}
      <div
        className="flex flex-col items-center justify-center px-5 py-10 text-center gap-3"
        style={{ background: gradient, minHeight: 200 }}
      >
        <div className="text-lg font-bold text-white leading-snug">{displayName}</div>
        <div className="text-xs text-white/75 max-w-[200px]">
          {designStyle ? DESIGN_STYLE_OPTIONS.find(o => o.value === designStyle)?.desc : 'מקצועיות ואיכות ללא פשרות'}
        </div>
        {/* WhatsApp button */}
        <div className="flex items-center gap-1.5 rounded-full bg-white/20 px-4 py-1.5 mt-1">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
          <span className="text-[10px] font-medium text-white">שלחו הודעה</span>
        </div>
      </div>

      {/* About section skeleton */}
      <div className="px-5 py-6 bg-white">
        <div className="h-3.5 rounded-full bg-slate-200 w-24 mb-3 animate-pulse" />
        <div className="space-y-2">
          <div className="h-2.5 rounded-full bg-slate-100 animate-pulse" />
          <div className="h-2.5 rounded-full bg-slate-100 w-4/5 animate-pulse" />
          <div className="h-2.5 rounded-full bg-slate-100 w-3/5 animate-pulse" />
        </div>
      </div>

      {/* Services section skeleton */}
      <div className="px-5 py-6 bg-slate-50">
        <div className="h-3.5 rounded-full bg-slate-200 w-28 mb-4 animate-pulse" />
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl bg-white p-3 shadow-sm flex gap-3 items-start">
              <div className="rounded-lg w-8 h-8 flex-shrink-0 animate-pulse" style={{ background: gradient, opacity: 0.25 }} />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 rounded-full bg-slate-200 w-2/3 animate-pulse" />
                <div className="h-2 rounded-full bg-slate-100 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer skeleton */}
      <div className="px-5 py-6" style={{ background: gradient }}>
        <div className="h-3 rounded-full bg-white/20 w-32 mx-auto mb-4 animate-pulse" />
        <div className="rounded-xl bg-white/15 py-3 text-center">
          <div className="h-2.5 rounded-full bg-white/30 w-24 mx-auto animate-pulse" />
        </div>
      </div>
    </div>
  );
}

// ─── Loading preview ──────────────────────────────────────────────────────────

const LOADING_PHASES = [
  'מנתח את תחום העיסוק שלך...',
  'כותב כותרות ממירות בשיטת PAS...',
  'בוחר פלטת צבעים שמשדרת יוקרה...',
  'מעצב את מבנה הסקציות...',
  'מייצר אייקונים מותאמים אישית...',
  'מסיים ומרכיב את הדף...',
];

function LoadingPreview({ designStyle }: { designStyle: DesignStyle }) {
  const pal = PREVIEW_PALETTE[designStyle] ?? { from: '#2E63F6', to: '#6FE7FF' };
  const gradient = `linear-gradient(150deg, ${pal.from}, ${pal.to})`;
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [progress, setProgress] = useState(6);

  useEffect(() => {
    const id = setInterval(() => {
      // Advance phases but hold on the last one — never loop back to "analyzing".
      setPhaseIndex((prev) => Math.min(prev + 1, LOADING_PHASES.length - 1));
    }, 3500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Simulated ease-out progress: quick at first, slowing toward ~93% where it
    // holds until the real result arrives and this component unmounts.
    const id = setInterval(() => {
      setProgress((p) => (p >= 93 ? p : p + Math.max(0.5, (93 - p) * 0.045)));
    }, 350);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-white px-6">
      {/* Lando accompanies the build */}
      <div className="relative flex items-center justify-center">
        <div
          className="absolute w-24 h-24 rounded-full opacity-20 animate-ping"
          style={{ background: gradient }}
        />
        <div className="relative z-10 lando-hover">
          <LandoBot mood="loading" size={112} />
        </div>
      </div>

      <div className="text-center space-y-1.5 min-h-[3rem] flex flex-col justify-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={phaseIndex}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.35 }}
            className="text-base font-semibold text-slate-700"
          >
            {LOADING_PHASES[phaseIndex]}
          </motion.p>
        </AnimatePresence>
        <p className="text-xs text-slate-400">עוד כמה שניות…</p>
      </div>

      {/* Progress bar — gives a concrete "it's working" signal over the ~25s build */}
      <div className="w-full max-w-xs flex flex-col gap-1.5">
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-300 ease-out"
            style={{ background: gradient, width: `${progress}%` }}
          />
        </div>
        <span className="text-[11px] font-medium text-slate-400 text-center">{Math.round(progress)}%</span>
      </div>

      {/* Bouncing dots */}
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-2 h-2 rounded-full"
            style={{ background: pal.from }}
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export default function Wizard() {
  const { user, isAuthReady } = useUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthReady && !user) {
      navigate('/login', { replace: true });
    }
  }, [user, isAuthReady, navigate]);

  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [form, setForm] = useState<FormState>({
    page_goal: '',
    business_name: '',
    vibe: '',
    phone_number: '',
    design_style: '',
    user_provided_text: '',
    email: '',
    facebook_url: '',
    instagram_url: '',
    external_link: '',
    cta_type: 'whatsapp',
    enable_form: false,
    include_testimonials: false,
    logo: null,
    primary_color: '',
    secondary_color: '',
    auto_extract_colors: false,
    wants_images: false,
    image_source: 'none',
    user_images: [],
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LandingPageRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showGuidingQuestions, setShowGuidingQuestions] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!result) return;
    if (window.innerWidth >= 1024) return;
    const t = setTimeout(() => {
      previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 400);
    return () => clearTimeout(t);
  }, [result]);

  // On mobile the progress lives in the preview pane below the form — when
  // generation starts, scroll it into view so the user sees it working
  // (instead of staring at a disabled button).
  useEffect(() => {
    if (!loading) return;
    if (window.innerWidth >= 1024) return;
    const t = setTimeout(() => {
      previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
    return () => clearTimeout(t);
  }, [loading]);

  if (!isAuthReady || !user) return null;

  const uiMode: 'idle' | 'loading' | 'success' = result ? 'success' : loading ? 'loading' : 'idle';

  function update<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  function go(next: number) {
    setError(null);
    setDir(next > step ? 1 : -1);
    setStep(next);
  }

  function setWantsImages(yes: boolean) {
    setForm((prev) => ({
      ...prev,
      wants_images: yes,
      image_source: yes ? (prev.image_source === 'none' ? 'stock' : prev.image_source) : 'none',
    }));
  }

  async function submit() {
    setLoading(true);
    setError(null);
    if (!user) { setError('צריך להתחבר כדי ליצור דף'); setLoading(false); return; }
    try {
      // Resolve the effective image_source — if user toggled "wants images" but
      // form.image_source is still 'none', default to 'stock'.
      const effectiveImageSource: ImageSource =
        form.wants_images && form.image_source === 'none' ? 'stock' : form.image_source;

      console.log('[WIZARD] Submitting — image_source:', effectiveImageSource, '| wants_images:', form.wants_images);

      const fd = new FormData();
      fd.append('business_name', form.business_name);
      fd.append('phone_number', form.phone_number);
      fd.append('vibe', form.vibe);
      fd.append('image_source', effectiveImageSource);
      fd.append('design_style', form.design_style);
      if (form.page_goal) fd.append('page_goal', form.page_goal);
      fd.append('enable_form', String(form.enable_form));
      fd.append('include_testimonials', String(form.include_testimonials));
      fd.append('owner_email', user.email);
      if (form.user_provided_text.trim()) fd.append('user_provided_text', form.user_provided_text.trim());
      if (form.email.trim())          fd.append('email', form.email.trim());
      if (form.facebook_url.trim())   fd.append('facebook_url', form.facebook_url.trim());
      if (form.instagram_url.trim())  fd.append('instagram_url', form.instagram_url.trim());
      if (form.external_link.trim())  fd.append('external_link', form.external_link.trim());
      fd.append('cta_type', form.cta_type);
      // Brand colors
      if (form.auto_extract_colors) {
        fd.append('auto_extract_colors', 'true');
      } else {
        if (/^#[0-9a-fA-F]{6}$/.test(form.primary_color))   fd.append('primary_color', form.primary_color);
        if (/^#[0-9a-fA-F]{6}$/.test(form.secondary_color)) fd.append('secondary_color', form.secondary_color);
      }
      if (form.logo) fd.append('logo', form.logo);
      if (effectiveImageSource === 'upload') {
        form.user_images.forEach((img) => fd.append('user_images', img));
      }

      const res = await authFetch('/api/landing', { method: 'POST', body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `שגיאה ${res.status}`);
      }
      setResult((await res.json()) as LandingPageRecord);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה לא ידועה');
    } finally {
      setLoading(false);
    }
  }

  const goalLabels = getGoalLabels(form.page_goal);

  const canNext = [
    form.page_goal !== '',
    form.business_name.trim() !== '' &&
      form.vibe.trim() !== '' &&
      form.phone_number.trim() !== '' &&
      form.design_style !== '',
    true,
    true,
    true,
  ][step];

  const steps = [
    // ── Step 0: Page Goal ─────────────────────────────────────────────────────
    <Step key="step-goal" title="מה מטרת הדף?" subtitle="ה-AI ישתמש בזה כדי להתאים את הכותרות, הכפתורים וסגנון הכתיבה">
      <PageGoalCards value={form.page_goal} onChange={(v) => update('page_goal', v)} />
    </Step>,

    // ── Step 1: Core ──────────────────────────────────────────────────────────
    <Step key="step-core" title="ספרו לנו על העסק" subtitle="פרטי הבסיס שישמשו לבניית הדף">
      <Field label={goalLabels.businessName} icon={<Building2 size={15} />}>
        <input className={inputCls} placeholder={goalLabels.businessNamePlaceholder}
          value={form.business_name} onChange={(e) => update('business_name', e.target.value)} autoFocus />
      </Field>
      <Field label={goalLabels.vibe} icon={<AlignLeft size={15} />}>
        <input className={inputCls} placeholder={goalLabels.vibePlaceholder}
          value={form.vibe} onChange={(e) => update('vibe', e.target.value)} />
      </Field>
      <Field label="מספר וואטסאפ *" icon={<Phone size={15} />}>
        <input className={inputCls} placeholder="0501234567" type="tel" dir="ltr"
          value={form.phone_number} onChange={(e) => update('phone_number', e.target.value)} />
      </Field>
      <Field label="סגנון עיצוב *" icon={<Sparkles size={15} />}>
        <DesignStyleCards value={form.design_style} onChange={(v) => update('design_style', v)} />
      </Field>
      <Field label={goalLabels.userText} icon={<FileText size={15} />}>
        <textarea className={`${inputCls} resize-none`} rows={3}
          placeholder={goalLabels.userTextPlaceholder}
          value={form.user_provided_text}
          onChange={(e) => update('user_provided_text', e.target.value)} />
        <button
          type="button"
          onClick={() => setShowGuidingQuestions((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-700 transition self-start mt-0.5"
        >
          <Sparkles size={12} />
          {showGuidingQuestions ? 'סגור שאלות מנחות' : 'אין לך טקסט? לחצו לשאלות מנחות'}
        </button>
        <AnimatePresence>
          {showGuidingQuestions && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="flex flex-col gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50/70 p-3.5 mt-1">
                <p className="text-xs font-semibold text-indigo-600">ענו על השאלות האלה בתיבה למעלה:</p>
                {[
                  'מה הלקוחות הכי אוהבים בשירות שלך?',
                  'מה הבעיה הכי גדולה שאתה פותר להם?',
                  'מה מייחד אותך מהמתחרים?',
                ].map((q, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-indigo-200 text-indigo-700 text-[10px] font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-xs text-indigo-700 leading-snug">{q}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Field>
    </Step>,

    // ── Step 2: Logo + Brand colors ───────────────────────────────────────────
    <Step key="step-logo" title="לוגו ומיתוג" subtitle="עיצוב חזותי לדף שלכם (הכל אופציונלי)">
      <LogoUpload
        file={form.logo}
        onChange={(f, err) => {
          update('logo', f);
          if (!f) update('auto_extract_colors', false);
          setError(err ?? null);
        }}
      />
      <BrandColorSection
        primaryColor={form.primary_color}
        secondaryColor={form.secondary_color}
        autoExtract={form.auto_extract_colors}
        hasLogo={!!form.logo}
        onPrimaryChange={(v) => update('primary_color', v)}
        onSecondaryChange={(v) => update('secondary_color', v)}
        onAutoExtractChange={(v) => update('auto_extract_colors', v)}
      />
    </Step>,

    // ── Step 3: Contact & Links ───────────────────────────────────────────────
    <Step key="step-contact" title="קשר ולינקים" subtitle="פרטי קשר ורשתות חברתיות (הכל אופציונלי)">
      <Field label="כפתור הפעולה הראשי בדף יפנה אל:" icon={<ExternalLink size={15} />}>
        <div className="grid grid-cols-2 gap-2">
          {([
            { v: 'whatsapp', label: 'וואטסאפ' },
            { v: 'phone', label: 'טלפון' },
            { v: 'email', label: 'אימייל' },
            { v: 'link', label: 'קישור חיצוני' },
          ] as { v: FormState['cta_type']; label: string }[]).map((o) => (
            <button key={o.v} type="button" onClick={() => update('cta_type', o.v)}
              className={`px-3 py-2 rounded-xl border text-sm font-medium transition ${form.cta_type === o.v ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </Field>
      {goalLabels.externalLinkLabel && (
        <Field label={goalLabels.externalLinkLabel} icon={<ExternalLink size={15} />}>
          <input className={inputCls} placeholder={goalLabels.externalLinkPlaceholder} type="url" dir="ltr"
            value={form.external_link} onChange={(e) => update('external_link', e.target.value)} />
        </Field>
      )}
      <Field label="כתובת אימייל" icon={<Mail size={15} />}>
        <input className={inputCls} placeholder="info@mybusiness.com" type="email" dir="ltr"
          value={form.email} onChange={(e) => update('email', e.target.value)} />
      </Field>
      <Field label="קישור לעמוד Facebook" icon={<Link2 size={15} />}>
        <input className={inputCls} placeholder="https://facebook.com/mybusiness" type="url" dir="ltr"
          value={form.facebook_url} onChange={(e) => update('facebook_url', e.target.value)} />
      </Field>
      <Field label="קישור לעמוד Instagram" icon={<Link2 size={15} />}>
        <input className={inputCls} placeholder="https://instagram.com/mybusiness" type="url" dir="ltr"
          value={form.instagram_url} onChange={(e) => update('instagram_url', e.target.value)} />
      </Field>
      <ToggleSwitch
        checked={form.enable_form}
        onChange={(v) => update('enable_form', v)}
        label="הוסף טופס השארת פרטים (לידים) לדף"
      />
      <ToggleSwitch
        checked={form.include_testimonials}
        onChange={(v) => update('include_testimonials', v)}
        label="הוסף אזור המלצות מלקוחות (Testimonials)"
      />
    </Step>,

    // ── Step 4: Images ────────────────────────────────────────────────────────
    <Step key="step-images" title="תמונות" subtitle="האם תרצו לשלב תמונות בדף?">
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'לא, תודה', value: false },
          { label: 'כן, בבקשה!', value: true },
        ].map((opt) => (
          <button key={String(opt.value)} type="button" onClick={() => setWantsImages(opt.value)}
            className={`rounded-xl border-2 py-3 text-sm font-medium transition ${
              form.wants_images === opt.value
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-slate-200 text-slate-600 hover:border-indigo-200'
            }`}>
            {opt.label}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {form.wants_images && (
          <motion.div key="image-opts" {...fadeIn} className="flex flex-col gap-3">
            <ImageSourceCards
              value={form.image_source === 'none' ? 'stock' : form.image_source}
              onChange={(v) => update('image_source', v)}
            />
            <AnimatePresence>
              {form.image_source === 'upload' && (
                <motion.div key="upload-area" {...fadeIn}>
                  <UserImagesUpload
                    files={form.user_images}
                    onChange={(files, err) => { update('user_images', files); setError(err ?? null); }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </Step>,
  ];

  return (
    <div className="min-h-screen py-6 px-4" dir="rtl" style={{ background: 'var(--bg)' }}>
      <div className="max-w-6xl mx-auto">
        {/* Page header — Lando greets and reacts to what's happening */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="lando-hover">
            <LandoBot mood={result ? 'success' : error ? 'error' : 'request'} size={96} />
          </div>
          <h1 className="text-2xl font-extrabold mt-1" style={{ color: 'var(--navy)' }}>בואו נבנה את הדף שלכם</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>ספרו ל-Pagey על העסק — והוא בונה את השאר</p>
        </div>

        {/* Two-column grid — RTL: first child = right (form), second child = left (preview) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">

          {/* ── Form column (right side in RTL) ─────────────────────────────── */}
          <div className="rounded-2xl bg-white shadow-lg shadow-slate-200/60 px-6 py-7">
            {result ? (
              /* Success state in form column */
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-6 py-8 text-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 300, delay: 0.15 }}
                  className="rounded-full bg-emerald-100 p-5 text-emerald-500"
                >
                  <CheckCircle2 size={40} />
                </motion.div>
                <div>
                  <h2 className="text-xl font-bold text-slate-800">האתר שלך מוכן! 🎉</h2>
                  <p className="mt-2 text-sm text-slate-500">
                    הדף עבור <span className="font-semibold text-slate-700">{result.business_name}</span> נוצר בהצלחה.
                  </p>
                </div>
                <Link
                  to={`/p/${result.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-xl bg-[#2E63F6] px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#1E4FD6] transition"
                >
                  <ExternalLink size={16} />
                  פתח את הדף שלי
                </Link>
                <p className="text-xs text-slate-400 font-mono">/p/{result.slug}</p>
              </motion.div>
            ) : (
              <>
                <ProgressBar current={step} total={STEPS.length} />

                <div className="relative overflow-x-hidden" style={{ minHeight: 320 }}>
                  <AnimatePresence initial={false} custom={dir} mode="wait">
                    <motion.div key={step} custom={dir} variants={slideVariants}
                      initial="enter" animate="center" exit="exit" transition={spring}>
                      {steps[step]}
                    </motion.div>
                  </AnimatePresence>
                </div>

                {error && (
                  <p className="mt-4 text-xs text-red-500 text-center rounded-lg bg-red-50 px-3 py-2">
                    {error}
                  </p>
                )}

                <div className="mt-8 flex items-center justify-between gap-3">
                  {step > 0 ? (
                    <button onClick={() => go(step - 1)}
                      className="flex items-center gap-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition">
                      <ChevronLeft size={16} />חזרה
                    </button>
                  ) : <div />}

                  {step < STEPS.length - 1 ? (
                    <button onClick={() => go(step + 1)} disabled={!canNext}
                      className="flex-1 rounded-xl bg-[#2E63F6] py-2.5 text-sm font-semibold text-white hover:bg-[#1E4FD6] disabled:opacity-40 disabled:cursor-not-allowed transition">
                      הבא
                    </button>
                  ) : (
                    <button onClick={submit} disabled={loading}
                      className="flex-1 rounded-xl bg-[#2E63F6] py-2.5 text-sm font-semibold text-white hover:bg-[#1E4FD6] disabled:opacity-80 transition flex items-center justify-center gap-2">
                      {loading ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          בונה את הדף שלך…
                        </>
                      ) : 'צור את האתר שלי ✦'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── Preview column (left side in RTL) ───────────────────────────── */}
          <div
            ref={previewRef}
            className="h-[62vh] lg:h-[calc(100vh-3.5rem)] lg:sticky lg:top-7 rounded-[2rem] overflow-hidden border-[12px] border-gray-900 shadow-2xl flex flex-col"
          >
            {/* Browser chrome bar */}
            <div className="bg-gray-900 h-7 flex items-center gap-2 px-3 flex-shrink-0">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-400/80" />
              </div>
              <span className="flex-1 text-center text-gray-500 text-[11px] font-medium truncate">
                {uiMode === 'success' && result ? `pagey.co.il/p/${result.slug}` : 'תצוגה מקדימה בזמן אמת'}
              </span>
            </div>

            {/* Preview content area */}
            <div className="flex-1 relative overflow-hidden bg-white">
              <AnimatePresence mode="wait">
                {uiMode === 'idle' && (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.25 }}
                    className="absolute inset-0 overflow-hidden"
                  >
                    <IdleSkeletonPreview
                      businessName={form.business_name}
                      designStyle={form.design_style}
                    />
                  </motion.div>
                )}

                {uiMode === 'loading' && (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="absolute inset-0"
                  >
                    <LoadingPreview designStyle={form.design_style} />
                  </motion.div>
                )}

                {uiMode === 'success' && result && (
                  <motion.div
                    key="success"
                    className="absolute inset-0"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                  >
                    <iframe
                      src={`/p/${result.slug}`}
                      className="w-full h-full border-0"
                      title="תצוגה מקדימה"
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

        </div>

        <p className="mt-6 text-center text-xs text-slate-400">מופעל על ידי Claude AI</p>
      </div>
    </div>
  );
}
