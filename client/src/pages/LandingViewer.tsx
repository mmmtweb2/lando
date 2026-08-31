import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, MapPin, Mail, Phone, Globe, Pencil, Check, ChevronDown, ExternalLink as ExternalLinkIcon, Camera, Upload, Sparkles, EyeOff, Eye, LayoutDashboard } from 'lucide-react';
import { useUser } from '../context/UserContext';
import WalletBadge from '../components/WalletBadge';
import { authFetch } from '../lib/api';
import { LandoMark } from '../components/Lando';

// ─── Types ────────────────────────────────────────────────────────────────────

type ThemeVibe = 'luxury' | 'playful' | 'warm' | 'corporate' | 'tech';
type FontStyle = 'sans' | 'serif' | 'rounded';
type StructuralLayout = 'bento' | 'editorial' | 'split' | 'classic';

interface ServiceItem {
  id: string;
  title: string;
  description: string;
  service_image_prompt?: string;  // v2 — cinematic landscape photo
  service_icon_keyword?: string;  // v2 — English keyword for 3D icon generation
  icon_prompt?: string;           // v1 compat
}

// Supports both v1 (old DB rows) and v2 (new rows) — all fields optional
interface AiContent {
  // v2
  page_strategy?: {
    detected_goal?: string;
    target_audience_emotion?: string;
    structural_layout?: StructuralLayout;
  };
  hero?: {
    title?: string;
    subtitle?: string;         // v2
    slogan?: string;           // v1 compat
    primary_cta_text?: string; // v2
    hero_image_prompt?: string;
  };
  about?: { heading?: string; content?: string };
  services_or_benefits?: ServiceItem[]; // v2
  services?: ServiceItem[];             // v1 compat
  contact?: {
    phone?: string;
    email?: string;
    address?: string;
    cta_text?: string;         // v1 compat
    whatsapp_message?: string;
    cta_type?: string;         // user-chosen CTA target: whatsapp|email|phone|link
  };
  // v2
  design_system?: {
    primary_color?: string;
    secondary_color?: string;
    accent_color?: string;
    bg_light_tint?: string;
    font_style?: FontStyle;
    image_keywords?: string[];
  };
  // v1 compat
  design_hints?: {
    primary_color?: string;
    secondary_color?: string;
    accent_color?: string;
    theme_vibe?: ThemeVibe;
    font_style?: FontStyle;
    bg_style?: { type?: 'gradient' | 'solid'; colors?: string[] };
    image_keywords?: string[];
    structural_layout?: StructuralLayout;
  };
  // long-form sections (v2+)
  benefits?: Array<{ title: string; description: string }>;
  faq?: Array<{ question: string; answer: string }>;
  process_steps?: Array<{ step_number: number; title: string; description: string }>;
  testimonials?: Array<{ quote: string; author: string; role: string }>;
  cta_banner_subline?: string;
  typography_pairing?: 'luxury' | 'tech' | 'modern_clean';
  color_palette?: { primary: string; secondary_accent: string; surface_bg: string };
  layout_composition?: string[];
  design_tokens?: {
    image_treatment?: string;
    background_effect?: string;
  };
  hidden_sections?: string[];
  // v2 — generative SEO + trust
  seo_title?: string;
  seo_description?: string;
  trust_badges?: Array<{ label: string }>;
}

// v2 AI image storage shape (stored as JSON in user_images column)
interface AiImageStore {
  hero_image_url: string | null;
  icon_urls: string[];
}

interface LandingPage {
  id: string;
  slug: string;
  business_name: string;
  phone_number: string;
  logo_url: string | null;
  user_images: string | null;
  ai_content: AiContent;
  facebook_url: string | null;
  instagram_url: string | null;
  enable_form: boolean;
  design_style?: string | null;
  isOwner?: boolean;
  status?: 'draft' | 'published' | null;
  published_at?: string | null;
  expires_at?: string | null;
  page_goal?: string | null;
  external_link?: string | null;
  whiteLabel?: boolean;
}

// Snapshot of the caller's plan + usage, fetched fresh from /api/users/plan
// right before showing the publish-confirmation modal below.
interface PlanStatus {
  plan: 'free' | 'freelancer' | 'agency';
  label: string;
  active: boolean;
  expiresAt: string | null;
  maxActivePages: number;
  activePages: number;
  monthlyCreate: number;
  createdThisPeriod: number;
  whiteLabel: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildWhatsAppUrl(phone: string, message: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  const intl = digits.startsWith('972') ? digits : `972${digits.replace(/^0/, '')}`;
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}

function sanitizeHex(color?: string): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#4f46e5';
}

function textOnColor(hex: string): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#1e293b' : '#ffffff';
}

// ─── Theme engine ─────────────────────────────────────────────────────────────

interface ThemeConfig {
  cardRadius: string;
  badgeRadius: string;
  cardBase: string;
  fallbackBg: string;
}

function getTheme(vibe?: ThemeVibe): ThemeConfig {
  switch (vibe) {
    case 'luxury':  return { cardRadius: 'rounded-none', badgeRadius: 'rounded-sm',   cardBase: 'border border-stone-200 shadow-none', fallbackBg: 'bg-stone-50' };
    case 'warm':    return { cardRadius: 'rounded-3xl',  badgeRadius: 'rounded-2xl',  cardBase: 'border border-amber-100 shadow-md',   fallbackBg: 'bg-amber-50' };
    case 'playful': return { cardRadius: 'rounded-3xl',  badgeRadius: 'rounded-full', cardBase: 'border-2 border-[#E4EAFB] shadow-md', fallbackBg: 'bg-[#EEF1FB]' };
    case 'tech':    return { cardRadius: 'rounded-lg',   badgeRadius: 'rounded-md',   cardBase: 'border border-slate-200',              fallbackBg: 'bg-slate-50' };
    default:        return { cardRadius: 'rounded-xl',   badgeRadius: 'rounded-xl',   cardBase: 'border border-slate-100 shadow-sm',   fallbackBg: 'bg-gray-50' };
  }
}

const DESIGN_STYLE_VIBE: Record<string, ThemeVibe> = {
  luxury: 'luxury',
  vibrant: 'playful',
  minimal: 'corporate',
  warm: 'warm',
};

// ─── Framer Motion variant sets ───────────────────────────────────────────────

const EASE_EXPO: [number, number, number, number] = [0.25, 1, 0.5, 1];
const EASE_SMOOTH: [number, number, number, number] = [0.16, 1, 0.3, 1];

const V = {
  bento: {
    container: { hidden: {}, visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } } },
    cell:      { hidden: { opacity: 0, scale: 0.93 }, visible: { opacity: 1, scale: 1, transition: { duration: 0.48, ease: EASE_EXPO } } },
  },
  editorial: {
    title: { hidden: { opacity: 0, y: 60 },       visible: { opacity: 1, y: 0, transition: { duration: 1.0, ease: EASE_SMOOTH } } },
    image: { hidden: { opacity: 0, scale: 1.04 }, visible: { opacity: 1, scale: 1, transition: { duration: 1.2, ease: EASE_SMOOTH } } },
    body:  { hidden: { opacity: 0, y: 40 },       visible: { opacity: 1, y: 0, transition: { duration: 0.85, ease: 'easeOut' as const } } },
  },
  split: {
    right: { hidden: { opacity: 0, x: 56 },  visible: { opacity: 1, x: 0, transition: { duration: 0.65, ease: 'easeOut' as const } } },
    left:  { hidden: { opacity: 0, x: -56 }, visible: { opacity: 1, x: 0, transition: { duration: 0.65, ease: 'easeOut' as const } } },
  },
  classic: {
    container: { hidden: {}, visible: { transition: { staggerChildren: 0.1 } } },
    item:      { hidden: { opacity: 0, y: 26 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } },
  },
};

const VIEW = { viewport: { once: true, margin: '-80px' } } as const;

// ─── WhatsApp SVG icon ────────────────────────────────────────────────────────

function WhatsAppIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

// ─── Image cell (graceful fallback when no image) ─────────────────────────────

function ImgCell({ src, className = '', style, alt = '' }: { src?: string; className?: string; style?: React.CSSProperties; alt?: string }) {
  if (src) return <img src={src} alt={alt} className={`object-cover ${className}`} style={style} />;
  return (
    <div className={`flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 ${className}`} style={style}>
      <svg viewBox="0 0 80 80" className="w-14 h-14 opacity-20" fill="#64748b">
        <rect x="8" y="8" width="64" height="64" rx="8" />
        <circle cx="28" cy="30" r="8" fill="#ffffff" />
        <path d="M8 55 L28 38 L44 52 L58 40 L72 55 Z" fill="#ffffff" />
      </svg>
    </div>
  );
}

// ─── Brand pattern placeholder (shown when no image URL is available) ────────

function BrandPatternPlaceholder({
  primaryColor,
  secondaryColor,
  logoUrl,
  className = '',
  style,
}: {
  primaryColor: string;
  secondaryColor: string;
  logoUrl?: string | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`overflow-hidden ${/\babsolute\b/.test(className) ? '' : 'relative'} ${className}`}
      style={{
        background: `linear-gradient(145deg, ${primaryColor}12 0%, ${secondaryColor}1e 60%, ${primaryColor}08 100%)`,
        ...style,
      }}
    >
      {/* Soft radial glows */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `radial-gradient(ellipse at 20% 80%, ${primaryColor}20 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, ${secondaryColor}24 0%, transparent 50%)`,
      }} />
      {/* Decorative circle top-right */}
      <div className="absolute -top-1/3 -right-1/4 w-3/4 aspect-square rounded-full pointer-events-none" style={{
        background: `radial-gradient(circle, ${primaryColor}16 0%, transparent 70%)`,
      }} />
      {/* Decorative circle bottom-left */}
      <div className="absolute -bottom-1/4 -left-1/4 w-1/2 aspect-square rounded-full pointer-events-none" style={{
        background: `radial-gradient(circle, ${secondaryColor}16 0%, transparent 70%)`,
      }} />
      {/* Subtle diagonal stripe texture */}
      <div className="absolute inset-0 pointer-events-none" style={{
        opacity: 0.035,
        backgroundImage: `repeating-linear-gradient(45deg, ${primaryColor} 0px, ${primaryColor} 1px, transparent 1px, transparent 20px)`,
      }} />
      {/* Frosted inner highlight */}
      <div className="absolute inset-3 rounded-xl pointer-events-none" style={{
        border: '1px solid rgba(255,255,255,0.22)',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 100%)',
      }} />
      {/* Logo watermark */}
      {logoUrl && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <img src={logoUrl} alt="" className="w-16 h-16 object-contain" style={{ opacity: 0.12 }} />
        </div>
      )}
    </div>
  );
}

// ─── Editable image — hover effects + camera button when in edit mode ────────

function EditableImage({
  src,
  primaryColor,
  secondaryColor,
  logoUrl,
  className = '',
  style,
  isEditingMode,
  canEdit,
  onEditClick,
  darken = false,
}: {
  src?: string | null;
  primaryColor: string;
  secondaryColor: string;
  logoUrl?: string | null;
  className?: string;
  style?: React.CSSProperties;
  isEditingMode: boolean;
  canEdit: boolean;
  onEditClick: () => void;
  darken?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const editable = isEditingMode && canEdit;

  return (
    <div
      className={`overflow-hidden ${/\babsolute\b/.test(className) ? '' : 'relative'} ${className}`}
      style={style}
      onMouseEnter={() => editable && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {src ? (
        <>
          <motion.img
            key={src}
            src={src}
            alt=""
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="w-full h-full object-cover"
            style={{ transform: hovered && editable ? 'scale(1.04)' : 'scale(1)', transition: 'transform 0.5s cubic-bezier(0.25,1,0.5,1)' }}
          />
          {darken && <div className="absolute inset-0 bg-black/55" />}
        </>
      ) : (
        <BrandPatternPlaceholder
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          logoUrl={logoUrl}
          className="w-full h-full"
        />
      )}

      {editable && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: hovered ? 1 : 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-20 pointer-events-none"
            style={{ backgroundColor: `${primaryColor}55` }}
          />
          <button
            onClick={onEditClick}
            className="absolute top-3 right-3 z-30 flex items-center gap-1.5 px-3 py-2 rounded-full text-white text-xs font-bold shadow-lg backdrop-blur-sm transition-colors duration-200"
            style={{ backgroundColor: hovered ? `${primaryColor}ee` : 'rgba(0,0,0,0.55)' }}
          >
            <Camera size={13} />
            שנה תמונה
          </button>
        </>
      )}
    </div>
  );
}

// ─── Image selector modal — upload or AI regenerate ───────────────────────────

function ImageSelectorModal({
  isOpen,
  pageId,
  slot,
  initialPrompt,
  credits,
  primaryColor,
  onClose,
  onImageUpdated,
}: {
  isOpen: boolean;
  pageId: string;
  slot: string;
  initialPrompt: string;
  credits: number;
  primaryColor: string;
  onClose: () => void;
  onImageUpdated: (url: string, userImages: string) => void;
}) {
  const [step, setStep] = useState<'choose' | 'ai-prompt'>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptText, setPromptText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setStep('choose');
      setBusy(false);
      setError(null);
      setPromptText(initialPrompt);
    }
  }, [isOpen, initialPrompt]);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('slot', slot);
      const r = await authFetch(`/api/landing/${pageId}/update-image-upload`, { method: 'POST', body: fd });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'שגיאה בהעלאת התמונה');
      }
      const data = await r.json() as { url: string; user_images: string };
      onImageUpdated(data.url, data.user_images);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בהעלאת התמונה');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleAiRegenerate() {
    if (!promptText.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await authFetch(`/api/landing/${pageId}/regenerate-image-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot, prompt: promptText.trim() }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'שגיאה ביצירת תמונה');
      }
      const data = await r.json() as { url: string; user_images: string };
      onImageUpdated(data.url, data.user_images);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה ביצירת תמונה');
    } finally {
      setBusy(false);
    }
  }

  // Regenerate ALL images as one coherent set (4 credits). The backend rebuilds
  // hero + service icons from the stored prompts in the same style.
  async function handleFullSet() {
    if (busy || credits < 4) return;
    // 4 credits, and it replaces EVERY image on the page (hero + all service
    // images) — including images the user uploaded themselves. Confirm the
    // cost and the consequence before spending.
    const confirmed = window.confirm(
      `יצירת סט תמונות מלא תנכה 4 קרדיטים (יתרה נוכחית: ${credits}) ותחליף את כל התמונות בדף, כולל תמונות שהעליתם. להמשיך?`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const r = await authFetch(`/api/landing/${pageId}/regenerate-image-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFullSet: true }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'שגיאה ביצירת הסט');
      }
      const data = await r.json() as { url: string; user_images: string };
      onImageUpdated(data.url, data.user_images);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה ביצירת הסט');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-black/65 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-sm rounded-3xl bg-white shadow-2xl overflow-hidden"
            dir="rtl"
          >
            <div className="h-1.5 w-full" style={{ backgroundColor: primaryColor }} />

            <div className="p-6 flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-extrabold text-slate-900">
                  {step === 'ai-prompt' ? 'יצירת תמונה עם AI' : 'שינוי תמונה'}
                </h3>
                {!busy && (
                  <button
                    onClick={step === 'ai-prompt' ? () => setStep('choose') : onClose}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition text-lg leading-none"
                  >
                    {step === 'ai-prompt' ? '←' : '×'}
                  </button>
                )}
              </div>

              {step === 'choose' ? (
                <div className="flex flex-col gap-3">
                  <button
                    disabled={busy}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-4 p-4 rounded-2xl border-2 border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 transition text-right disabled:opacity-50"
                  >
                    <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-sm flex-shrink-0">
                      <Upload size={22} className="text-slate-500" />
                    </div>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-bold text-slate-800 text-sm">העלאת תמונה</span>
                      <span className="text-xs text-slate-500 leading-tight">JPG, PNG עד 10MB</span>
                    </div>
                  </button>

                  <button
                    disabled={busy || credits < 1}
                    onClick={() => setStep('ai-prompt')}
                    className="flex items-center gap-4 p-4 rounded-2xl border-2 transition text-right disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      borderColor: credits >= 1 ? primaryColor : '#e2e8f0',
                      backgroundColor: credits >= 1 ? `${primaryColor}08` : undefined,
                    }}
                  >
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0"
                      style={{ backgroundColor: credits >= 1 ? primaryColor : '#e2e8f0' }}>
                      <Sparkles size={22} color={credits >= 1 ? '#fff' : '#94a3b8'} />
                    </div>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-bold text-slate-800 text-sm">יצירה עם AI (1 ✦)</span>
                      <span className="text-xs leading-tight" style={{ color: credits >= 1 ? primaryColor : '#94a3b8' }}>
                        {credits >= 1 ? `${credits} קרדיטים זמינים` : 'אין קרדיטים'}
                      </span>
                    </div>
                  </button>

                  <button
                    disabled={busy || credits < 4}
                    onClick={handleFullSet}
                    title="יצירה מחדש של כל התמונות בסגנון אחיד"
                    className="flex items-center gap-4 p-4 rounded-2xl border-2 transition text-right disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      borderColor: credits >= 4 ? primaryColor : '#e2e8f0',
                      backgroundColor: credits >= 4 ? `${primaryColor}08` : undefined,
                    }}
                  >
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0"
                      style={{ backgroundColor: credits >= 4 ? primaryColor : '#e2e8f0' }}>
                      <Sparkles size={22} color={credits >= 4 ? '#fff' : '#94a3b8'} />
                    </div>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-bold text-slate-800 text-sm">צור סט תמונות מלא (4 ✦)</span>
                      <span className="text-xs leading-tight" style={{ color: credits >= 4 ? primaryColor : '#94a3b8' }}>
                        {credits >= 4 ? 'יוצר את כל התמונות בסגנון אחיד' : 'דרושים 4 קרדיטים'}
                      </span>
                    </div>
                  </button>
                </div>
              ) : busy ? (
                <div className="flex flex-col items-center gap-4 py-6">
                  <motion.div
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                    className="w-16 h-16 rounded-2xl flex items-center justify-center"
                    style={{ backgroundColor: `${primaryColor}15` }}
                  >
                    <Sparkles size={32} style={{ color: primaryColor }} />
                  </motion.div>
                  <p className="text-sm font-semibold text-slate-700">מייצר תמונה...</p>
                  <p className="text-xs text-slate-400 text-center leading-relaxed">זה עשוי לקחת מספר שניות</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-slate-700">תאר את התמונה הרצויה</label>
                    <textarea
                      rows={4}
                      value={promptText}
                      onChange={(e) => setPromptText(e.target.value)}
                      placeholder="לדוגמה: תמונת לנדסקייפ מקצועית של מטבח מודרני..."
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:ring-2 transition resize-none"
                      style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                      dir="rtl"
                    />
                  </div>
                  <button
                    onClick={handleAiRegenerate}
                    disabled={!promptText.trim()}
                    className="w-full py-3 rounded-xl text-sm font-bold text-white transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ backgroundColor: primaryColor }}
                  >
                    <Sparkles size={16} />
                    צור תמונה
                  </button>
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 text-center">
                  {error}
                </div>
              )}
            </div>

            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelected} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Section editor wrapper — hide/show toggle in edit mode ──────────────────

function SectionEditorWrapper({
  children,
  isEditing,
  isHidden,
  label,
  onToggleHide,
}: {
  children: React.ReactNode;
  isEditing: boolean;
  isHidden: boolean;
  label: string;
  onToggleHide: () => void;
}) {
  if (!isEditing && isHidden) return null;

  if (isHidden) {
    return (
      <div className="mx-4 my-1 px-5 py-3 flex items-center justify-between rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/80">
        <span className="text-sm text-slate-400">
          מוסתר: <span className="font-semibold text-slate-500">{label}</span>
        </span>
        <button
          onClick={onToggleHide}
          className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 transition shadow-sm"
        >
          <Eye size={13} />
          הצג
        </button>
      </div>
    );
  }

  return (
    <div className="relative group/section">
      {children}
      {isEditing && (
        <button
          onClick={onToggleHide}
          title="הסתר סקציה"
          className="absolute top-3 left-3 z-[25] opacity-100 md:opacity-0 md:group-hover/section:opacity-100 transition-all duration-150 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/45 hover:bg-red-500 text-white text-xs font-bold shadow-lg backdrop-blur-sm"
        >
          <EyeOff size={12} />
          הסתר
        </button>
      )}
    </div>
  );
}

// ─── Editable text — renders plain when not editing, contentEditable when editing ─

function EditableText({
  as: Tag = 'span',
  value,
  onCommit,
  isEditing,
  className = '',
  style,
}: {
  as?: string;
  value: string;
  onCommit: (text: string) => void;
  isEditing: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const elRef = useRef<HTMLElement>(null);

  // Sync text content when entering edit mode AND when `value` changes externally
  // (e.g. after an AI rewrite). Skip while THIS field is focused so active typing
  // isn't reset on every keystroke.
  useLayoutEffect(() => {
    if (isEditing && elRef.current && document.activeElement !== elRef.current) {
      elRef.current.textContent = value;
    }
  }, [isEditing, value]);

  if (!isEditing) {
    const Static = Tag as React.ElementType;
    return <Static className={className} style={style}>{value}</Static>;
  }

  return React.createElement(Tag as string, {
    ref: elRef,
    className,
    style: {
      ...style,
      cursor: 'text',
      outline: 'none',
      boxShadow: 'inset 0 0 0 2px rgba(148,163,184,0.45)',
      borderRadius: '4px',
      minWidth: '2ch',
    },
    contentEditable: true,
    suppressContentEditableWarning: true,
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      e.currentTarget.style.boxShadow = 'inset 0 0 0 2px rgb(99,102,241)';
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      e.currentTarget.style.boxShadow = 'inset 0 0 0 2px rgba(148,163,184,0.45)';
      const text = (e.currentTarget.textContent ?? '').trim();
      onCommit(text);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); }
      if (e.key === 'Escape') (e.currentTarget as HTMLElement).blur();
    },
  });
}

// ─── AccentedHeroTitle — last word of hero title in accent color (view mode only) ─

function AccentedHeroTitle({
  value,
  onCommit,
  isEditing,
  className = '',
  style,
  accentColor,
}: {
  value: string;
  onCommit: (text: string) => void;
  isEditing: boolean;
  className?: string;
  style?: React.CSSProperties;
  accentColor: string;
}) {
  if (isEditing) {
    return <EditableText as="h1" value={value} onCommit={onCommit} isEditing={isEditing} className={className} style={style} />;
  }
  const words = value.split(' ');
  const lastWord = words.pop();
  const rest = words.join(' ');
  return (
    <h1 className={className} style={style}>
      {rest && <>{rest} </>}
      <span style={{ color: accentColor }}>{lastWord}</span>
    </h1>
  );
}

// ─── applyEdits — merge flat edit paths back into a deep AiContent clone ─────

function applyEdits(content: AiContent, changes: Record<string, string>): AiContent {
  const next = JSON.parse(JSON.stringify(content)) as AiContent;
  for (const [path, value] of Object.entries(changes)) {
    // Special case: "services.N.field" applies to whichever array exists
    if (path.startsWith('services.')) {
      const parts = path.split('.');
      const idx = parseInt(parts[1], 10);
      const field = parts[2] as 'title' | 'description';
      const arr = next.services_or_benefits ?? next.services;
      if (arr && arr[idx]) arr[idx][field] = value;
      continue;
    }
    if (path.startsWith('testimonials.')) {
      const parts = path.split('.');
      const idx = parseInt(parts[1], 10);
      const field = parts[2] as 'quote' | 'author' | 'role';
      if (next.testimonials?.[idx]) next.testimonials[idx][field] = value;
      continue;
    }
    if (path.startsWith('faq.')) {
      const parts = path.split('.');
      const idx = parseInt(parts[1], 10);
      const field = parts[2] as 'question' | 'answer';
      if (next.faq?.[idx]) next.faq[idx][field] = value;
      continue;
    }
    if (path.startsWith('benefits.')) {
      const parts = path.split('.');
      const idx = parseInt(parts[1], 10);
      const field = parts[2] as 'title' | 'description';
      if (next.benefits?.[idx]) next.benefits[idx][field] = value;
      continue;
    }
    if (path.startsWith('process_steps.')) {
      const parts = path.split('.');
      const idx = parseInt(parts[1], 10);
      const field = parts[2] as 'title' | 'description';
      if (next.process_steps?.[idx]) next.process_steps[idx][field] = value;
      continue;
    }
    // Generic dot-path write
    const parts = path.split('.');
    let obj = next as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]] || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {};
      obj = obj[parts[i]] as Record<string, unknown>;
    }
    obj[parts[parts.length - 1]] = value;
  }
  return next;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LandingViewer() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useUser();
  const [page, setPage] = useState<LandingPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leadName, setLeadName] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadMessage, setLeadMessage] = useState('');
  const [leadSent, setLeadSent] = useState(false);
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);

  // ── Inline editor state ──────────────────────────────────────────────────
  const [isEditingMode, setIsEditingMode] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // ── Checkout / paywall state ─────────────────────────────────────────────
  // 'loadingPlan' — fetching a fresh plan snapshot before deciding what to show.
  // 'confirm'     — plan covers this publish; explicit user confirmation required before it fires.
  // 'limitReached'— plan is active but its live-page slots are full; offer an upgrade.
  // 'modal'       — no active plan (or plan status couldn't be read); explains + falls back to the paid SUMIT flow.
  // 'paying'      — the publish/payment call is in flight.
  // 'done'        — published; confirmation shown to the user.
  const [checkoutStatus, setCheckoutStatus] =
    useState<'idle' | 'loadingPlan' | 'confirm' | 'confirmPaying' | 'limitReached' | 'modal' | 'paying' | 'done'>('idle');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  // Plan snapshot fetched fresh each time the publish flow opens, so the numbers
  // shown in the confirmation modal are never stale.
  const [planStatus, setPlanStatus] = useState<PlanStatus | null>(null);

  // ── Wallet credits ────────────────────────────────────────────────────────
  const [credits, setCredits] = useState<number>(0);
  const [creditsRefreshKey, setCreditsRefreshKey] = useState<number>(0);
  const [rewriteStatus, setRewriteStatus] = useState<'idle' | 'rewriting'>('idle');
  const [colorOverrides, setColorOverrides] = useState<{ primary?: string; accent?: string }>({});

  // ── FAQ accordion open index ──────────────────────────────────────────────
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // ── Inline image editor state ─────────────────────────────────────────────
  const [imageModalSlot, setImageModalSlot] = useState<string | null>(null);
  const [imageModalPrompt, setImageModalPrompt] = useState('');

  // ── Section visibility (hidden_sections synced from page.ai_content) ──────
  const [hiddenSections, setHiddenSections] = useState<string[]>([]);

  useEffect(() => {
    if (!slug) return;
    authFetch(`/api/landing/${slug}`)
      .then((r) => {
        if (r.status === 404) throw new Error('הדף לא נמצא');
        if (!r.ok) throw new Error('שגיאה בטעינת הדף');
        return r.json() as Promise<LandingPage>;
      })
      .then(setPage)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (page) setHiddenSections(page.ai_content.hidden_sections ?? []);
  }, [page]);

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
      <Loader2 size={36} className="animate-spin text-[#2E63F6]" />
      <p className="text-sm text-slate-500" dir="rtl">טוען את הדף...</p>
    </div>
  );

  if (error || !page) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center" dir="rtl">
      <p className="text-5xl">😕</p>
      <h1 className="text-xl font-bold text-slate-700">{error ?? 'הדף לא נמצא'}</h1>
      <Link to="/create" className="mt-2 text-sm text-[#2E63F6] hover:underline">← צור דף חדש</Link>
    </div>
  );

  const { ai_content, business_name, phone_number, logo_url, user_images, facebook_url, instagram_url, enable_form, design_style, whiteLabel } = page;

  const canEdit =
    !!page.isOwner ||
    sessionStorage.getItem('admin_authed') === 'true';

  // status === 'draft' means explicitly drafted; null/undefined = legacy rows (treat as published)
  const isDraft = page.status === 'draft';
  // Extra top padding when the draft banner is visible
  const layoutPt = isDraft ? 'pt-28' : 'pt-16';

  // ── Inline editor helpers ────────────────────────────────────────────────
  const getEdit = (path: string, fallback: string): string =>
    edits[path] !== undefined ? edits[path] : fallback;

  const setEdit = (path: string, value: string) =>
    setEdits((prev) => ({ ...prev, [path]: value }));

  // Opens the publish flow from a "Publish" click. Always fetches a FRESH plan
  // snapshot first (never trusts stale state) so the confirmation the user sees
  // reflects their actual balance at this exact moment, then routes to the right
  // screen — never straight to a charge or a silent publish.
  async function openPublishFlow() {
    if (!page) return;
    setCheckoutStatus('loadingPlan');
    setCheckoutError(null);
    try {
      const r = await authFetch('/api/users/plan');
      if (!r.ok) throw new Error('plan fetch failed');
      const data = await r.json() as { status: PlanStatus };
      setPlanStatus(data.status);
      if (data.status.active && data.status.activePages < data.status.maxActivePages) {
        // Covered by an active plan with a free slot — show the explicit
        // confirmation screen; nothing is published until the user confirms.
        setCheckoutStatus('confirm');
      } else if (data.status.active) {
        // Active plan, but no free live-page slot left — offer to upgrade
        // rather than silently charging per page.
        setCheckoutStatus('limitReached');
      } else {
        // No active plan — explain why a charge is coming, then the existing
        // paid SUMIT flow below (still requires its own explicit click).
        setCheckoutStatus('modal');
      }
    } catch {
      // Couldn't read plan status — fail safe into the existing paid flow.
      // checkout() below still re-checks plan coverage server-side before any
      // charge, so a plan holder is never charged even if this fetch failed.
      setPlanStatus(null);
      setCheckoutStatus('modal');
    }
  }

  // Fires only after the user explicitly clicks "Confirm & publish" on the
  // plan-coverage confirmation screen. Publishes under the plan (no charge);
  // on a race (plan lapsed / slot filled between opening the modal and this
  // click) it re-routes to the correct explanation instead of ever redirecting
  // straight to payment without a fresh confirmation step.
  async function confirmPlanPublish() {
    if (!page) return;
    setCheckoutStatus('confirmPaying');
    setCheckoutError(null);
    try {
      const planRes = await authFetch(`/api/landing/${page.id}/publish`, { method: 'POST' });
      if (planRes.ok) {
        setPage((prev) => (prev ? { ...prev, status: 'published' } : prev));
        setCheckoutStatus('done');
        return;
      }
      if (planRes.status !== 402) {
        const b = await planRes.json().catch(() => ({})) as { error?: string };
        throw new Error(b.error ?? 'הפרסום נכשל. נסו שוב.');
      }
      const planBody = await planRes.json().catch(() => ({})) as { reason?: string; error?: string };
      if (planBody.reason === 'active_limit_reached') {
        setCheckoutError(planBody.error ?? 'הגעת למספר הדפים הפעילים המרבי במסלול שלך.');
        setCheckoutStatus('limitReached');
        return;
      }
      setCheckoutError('המסלול שלך כבר אינו פעיל, ולכן הפרסום לא כוסה ללא תשלום.');
      setCheckoutStatus('modal');
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : 'הפרסום נכשל. נסו שוב.');
      setCheckoutStatus('confirm');
    }
  }

  async function checkout() {
    if (!page) return;
    setCheckoutStatus('paying');
    setCheckoutError(null);
    try {
      // Safety net: even from the paid-flow modal, try the free-plan-publish
      // path first in case plan coverage appeared since this modal opened
      // (e.g. another tab activated a plan) — a plan holder is never charged.
      const planRes = await authFetch(`/api/landing/${page.id}/publish`, { method: 'POST' });
      if (planRes.ok) {
        setPage((prev) => (prev ? { ...prev, status: 'published' } : prev));
        setCheckoutStatus('done');
        return;
      }
      if (planRes.status !== 402) {
        const b = await planRes.json().catch(() => ({})) as { error?: string };
        throw new Error(b.error ?? 'הפרסום נכשל. נסו שוב.');
      }
      // 402 → not covered by a plan. If the plan's live-page slots are full,
      // prompt to upgrade rather than charging per page.
      const planBody = await planRes.json().catch(() => ({})) as { reason?: string; error?: string };
      if (planBody.reason === 'active_limit_reached') {
        setCheckoutError(planBody.error ?? 'הגעת למספר הדפים הפעילים המרבי במסלול שלך.');
        setCheckoutStatus('limitReached');
        return;
      }

      // No active plan → per-page SUMIT payment (existing flow). We get back a
      // secure redirect URL; publishing happens server-side after verification,
      // so we never handle card data ourselves.
      const r = await authFetch('/api/payments/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'publish', reference: page.id }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(b.error ?? 'פתיחת התשלום נכשלה. נסו שוב.');
      }
      const data = await r.json() as { redirectUrl: string };
      window.location.href = data.redirectUrl;
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : 'פתיחת התשלום נכשלה. נסו שוב.');
      setCheckoutStatus('modal');
    }
  }

  function openImageModal(slot: string) {
    let prompt = '';
    if (slot === 'hero') {
      prompt = ai_content.hero?.hero_image_prompt ?? `${business_name} - תמונה ראשית מקצועית`;
    } else {
      const idx = parseInt(slot.replace('service_', ''), 10);
      const svc = (ai_content.services_or_benefits ?? ai_content.services ?? [])[idx];
      prompt = svc?.service_image_prompt ?? svc?.icon_prompt ?? `${svc?.title ?? ''} - תמונה מקצועית`;
    }
    setImageModalPrompt(prompt);
    setImageModalSlot(slot);
  }

  function handleImageUpdated(url: string, userImages: string) {
    void url;
    setPage((prev) => prev ? { ...prev, user_images: userImages } : prev);
    setCreditsRefreshKey((k) => k + 1);
  }

  async function save() {
    if (!page) return;
    setSaveStatus('saving');
    const updated = applyEdits(page.ai_content, edits);
    // Merge global palette edits (primary drives both primary+secondary for coherence).
    if (colorOverrides.primary) {
      updated.design_system = { ...updated.design_system, primary_color: colorOverrides.primary, secondary_color: colorOverrides.primary };
    }
    if (colorOverrides.accent) {
      updated.design_system = { ...updated.design_system, accent_color: colorOverrides.accent };
      updated.color_palette = {
        primary: updated.color_palette?.primary ?? primary,
        secondary_accent: colorOverrides.accent,
        surface_bg: updated.color_palette?.surface_bg ?? '#ffffff',
      };
    }
    try {
      const r = await authFetch(`/api/landing/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_content: updated }),
      });
      if (!r.ok) throw new Error('save failed');
      const data = await r.json() as Pick<LandingPage, 'ai_content'>;
      setPage((prev) => prev ? { ...prev, ai_content: data.ai_content } : prev);
      setEdits({});
      setColorOverrides({});
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }

  // AI rewrite: scope 'hero' = the main heading (1 credit), 'all' = full page (3 credits).
  async function handleRewrite(scope: 'hero' | 'all') {
    if (!page || !user?.email || rewriteStatus === 'rewriting') return;
    // A full-page rewrite is the most expensive AND the most destructive AI
    // action in the editor: 3 credits, and it replaces every section's text
    // with freshly generated copy (any manual wording is lost). Nothing should
    // spend that on a single stray click — say the price and the consequence
    // out loud first, the way the publish flow does before a charge.
    if (scope === 'all') {
      const confirmed = window.confirm(
        `כתיבה מחדש של כל הדף תנכה 3 קרדיטים (יתרה נוכחית: ${credits}) ותחליף את כל הטקסטים בדף בתוכן חדש שנוצר על ידי ה-AI. שינויים שכתבתם ידנית יידרסו. להמשיך?`,
      );
      if (!confirmed) return;
    }
    setRewriteStatus('rewriting');
    try {
      const r = await authFetch(`/api/landing/${page.id}/regenerate-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No `email` field: the server charges the page's owner, resolved from
        // the page row itself, never from a client-supplied identifier.
        body: JSON.stringify({
          sectionName: scope === 'all' ? 'all' : 'hero',
          cost: scope === 'all' ? 3 : 1,
        }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(b.error ?? 'שגיאה בכתיבה מחדש');
      }
      const data = await r.json() as { ai_content: AiContent; credits: number };
      setPage((prev) => (prev ? { ...prev, ai_content: data.ai_content } : prev));
      setCredits(data.credits);
      setCreditsRefreshKey((k) => k + 1);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'שגיאה בכתיבה מחדש');
    } finally {
      setRewriteStatus('idle');
    }
  }

  async function toggleSectionVisibility(blockId: string) {
    if (!page) return;
    const newHidden = hiddenSections.includes(blockId)
      ? hiddenSections.filter((id) => id !== blockId)
      : [...hiddenSections, blockId];
    setHiddenSections(newHidden);
    setPage((prev) => prev ? { ...prev, ai_content: { ...prev.ai_content, hidden_sections: newHidden } } : prev);
    void authFetch(`/api/landing/${page.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ai_content: { ...page.ai_content, hidden_sections: newHidden } }),
    });
  }

  // ── Parse user_images: detect v1 (string[]) vs v2 ({ hero_image_url, icon_urls }) ──
  let heroImageUrl: string | null = null;
  let iconUrls: string[] = [];
  let legacyImages: string[] = []; // v1: upload/stock array

  const parsedImages = (() => {
    if (!user_images) return null;
    try { return JSON.parse(user_images); } catch { return null; }
  })();

  if (Array.isArray(parsedImages)) {
    // v1: upload or stock — array of landscape URLs
    legacyImages = parsedImages;
    heroImageUrl = parsedImages[0] ?? null;
    iconUrls = parsedImages.slice(2, 5);
  } else if (parsedImages && typeof parsedImages === 'object') {
    // v2: AI-generated structured store
    const store = parsedImages as AiImageStore;
    heroImageUrl = store.hero_image_url ?? null;
    iconUrls = store.icon_urls ?? [];
  }

  const isAiFormat = !Array.isArray(parsedImages) && parsedImages !== null;

  // ── Derive palette & layout (supports v1 design_hints and v2 design_system) ──
  const ds    = ai_content.design_system;
  const hints = ai_content.design_hints;

  const primary   = sanitizeHex(colorOverrides.primary ?? ds?.primary_color   ?? hints?.primary_color);
  const secondary = sanitizeHex(colorOverrides.primary ?? ds?.secondary_color ?? hints?.secondary_color);
  const accent    = sanitizeHex(colorOverrides.accent  ?? ds?.accent_color    ?? hints?.accent_color);
  const onPrimary = textOnColor(primary);

  const fontRaw  = ds?.font_style ?? hints?.font_style;
  const fontClass = fontRaw === 'serif' ? 'font-serif' : 'font-sans';

  const structural: StructuralLayout =
    ai_content.page_strategy?.structural_layout ??
    hints?.structural_layout ??
    'classic';

  const vibe: ThemeVibe =
    hints?.theme_vibe ??
    DESIGN_STYLE_VIBE[design_style ?? ''] ??
    'corporate';

  const theme = getTheme(vibe);

  // Design token–driven card style: glassmorphism (default) vs flat clean
  const cardGlass = ai_content.design_tokens?.background_effect === 'clean'
    ? 'bg-white border border-slate-100 shadow-sm'
    : 'bg-white/80 backdrop-blur-md border border-white/60 shadow-lg';

  // Design token derived variables
  const backgroundEffect = ai_content.design_tokens?.background_effect ?? 'glassmorphism';
  const imageTreatment   = ai_content.design_tokens?.image_treatment   ?? 'rounded';

  // image_treatment → border-radius applied to content image containers
  const imgTreatmentStyle: React.CSSProperties =
    imageTreatment === 'sharp_edges' || imageTreatment === 'full_bleed'
      ? { borderRadius: 0 }
      : imageTreatment === 'organic_blob'
      ? { borderRadius: '60% 40% 55% 45% / 55% 45% 55% 45%', overflow: 'hidden' }
      : {};

  // Section background: v2 uses a single bg_light_tint; v1 uses bg_style gradient
  const bgLightTint = ds?.bg_light_tint;
  const bgColors    = (hints?.bg_style?.colors ?? []).map(sanitizeHex);

  // Alternating section backgrounds create distinct "zones" as you scroll.
  // For v2 pages (single light tint) we alternate white ↔ tint instead of using
  // the same tint for every band — otherwise the whole page reads as one flat surface.
  let sectionBg: React.CSSProperties | undefined = bgLightTint
    ? { backgroundColor: '#ffffff' }
    : bgColors.length >= 2
      ? { backgroundImage: `linear-gradient(135deg, ${bgColors[0]}, ${bgColors[1]})` }
      : bgColors.length === 1
        ? { backgroundColor: bgColors[0] }
        : { backgroundColor: '#ffffff' };

  let sectionBgAlt: React.CSSProperties | undefined = bgLightTint
    ? { backgroundColor: bgLightTint }
    : bgColors.length >= 2
      ? { backgroundImage: `linear-gradient(135deg, ${bgColors[1]}, ${bgColors[0]})` }
      : { backgroundColor: '#f1f5f9' };

  // background_effect: 'textured' → layer a subtle dot grid over every section bg
  if (backgroundEffect === 'textured') {
    const dotLayer = `radial-gradient(circle, ${primary}20 1px, transparent 0)`;
    const addDots = (bg?: React.CSSProperties): React.CSSProperties => {
      const base = bg ?? { backgroundColor: '#f8fafc' };
      const existingImage = base.backgroundImage ?? 'none';
      return { ...base, backgroundImage: `${dotLayer}, ${existingImage}`, backgroundSize: '22px 22px, auto' };
    };
    sectionBg = addDots(sectionBg);
    sectionBgAlt = addDots(sectionBgAlt);
  }

  const isDark = !bgLightTint && bgColors[0] ? textOnColor(bgColors[0]) === '#ffffff' : false;
  const clrHead  = isDark ? '#f1f5f9' : '#1e293b';
  const clrBody  = isDark ? '#cbd5e1' : '#475569';
  const clrMuted = isDark ? '#94a3b8' : '#64748b';

  const typographyPairing = ai_content.typography_pairing ?? 'modern_clean';
  const FONT_PAIRS = {
    luxury:       { heading: '"Frank Ruhl Libre"', body: '"Assistant"' },
    tech:         { heading: '"Heebo"',             body: '"Heebo"' },
    modern_clean: { heading: '"Rubik"',             body: '"Heebo"' },
  } as const;
  const { heading: headingFont, body: bodyFont } = FONT_PAIRS[typographyPairing];
  const secondaryAccent = sanitizeHex(
    colorOverrides.accent ?? ai_content.color_palette?.secondary_accent ?? ds?.accent_color ?? hints?.accent_color
  );

  // Unify services list: v2 = services_or_benefits, v1 = services
  const services = ai_content.services_or_benefits ?? ai_content.services ?? [];

  // CTA text: v2 primary_cta_text, v1 contact.cta_text
  const ctaText = ai_content.hero?.primary_cta_text ?? ai_content.contact?.cta_text ?? 'צרו קשר עכשיו';

  // Hero tagline: v2 subtitle, v1 slogan
  const heroTagline = ai_content.hero?.subtitle ?? ai_content.hero?.slogan;

  const heroBg = vibe === 'tech'
    ? `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`
    : `linear-gradient(150deg, ${primary} 0%, ${secondary}cc 100%)`;

  // White hero text only reads if BOTH gradient ends are dark; otherwise (light
  // palette) the gradient has light regions and white text vanishes — use dark text.
  const heroOnGradient =
    textOnColor(primary) === '#ffffff' && textOnColor(secondary) === '#ffffff' ? '#ffffff' : '#1e293b';
  const heroCtaOverride = {
    color: heroOnGradient,
    background: heroOnGradient === '#ffffff' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.06)',
    border: `2px solid ${heroOnGradient === '#ffffff' ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.2)'}`,
  };

  const techCard = vibe === 'tech'
    ? { boxShadow: `0 4px 24px ${primary}22`, backgroundImage: `linear-gradient(135deg, #ffffff, ${primary}0a)` }
    : undefined;

  const phone = ai_content.contact?.phone || phone_number;
  const ctaEmail = ai_content.contact?.email || '';
  const waUrl = buildWhatsAppUrl(phone, ai_content.contact?.whatsapp_message ?? `שלום, מצאתי את הדף של ${business_name} ואשמח לקבל פרטים.`);

  // Primary CTA target chosen by the user (whatsapp/email/phone/link). Falls back to
  // legacy behavior (external link for donation/direct_sale, else WhatsApp).
  const ctaMethod: 'whatsapp' | 'email' | 'phone' | 'link' =
    (ai_content.contact?.cta_type as 'whatsapp' | 'email' | 'phone' | 'link' | undefined)
    ?? (page.external_link && (page.page_goal === 'donation' || page.page_goal === 'direct_sale') ? 'link' : 'whatsapp');

  // Cascades to whatever contact method the business actually provided,
  // instead of ever producing a dead wa.me/tel: link when the chosen
  // method's field is empty (e.g. cta_type is 'whatsapp'/'phone' but no
  // phone was ever set) — '#' is the last resort only when NOTHING usable
  // was provided at all.
  const primaryCtaHref =
    (ctaMethod === 'email' && ctaEmail ? `mailto:${ctaEmail}`
    : ctaMethod === 'phone' && phone ? `tel:${phone}`
    : ctaMethod === 'link' && page.external_link ? page.external_link
    : waUrl)
    ?? (ctaEmail ? `mailto:${ctaEmail}` : phone ? `tel:${phone}` : page.external_link ?? '#');

  // Non-WhatsApp methods use the brand-color styling; WhatsApp keeps its green.
  const useExternalLink = ctaMethod !== 'whatsapp';

  const btnR = vibe === 'luxury' ? '2px' : vibe === 'tech' ? '8px' : '14px';

  const divider = <div className="w-12 h-1 mx-auto mt-3" style={{ backgroundImage: `linear-gradient(to right, ${primary}, ${accent})`, borderRadius: '4px' }} />;

  // Small uppercase eyebrow label above a section heading — adds a step of
  // typographic hierarchy (kicker → heading → divider) matching the pattern
  // already used in the bento services block, applied consistently across
  // the other content sections for a more polished, editorial feel.
  function sectionKicker(label: string) {
    return (
      <p className="text-xs font-black tracking-[0.25em] uppercase mb-3" style={{ color: primary }}>
        {label}
      </p>
    );
  }

  const ctaIcon =
    ctaMethod === 'whatsapp' ? <WhatsAppIcon size={20} />
    : ctaMethod === 'email' ? <Mail size={20} />
    : ctaMethod === 'phone' ? <Phone size={20} />
    : <ExternalLinkIcon size={20} />;

  function ghostCta(extra?: React.CSSProperties) {
    return (
      <a href={primaryCtaHref} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-2.5 px-7 py-3.5 font-bold shadow-lg transition active:scale-95"
        style={{ borderRadius: btnR, background: onPrimary === '#ffffff' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)', border: `2px solid ${onPrimary === '#ffffff' ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.2)'}`, color: onPrimary, ...extra }}>
        {ctaIcon}{ctaText}
      </a>
    );
  }

  function solidCta(extra?: React.CSSProperties) {
    return (
      <a href={primaryCtaHref} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-2.5 px-7 py-3.5 font-bold shadow-lg transition active:scale-95"
        style={{ borderRadius: btnR, backgroundColor: primary, color: textOnColor(primary), ...extra }}>
        {ctaIcon}{ctaText}
      </a>
    );
  }

  function serviceCards(svcImages: string[] = []) {
    return services.map((s, i) => (
      <motion.div key={s.id} variants={V.classic.item}
        className={`${theme.cardRadius} ${cardGlass} flex flex-col overflow-hidden transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl`}
        style={techCard}>
        <EditableImage src={svcImages[i]} primaryColor={primary} secondaryColor={secondary} logoUrl={logo_url}
          className="w-full h-56 md:h-64" style={imgTreatmentStyle} isEditingMode={isEditingMode} canEdit={!!canEdit}
          onEditClick={() => openImageModal(`service_${i}`)} />
        <div className="flex flex-col gap-3 p-6 pt-4">
          <div className={`w-11 h-11 ${theme.badgeRadius} flex items-center justify-center text-lg font-bold`}
            style={{ backgroundImage: `linear-gradient(135deg, ${primary}, ${accent})`, color: '#fff' }}>
            {s.id}
          </div>
          <EditableText as="h3" className="font-bold text-slate-800"
            value={getEdit(`services.${i}.title`, s.title)}
            onCommit={(v) => setEdit(`services.${i}.title`, v)}
            isEditing={isEditingMode} />
          <EditableText as="p" className="text-sm leading-relaxed" style={{ color: clrMuted }}
            value={getEdit(`services.${i}.description`, s.description)}
            onCommit={(v) => setEdit(`services.${i}.description`, v)}
            isEditing={isEditingMode} />
        </div>
      </motion.div>
    ));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LAYOUT 1 — BENTO
  // ══════════════════════════════════════════════════════════════════════════

  function renderBento() {
    return (
      <>
      <motion.div className={`${layoutPt} p-3 sm:p-4 flex flex-col gap-3`}
        variants={V.bento.container} initial="hidden" animate="visible">

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Cell A: hero copy — 2 cols wide */}
          <motion.div variants={V.bento.cell}
            className="md:col-span-2 rounded-2xl p-8 sm:p-10 flex flex-col justify-center gap-4 min-h-64"
            style={{ background: heroBg, color: onPrimary }}>
            <div className="flex items-center gap-3">
              {logo_url && <img src={logo_url} alt={business_name} className="h-9 w-9 rounded-xl object-contain" style={{ background: 'rgba(255,255,255,0.2)', padding: '4px' }} />}
              <span className="text-xs font-semibold tracking-[0.2em] uppercase opacity-70">{business_name}</span>
            </div>
            <EditableText as="h1" className="text-3xl sm:text-4xl font-extrabold leading-tight tracking-tight"
              value={getEdit('hero.title', ai_content.hero?.title ?? business_name)}
              onCommit={(v) => setEdit('hero.title', v)}
              isEditing={isEditingMode} />
            {(heroTagline || isEditingMode) && (
              <EditableText as="p" className="text-base leading-relaxed opacity-85 max-w-md"
                value={getEdit('hero.subtitle', heroTagline ?? '')}
                onCommit={(v) => setEdit('hero.subtitle', v)}
                isEditing={isEditingMode} />
            )}
            {ghostCta()}
          </motion.div>

          {/* Cell B: hero image — spans 2 rows */}
          <motion.div variants={V.bento.cell} className="md:row-span-2 rounded-2xl overflow-hidden min-h-56">
            <EditableImage src={heroImageUrl} primaryColor={primary} secondaryColor={secondary} logoUrl={logo_url}
              className="w-full h-full min-h-56" isEditingMode={isEditingMode} canEdit={!!canEdit}
              onEditClick={() => openImageModal('hero')} />
          </motion.div>

          {/* Cell C: about text */}
          <motion.div variants={V.bento.cell} className="rounded-2xl p-6 flex flex-col justify-center gap-2"
            style={sectionBg ?? { backgroundColor: '#f8fafc' }}>
            <EditableText as="h2" className="font-bold" style={{ color: clrHead }}
              value={getEdit('about.heading', ai_content.about?.heading ?? 'קצת עלינו')}
              onCommit={(v) => setEdit('about.heading', v)}
              isEditing={isEditingMode} />
            <div className="w-8 h-0.5 rounded" style={{ backgroundImage: `linear-gradient(to right, ${primary}, ${accent})` }} />
            <EditableText as="p" style={{ color: clrBody, display: isEditingMode ? undefined : '-webkit-box', WebkitLineClamp: isEditingMode ? undefined : 5, WebkitBoxOrient: isEditingMode ? undefined : 'vertical', overflow: isEditingMode ? undefined : 'hidden', fontSize: '0.875rem', lineHeight: '1.625' } as React.CSSProperties}
              value={getEdit('about.content', ai_content.about?.content ?? '')}
              onCommit={(v) => setEdit('about.content', v)}
              isEditing={isEditingMode} />
          </motion.div>

          {/* Cell D: images[1] circle (legacy) or branded accent */}
          <motion.div variants={V.bento.cell} className="rounded-2xl min-h-40 flex items-center justify-center p-4"
            style={{ backgroundImage: `linear-gradient(135deg, ${primary}10, ${accent}18)` }}>
            {legacyImages[1] && (
              <img src={legacyImages[1]} alt={business_name} className="w-40 h-40 rounded-full object-cover shadow-xl" />
            )}
          </motion.div>
        </div>

        {/* Services row */}
        {services.length > 0 && (
          <motion.div variants={V.bento.cell} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {services.map((s, i) => (
              <div key={s.id} className={`${theme.cardRadius} bg-white/80 backdrop-blur-sm border border-white/60 shadow-md flex flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl`} style={techCard}>
                <EditableImage src={isAiFormat ? iconUrls[i] : legacyImages[i + 2]}
                  primaryColor={primary} secondaryColor={secondary} logoUrl={logo_url}
                  className="w-full h-48" isEditingMode={isEditingMode} canEdit={!!canEdit}
                  onEditClick={() => openImageModal(`service_${i}`)} />
                <div className="flex flex-col gap-2 p-5">
                  <div className={`w-8 h-8 ${theme.badgeRadius} flex items-center justify-center text-sm font-bold`}
                    style={{ backgroundImage: `linear-gradient(135deg, ${primary}, ${accent})`, color: '#fff' }}>
                    {i + 1}
                  </div>
                  <EditableText as="h3" className="font-bold text-slate-800 text-sm"
                    value={getEdit(`services.${i}.title`, s.title)}
                    onCommit={(v) => setEdit(`services.${i}.title`, v)}
                    isEditing={isEditingMode} />
                  <EditableText as="p" className="text-xs leading-relaxed" style={{ color: clrMuted }}
                    value={getEdit(`services.${i}.description`, s.description)}
                    onCommit={(v) => setEdit(`services.${i}.description`, v)}
                    isEditing={isEditingMode} />
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </motion.div>
      {renderExtendedSections()}
    </>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LAYOUT 2 — EDITORIAL
  // ══════════════════════════════════════════════════════════════════════════

  function renderEditorial() {
    return (
      <div className={layoutPt}>
        {/* Hero: copy 2/5 + image 3/5 */}
        <section className="grid grid-cols-1 lg:grid-cols-5 min-h-[90vh]">
          <motion.div className="lg:col-span-2 flex flex-col justify-center px-8 sm:px-14 py-20 bg-white order-last lg:order-first"
            variants={V.editorial.title} initial="hidden" animate="visible">
            {logo_url && (
              <img src={logo_url} alt={business_name} className="h-12 w-12 object-contain mb-8"
                style={{ borderRadius: vibe === 'luxury' ? '2px' : '10px', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.12))' }} />
            )}
            <p className="text-xs font-black tracking-[0.3em] uppercase mb-4" style={{ color: primary }}>{business_name}</p>
            <EditableText as="h1" className="text-5xl sm:text-6xl font-black leading-[1.05] tracking-tight mb-6 text-slate-900"
              value={getEdit('hero.title', ai_content.hero?.title ?? business_name)}
              onCommit={(v) => setEdit('hero.title', v)}
              isEditing={isEditingMode} />
            {(heroTagline || isEditingMode) && (
              <EditableText as="p" className="text-lg text-slate-500 leading-relaxed mb-8 max-w-sm"
                value={getEdit('hero.subtitle', heroTagline ?? '')}
                onCommit={(v) => setEdit('hero.subtitle', v)}
                isEditing={isEditingMode} />
            )}
            {solidCta()}
          </motion.div>

          <motion.div className="lg:col-span-3 relative min-h-72 lg:min-h-0"
            variants={V.editorial.image} initial="hidden" animate="visible">
            <EditableImage src={heroImageUrl} primaryColor={primary} secondaryColor={secondary} logoUrl={logo_url}
              className="absolute inset-0 w-full h-full" isEditingMode={isEditingMode} canEdit={!!canEdit}
              onEditClick={() => openImageModal('hero')} />
            <div className="absolute top-0 bottom-0 left-0 w-1.5 z-10" style={{ backgroundColor: primary }} />
          </motion.div>
        </section>

        {/* About: large centred paragraph + circle image */}
        {(ai_content.about?.content || isEditingMode) && (
          <motion.section className="px-6 py-24 max-w-3xl mx-auto text-center"
            variants={V.editorial.body} initial="hidden" whileInView="visible" {...VIEW}>
            <EditableText as="p" className="text-xs font-black tracking-[0.3em] uppercase mb-3" style={{ color: accent }}
              value={getEdit('about.heading', ai_content.about?.heading ?? 'קצת עלינו')}
              onCommit={(v) => setEdit('about.heading', v)}
              isEditing={isEditingMode} />
            <div className="w-10 h-px mx-auto mb-8" style={{ backgroundColor: accent }} />
            <EditableText as="p" className="text-2xl sm:text-3xl font-medium text-slate-800 leading-[1.55]"
              value={getEdit('about.content', ai_content.about?.content ?? '')}
              onCommit={(v) => setEdit('about.content', v)}
              isEditing={isEditingMode} />
            {legacyImages[1] && (
              <div className="mt-12">
                <img src={legacyImages[1]} alt={business_name} className="w-64 h-64 rounded-full object-cover mx-auto shadow-xl" />
              </div>
            )}
          </motion.section>
        )}

        {/* Services: numbered editorial list with optional icon images */}
        {services.length > 0 && (
          <motion.section className="px-6 py-20" style={sectionBg ?? { backgroundColor: '#fafafa' }}
            variants={V.editorial.body} initial="hidden" whileInView="visible" {...VIEW}>
            <div className="max-w-4xl mx-auto">
              <p className="text-xs font-black tracking-[0.3em] uppercase text-center mb-12" style={{ color: primary }}>
                השירותים שלנו
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 items-stretch">
                {services.map((s, i) => {
                  const img = isAiFormat ? iconUrls[i] : legacyImages[i + 2];
                  return (
                    <motion.div key={s.id}
                      initial={{ opacity: 0, y: 40 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: '-80px' }}
                      transition={{ duration: 0.6, delay: i * 0.14, ease: EASE_SMOOTH }}
                      className={`h-full flex flex-col gap-3 ${theme.cardRadius} overflow-hidden bg-white/80 backdrop-blur-sm border border-white/60 shadow-md transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl`}>
                      <EditableImage src={img} primaryColor={primary} secondaryColor={secondary} logoUrl={logo_url}
                        className="w-full h-56 md:h-64"
                        isEditingMode={isEditingMode} canEdit={!!canEdit}
                        onEditClick={() => openImageModal(`service_${i}`)} />
                      <div className="flex flex-col gap-3 p-5">
                        <span className="font-black tabular-nums text-5xl" style={{ color: `${primary}22` }}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <div className="w-8 h-px" style={{ backgroundColor: primary }} />
                        <EditableText as="h3" className="font-bold text-slate-800"
                          value={getEdit(`services.${i}.title`, s.title)}
                          onCommit={(v) => setEdit(`services.${i}.title`, v)}
                          isEditing={isEditingMode} />
                        <EditableText as="p" className="text-sm leading-relaxed text-slate-500"
                          value={getEdit(`services.${i}.description`, s.description)}
                          onCommit={(v) => setEdit(`services.${i}.description`, v)}
                          isEditing={isEditingMode} />
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.section>
        )}
        {renderExtendedSections()}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LAYOUT 3 — SPLIT
  // ══════════════════════════════════════════════════════════════════════════

  function renderSplit() {
    return (
      <div className={layoutPt}>
        {/* Hero: image left / text right */}
        <section className="grid grid-cols-1 lg:grid-cols-2 min-h-[85vh] overflow-hidden">
          <motion.div className="relative min-h-72 lg:min-h-0"
            variants={V.split.left} initial="hidden" animate="visible">
            <EditableImage src={heroImageUrl} primaryColor={primary} secondaryColor={secondary} logoUrl={logo_url}
              className="absolute inset-0 w-full h-full" isEditingMode={isEditingMode} canEdit={!!canEdit}
              onEditClick={() => openImageModal('hero')} />
          </motion.div>

          <motion.div className="flex flex-col justify-center gap-5 px-8 sm:px-14 py-16 order-first lg:order-last"
            style={{ background: heroBg, color: onPrimary }}
            variants={V.split.right} initial="hidden" animate="visible">
            {logo_url && (
              <img src={logo_url} alt={business_name} className="h-14 w-14 object-contain self-end"
                style={{ borderRadius: '10px', background: 'rgba(255,255,255,0.2)', padding: '6px' }} />
            )}
            <p className="text-xs font-semibold tracking-[0.2em] uppercase opacity-70">{business_name}</p>
            <EditableText as="h1" className="text-4xl sm:text-5xl font-extrabold leading-tight tracking-tight"
              value={getEdit('hero.title', ai_content.hero?.title ?? business_name)}
              onCommit={(v) => setEdit('hero.title', v)}
              isEditing={isEditingMode} />
            {(heroTagline || isEditingMode) && (
              <EditableText as="p" className="text-lg leading-relaxed opacity-85 max-w-sm"
                value={getEdit('hero.subtitle', heroTagline ?? '')}
                onCommit={(v) => setEdit('hero.subtitle', v)}
                isEditing={isEditingMode} />
            )}
            {ghostCta()}
          </motion.div>
        </section>

        {/* About: floats over hero with slight overlap */}
        {(ai_content.about?.content || isEditingMode) && (
          <section className="grid grid-cols-1 lg:grid-cols-2 overflow-hidden relative z-10 -mt-12 rounded-t-2xl" style={sectionBg}>
            <motion.div className="flex flex-col justify-center gap-4 px-8 sm:px-14 py-16"
              variants={V.split.right} initial="hidden" whileInView="visible" {...VIEW}>
              <EditableText as="h2" className="text-2xl font-bold" style={{ color: clrHead }}
                value={getEdit('about.heading', ai_content.about?.heading ?? 'קצת עלינו')}
                onCommit={(v) => setEdit('about.heading', v)}
                isEditing={isEditingMode} />
              <div className="w-10 h-1 rounded" style={{ backgroundImage: `linear-gradient(to right, ${primary}, ${accent})` }} />
              <EditableText as="p" className="text-lg leading-relaxed" style={{ color: clrBody }}
                value={getEdit('about.content', ai_content.about?.content ?? '')}
                onCommit={(v) => setEdit('about.content', v)}
                isEditing={isEditingMode} />
            </motion.div>

            <motion.div className="relative min-h-64 lg:min-h-0"
              variants={V.split.left} initial="hidden" whileInView="visible" {...VIEW}>
              {legacyImages[1]
                ? <ImgCell src={legacyImages[1]} alt={business_name} className="absolute inset-0 w-full h-full" />
                : <div className="absolute inset-0"
                    style={{ backgroundImage: `linear-gradient(135deg, ${primary}15, ${accent}20)` }} />
              }
            </motion.div>
          </section>
        )}

        {/* Services */}
        {services.length > 0 && (
          <motion.section className={`${theme.fallbackBg} px-6 py-16`} style={sectionBgAlt}
            variants={V.classic.container} initial="hidden" whileInView="visible" {...VIEW}>
            <div className="max-w-4xl mx-auto">
              <motion.div variants={V.classic.item} className="text-center mb-12">
                <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: clrHead }}>השירותים שלנו</h2>
                {divider}
              </motion.div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {serviceCards(
                  isAiFormat ? iconUrls : legacyImages.slice(2, 5),
                )}
              </div>
            </div>
          </motion.section>
        )}
        {renderExtendedSections()}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LAYOUT 4 — CLASSIC
  // ══════════════════════════════════════════════════════════════════════════

  function renderClassic() {
    return (
      <div className={layoutPt}>
        {/* Hero: full-bleed image with dark overlay, or gradient fallback */}
        <motion.section className="relative flex flex-col items-center justify-center text-center px-6 min-h-[85vh] overflow-hidden"
          variants={V.classic.container} initial="hidden" animate="visible">
          {heroImageUrl || (isEditingMode && !!canEdit)
            ? <EditableImage src={heroImageUrl} primaryColor={primary} secondaryColor={secondary} logoUrl={logo_url}
                className="absolute inset-0 w-full h-full" darken={!!heroImageUrl}
                isEditingMode={isEditingMode} canEdit={!!canEdit}
                onEditClick={() => openImageModal('hero')} />
            : <div className="absolute inset-0" style={{ background: heroBg }} />
          }
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.08) 0%, transparent 60%)' }} />

          <motion.div variants={V.classic.item} className="relative z-10 flex flex-col items-center gap-5 max-w-xl mx-auto py-20"
            style={{ color: heroImageUrl ? '#ffffff' : onPrimary }}>
            {logo_url && (
              <img src={logo_url} alt={business_name} className="h-24 w-24 object-contain shadow-xl"
                style={{ borderRadius: vibe === 'luxury' ? '4px' : '16px', background: 'rgba(255,255,255,0.2)', padding: '8px' }} />
            )}
            <p className="text-xs font-semibold tracking-[0.2em] uppercase opacity-70">{business_name}</p>
            <EditableText as="h1" className="text-4xl sm:text-5xl font-extrabold leading-tight tracking-tight drop-shadow-lg"
              value={getEdit('hero.title', ai_content.hero?.title ?? business_name)}
              onCommit={(v) => setEdit('hero.title', v)}
              isEditing={isEditingMode} />
            {(heroTagline || isEditingMode) && (
              <EditableText as="p" className="text-lg sm:text-xl leading-relaxed max-w-sm opacity-85 drop-shadow"
                value={getEdit('hero.subtitle', heroTagline ?? '')}
                onCommit={(v) => setEdit('hero.subtitle', v)}
                isEditing={isEditingMode} />
            )}
            {heroImageUrl
              ? ghostCta({ color: '#ffffff', background: 'rgba(255,255,255,0.15)', border: '2px solid rgba(255,255,255,0.45)' })
              : ghostCta()
            }
          </motion.div>
        </motion.section>

        {/* About — floats over hero with negative margin + rounded top */}
        {(ai_content.about?.content || isEditingMode) && (
          <motion.section className={`${theme.fallbackBg} relative z-10 -mt-16 rounded-t-3xl px-6 pt-24 pb-16`} style={sectionBg}
            variants={V.classic.container} initial="hidden" whileInView="visible" {...VIEW}>
            <motion.div variants={V.classic.item} className="max-w-2xl mx-auto text-center">
              <EditableText as="h2" className="text-2xl font-bold mb-1" style={{ color: clrHead }}
                value={getEdit('about.heading', ai_content.about?.heading ?? 'קצת עלינו')}
                onCommit={(v) => setEdit('about.heading', v)}
                isEditing={isEditingMode} />
              {divider}
              <EditableText as="p" className="leading-relaxed text-lg mt-6" style={{ color: clrBody }}
                value={getEdit('about.content', ai_content.about?.content ?? '')}
                onCommit={(v) => setEdit('about.content', v)}
                isEditing={isEditingMode} />
              {legacyImages[1] && (
                <div className="mt-10">
                  <img src={legacyImages[1]} alt={business_name} className="w-64 h-64 rounded-full object-cover mx-auto shadow-xl" />
                </div>
              )}
            </motion.div>
          </motion.section>
        )}

        {/* Services */}
        {services.length > 0 && (
          <motion.section className={`${theme.fallbackBg} px-6 py-16`} style={sectionBgAlt}
            variants={V.classic.container} initial="hidden" whileInView="visible" {...VIEW}>
            <div className="max-w-4xl mx-auto">
              <motion.div variants={V.classic.item} className="text-center mb-14">
                <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: clrHead }}>השירותים שלנו</h2>
                {divider}
              </motion.div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {serviceCards(
                  isAiFormat ? iconUrls : legacyImages.slice(2, 5),
                )}
              </div>
            </div>
          </motion.section>
        )}
        {renderExtendedSections()}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SHARED LONG-FORM SECTIONS
  // ══════════════════════════════════════════════════════════════════════════

  function renderBenefits() {
    const benefits = ai_content.benefits ?? [];
    if (!benefits.length) return null;
    return (
      <section className="relative overflow-hidden px-6 py-20" style={sectionBg ?? { backgroundColor: '#f8fafc' }}>
        {/* Ambient glow orbs */}
        <div className="absolute -top-40 -right-24 w-[480px] h-[480px] rounded-full blur-3xl opacity-20 pointer-events-none"
          style={{ backgroundColor: primary }} />
        <div className="absolute -bottom-40 -left-24 w-[400px] h-[400px] rounded-full blur-3xl opacity-15 pointer-events-none"
          style={{ backgroundColor: secondary }} />

        <div className="relative max-w-4xl mx-auto">
          <motion.div className="text-center mb-14"
            initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.6, ease: EASE_SMOOTH }}>
            {sectionKicker('היתרונות שלנו')}
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: clrHead }}>למה לבחור בנו</h2>
            {divider}
          </motion.div>

          {/* Asymmetric grid: first card is full-width horizontal feature card */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {benefits.map((b, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, y: 28, scale: 0.97 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.55, delay: i * 0.1, ease: EASE_EXPO }}
                className={`
                  ${i === 0 ? 'sm:col-span-2 flex-row items-start' : 'flex-col'}
                  flex gap-5 p-6 ${theme.cardRadius}
                  bg-white/80 backdrop-blur-md border border-white/60 shadow-lg
                  hover:-translate-y-1.5 hover:shadow-2xl transition-all duration-300
                `}
                style={techCard}>
                <div className={`${i === 0 ? 'w-14 h-14 rounded-2xl' : 'w-10 h-10 rounded-xl'} flex-shrink-0 flex items-center justify-center mt-0.5`}
                  style={{ backgroundImage: `linear-gradient(135deg, ${primary}, ${accent})` }}>
                  <Check size={i === 0 ? 22 : 18} color="#fff" />
                </div>
                <div className="flex flex-col gap-1.5 min-w-0">
                  <EditableText as="h3" className={`font-bold text-slate-800 leading-tight ${i === 0 ? 'text-lg' : ''}`}
                    value={getEdit(`benefits.${i}.title`, b.title)}
                    onCommit={(v) => setEdit(`benefits.${i}.title`, v)}
                    isEditing={isEditingMode} />
                  <EditableText as="p" className="text-sm leading-relaxed" style={{ color: clrMuted }}
                    value={getEdit(`benefits.${i}.description`, b.description)}
                    onCommit={(v) => setEdit(`benefits.${i}.description`, v)}
                    isEditing={isEditingMode} />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  function renderProcessSteps() {
    const steps = ai_content.process_steps ?? [];
    if (!steps.length) return null;
    return (
      <section className="relative overflow-hidden px-6 py-20 bg-white">
        {/* Ambient glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ backgroundColor: primary }} />

        <div className="relative max-w-4xl mx-auto">
          <motion.div className="text-center mb-16"
            initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.6, ease: EASE_SMOOTH }}>
            {sectionKicker('התהליך שלנו')}
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: clrHead }}>איך זה עובד</h2>
            {divider}
          </motion.div>

          <div className="relative">
            {steps.length > 1 && (
              <div className="hidden sm:block absolute top-7 left-1/6 right-1/6 h-px pointer-events-none"
                style={{ backgroundImage: `linear-gradient(to right, ${accent}50, ${primary}70, ${accent}50)` }} />
            )}
            <div className="relative z-10 flex flex-col sm:flex-row gap-10 sm:gap-0 items-start justify-around">
              {steps.map((step, i) => (
                <motion.div key={step.step_number ?? i}
                  initial={{ opacity: 0, y: 32 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-80px' }}
                  transition={{ duration: 0.55, delay: i * 0.14, ease: EASE_EXPO }}
                  className="flex flex-col items-center text-center gap-3 flex-1 px-4">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-black shadow-xl ring-4 ring-white transition-transform duration-300 hover:scale-110"
                    style={{ backgroundImage: `linear-gradient(135deg, ${primary}, ${accent})`, color: '#fff' }}>
                    {step.step_number ?? i + 1}
                  </div>
                  <EditableText as="h3" className="font-bold text-slate-800"
                    value={getEdit(`process_steps.${i}.title`, step.title)}
                    onCommit={(v) => setEdit(`process_steps.${i}.title`, v)}
                    isEditing={isEditingMode} />
                  <EditableText as="p" className="text-sm text-slate-500 leading-relaxed max-w-[200px]"
                    value={getEdit(`process_steps.${i}.description`, step.description)}
                    onCommit={(v) => setEdit(`process_steps.${i}.description`, v)}
                    isEditing={isEditingMode} />
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  function renderTestimonials() {
    const testimonials = ai_content.testimonials ?? [];
    if (!testimonials.length) return null;
    const isPlaceholder = (quote: string) => quote.includes('הכנס כאן') || quote.includes('ציטוט אמיתי');
    return (
      <section className="relative overflow-hidden px-6 py-20"
        style={sectionBgAlt ?? { backgroundColor: '#f8fafc' }}>
        {/* Ambient glow */}
        <div className="absolute -top-32 -left-32 w-[450px] h-[450px] rounded-full blur-3xl opacity-15 pointer-events-none"
          style={{ backgroundColor: accent }} />
        <div className="absolute -bottom-32 -right-32 w-[380px] h-[380px] rounded-full blur-3xl opacity-12 pointer-events-none"
          style={{ backgroundColor: primary }} />

        <div className="relative max-w-3xl mx-auto">
          <motion.div className="text-center mb-14"
            initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.6, ease: EASE_SMOOTH }}>
            {sectionKicker('לקוחות מספרים')}
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: clrHead }}>מה לקוחות אומרים</h2>
            {divider}
          </motion.div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {testimonials.map((t, i) => {
              const isPholder = isPlaceholder(t.quote);
              return (
                <motion.div key={i}
                  initial={{ opacity: 0, y: 24, scale: 0.97 }}
                  whileInView={{ opacity: 1, y: 0, scale: 1 }}
                  viewport={{ once: true, margin: '-80px' }}
                  transition={{ duration: 0.5, delay: i * 0.1, ease: EASE_EXPO }}
                  className={`relative flex flex-col gap-3 rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1.5 ${
                    isPholder
                      ? 'border-2 border-dashed border-amber-300 bg-amber-50'
                      : 'bg-white/80 backdrop-blur-md border border-white/60 shadow-lg hover:shadow-2xl'
                  }`}>
                  {isPholder && canEdit && (
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-100 rounded-lg px-2.5 py-1.5 self-start">
                      <Pencil size={11} />הוסף ציטוט אמיתי
                    </div>
                  )}
                  <div className="text-5xl leading-none font-black" style={{ color: `${primary}30` }}>"</div>
                  <EditableText as="p" className={`text-sm leading-relaxed flex-1 ${isPholder ? 'text-amber-700 italic' : 'text-slate-600'}`}
                    value={getEdit(`testimonials.${i}.quote`, t.quote)}
                    onCommit={(v) => setEdit(`testimonials.${i}.quote`, v)}
                    isEditing={isEditingMode} />
                  <div className="border-t border-slate-100 pt-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ backgroundImage: `linear-gradient(135deg, ${primary}, ${accent})`, color: '#fff' }}>
                      {t.author.charAt(0)}
                    </div>
                    <div>
                      <EditableText as="p" className="font-bold text-slate-800 text-sm leading-tight"
                        value={getEdit(`testimonials.${i}.author`, t.author)}
                        onCommit={(v) => setEdit(`testimonials.${i}.author`, v)}
                        isEditing={isEditingMode} />
                      <EditableText as="p" className="text-xs text-slate-400"
                        value={getEdit(`testimonials.${i}.role`, t.role)}
                        onCommit={(v) => setEdit(`testimonials.${i}.role`, v)}
                        isEditing={isEditingMode} />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  function renderFaq() {
    const faq = ai_content.faq ?? [];
    if (!faq.length) return null;
    return (
      <motion.section className="px-6 py-16" style={sectionBg ?? { backgroundColor: '#f8fafc' }}
        variants={V.classic.container} initial="hidden" whileInView="visible" {...VIEW}>
        <div className="max-w-2xl mx-auto">
          <motion.div variants={V.classic.item} className="text-center mb-12">
            {sectionKicker('עזרה ותשובות')}
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: clrHead }}>שאלות נפוצות</h2>
            {divider}
          </motion.div>
          <div className="flex flex-col gap-2">
            {faq.map((item, i) => (
              <motion.div key={i} variants={V.classic.item}
                className={`${theme.cardRadius} overflow-hidden border border-slate-200 bg-white/90 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md`}>
                {isEditingMode ? (
                  <div className="p-5 flex flex-col gap-2">
                    <EditableText as="p" className="font-semibold text-slate-800 text-sm"
                      value={getEdit(`faq.${i}.question`, item.question)}
                      onCommit={(v) => setEdit(`faq.${i}.question`, v)}
                      isEditing={true} />
                    <EditableText as="p" className="text-sm text-slate-500 leading-relaxed"
                      value={getEdit(`faq.${i}.answer`, item.answer)}
                      onCommit={(v) => setEdit(`faq.${i}.answer`, v)}
                      isEditing={true} />
                  </div>
                ) : (
                  <>
                    <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                      className="w-full flex items-center justify-between gap-4 px-5 py-4 text-right">
                      <span className="font-semibold text-slate-800 text-sm leading-snug">
                        {getEdit(`faq.${i}.question`, item.question)}
                      </span>
                      <ChevronDown size={18} className="flex-shrink-0 transition-transform duration-300"
                        style={{ color: primary, transform: openFaq === i ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                    </button>
                    <AnimatePresence>
                      {openFaq === i && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25, ease: 'easeInOut' }}
                          className="overflow-hidden">
                          <div className="px-5 pb-5 border-t border-slate-100">
                            <p className="text-sm text-slate-500 leading-relaxed pt-4">
                              {getEdit(`faq.${i}.answer`, item.answer)}
                            </p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>
    );
  }

  function renderExtendedSections() {
    return (
      <>
        {renderBenefits()}
        {renderProcessSteps()}
        {renderTestimonials()}
        {renderFaq()}
      </>
    );
  }

  // Legacy layout functions superseded by the composition engine
  void [renderBento, renderEditorial, renderSplit, renderClassic, renderExtendedSections];

  // ── Composition-driven layout engine ─────────────────────────────────────

  function getFallbackComposition(): string[] {
    const comp: string[] = [];
    if (structural === 'split' || structural === 'editorial') comp.push('hero_split');
    else comp.push('hero_center');
    if (structural === 'bento' || structural === 'editorial') comp.push('services_bento');
    else comp.push('services_grid');
    if (ai_content.benefits?.length) comp.push('benefits_list');
    if (ai_content.process_steps?.length) comp.push('process_horizontal');
    if (ai_content.testimonials?.length) comp.push('testimonials_grid');
    if (ai_content.faq?.length) comp.push('faq_accordion');
    comp.push('cta_banner');
    return comp;
  }

  // ── Structural layout variance (orthogonal to the color "vibe" system) ────
  // The composition engine above picks WHICH blocks appear (hero_center vs.
  // hero_split, services_grid vs. services_bento) but every business ended up
  // rendering visually the same shape, just recolored — this is the actual
  // "generic template" complaint. These resolvers pick genuinely different
  // COMPOSITIONS at render time, driven by real signals (does a real hero
  // image exist, how many service/benefit items are there, which design_style
  // vibe was chosen) rather than by color alone. A stable per-page hash (not
  // Math.random) alternates the split-hero image side deterministically, so
  // pages don't all mirror each other identically but re-renders stay stable.

  function pageVariantSeed(): number {
    const s = `${page?.id || ''}::${business_name || ''}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  type HeroVariant = 'center' | 'split' | 'fullbleed';

  function resolveHeroVariant(): HeroVariant {
    // Never fake an image-heavy composition when there's no real hero image —
    // 'center' already degrades gracefully to a gradient background for this case.
    if (!heroImageUrl) return 'center';
    if (vibe === 'luxury') return 'fullbleed';  // editorial, immersive — full-bleed photography
    if (vibe === 'corporate') return 'center';  // minimal design_style — clean, no-clutter focused card
    return 'split';                             // warm/playful/tech — image beside copy
  }

  function renderHeroBlock() {
    const variant = resolveHeroVariant();
    if (variant === 'fullbleed') return renderHeroFullBleedBlock();
    if (variant === 'split') return renderHeroSplitBlock(pageVariantSeed() % 2 === 0);
    return renderHeroCenterBlock();
  }

  type ServicesVariant = 'grid' | 'bento' | 'rows' | 'iconlist';

  function resolveServicesVariant(): ServicesVariant {
    const n = services.length;
    if (!n) return 'grid';
    // Minimal/corporate vibe with a longer list: a clean scannable list beats
    // heavy imagery — and it needs no images at all, so it's fully safe when
    // no service photos were generated/uploaded.
    if (vibe === 'corporate' && n >= 4) return 'iconlist';
    // A short list (2-3 items) reads well as alternating editorial rows —
    // each item gets real room instead of being squeezed into a narrow card.
    if (n <= 3) return 'rows';
    // Richer vibes keep the existing asymmetric bento treatment for mid/long lists.
    if (vibe === 'luxury' || vibe === 'warm') return 'bento';
    return 'grid';
  }

  function renderServicesBlock(isAlt: boolean) {
    const variant = resolveServicesVariant();
    if (variant === 'bento') return renderServicesBentoBlock(isAlt);
    if (variant === 'rows') return renderServicesRowsBlock(isAlt);
    if (variant === 'iconlist') return renderServicesIconListBlock(isAlt);
    return renderServicesGridBlock(isAlt);
  }

  function renderHeroCenterBlock() {
    return (
      <motion.section
        className={`relative flex flex-col items-center justify-center text-center px-6 min-h-[85vh] overflow-hidden ${layoutPt}`}
        variants={V.classic.container} initial="hidden" animate="visible">
        {heroImageUrl || (isEditingMode && !!canEdit)
          ? <EditableImage src={heroImageUrl} primaryColor={primary} secondaryColor={secondary} logoUrl={logo_url}
              className="absolute inset-0 w-full h-full" darken={!!heroImageUrl}
              isEditingMode={isEditingMode} canEdit={!!canEdit}
              onEditClick={() => openImageModal('hero')} />
          : <div className="absolute inset-0" style={{ background: heroBg }} />
        }
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.08) 0%, transparent 60%)' }} />
        <motion.div variants={V.classic.item} className="relative z-10 flex flex-col items-center gap-5 max-w-xl mx-auto my-16 py-12 px-8 rounded-3xl"
          style={{
            color: heroImageUrl ? '#ffffff' : heroOnGradient,
            background: heroImageUrl ? 'rgba(15,23,42,0.55)' : undefined,
            backdropFilter: heroImageUrl ? 'blur(3px)' : undefined,
            WebkitBackdropFilter: heroImageUrl ? 'blur(3px)' : undefined,
            boxShadow: heroImageUrl ? '0 20px 60px rgba(0,0,0,0.35)' : undefined,
          }}>
          {logo_url && (
            <img src={logo_url} alt={business_name} className="h-24 w-24 object-contain shadow-xl"
              style={{ borderRadius: vibe === 'luxury' ? '4px' : '16px', background: 'rgba(255,255,255,0.2)', padding: '8px' }} />
          )}
          <p className="text-xs font-semibold tracking-[0.2em] uppercase opacity-70">{business_name}</p>
          <AccentedHeroTitle
            className="text-4xl sm:text-5xl font-extrabold leading-tight tracking-tight drop-shadow-lg"
            value={getEdit('hero.title', ai_content.hero?.title ?? business_name)}
            onCommit={(v) => setEdit('hero.title', v)}
            isEditing={isEditingMode}
            accentColor={secondaryAccent} />
          {(heroTagline || isEditingMode) && (
            <EditableText as="p" className="text-lg sm:text-xl leading-relaxed max-w-sm opacity-85 drop-shadow"
              value={getEdit('hero.subtitle', heroTagline ?? '')}
              onCommit={(v) => setEdit('hero.subtitle', v)}
              isEditing={isEditingMode} />
          )}
          {heroImageUrl
            ? ghostCta({ color: '#ffffff', background: 'rgba(255,255,255,0.15)', border: '2px solid rgba(255,255,255,0.45)' })
            : ghostCta(heroCtaOverride)
          }
        </motion.div>
      </motion.section>
    );
  }

  function renderHeroSplitBlock(imageOnRight: boolean = true) {
    // Mobile always stacks text-above-image regardless of side; only the
    // desktop (lg) side flips, via a per-page deterministic hash — so a
    // restaurant and a law firm chosen with the same vibe don't visually mirror
    // each other's hero every time.
    const imageOrderClass = imageOnRight ? '' : 'lg:order-last';
    const textOrderClass = imageOnRight ? 'order-first lg:order-last' : 'order-first';
    return (
      <section className={`grid grid-cols-1 lg:grid-cols-2 min-h-[85vh] overflow-hidden ${layoutPt}`}>
        <motion.div className={`relative min-h-72 lg:min-h-0 ${imageOrderClass}`}
          variants={V.split.left} initial="hidden" animate="visible">
          <EditableImage src={heroImageUrl} primaryColor={primary} secondaryColor={secondary} logoUrl={logo_url}
            className="absolute inset-0 w-full h-full" isEditingMode={isEditingMode} canEdit={!!canEdit}
            onEditClick={() => openImageModal('hero')} />
        </motion.div>
        <motion.div className={`flex flex-col justify-center gap-5 px-8 sm:px-14 py-16 ${textOrderClass}`}
          style={{ background: heroBg, color: heroOnGradient }}
          variants={V.split.right} initial="hidden" animate="visible">
          {logo_url && (
            <img src={logo_url} alt={business_name} className="h-14 w-14 object-contain self-end"
              style={{ borderRadius: '10px', background: 'rgba(255,255,255,0.2)', padding: '6px' }} />
          )}
          <p className="text-xs font-semibold tracking-[0.2em] uppercase opacity-70">{business_name}</p>
          <AccentedHeroTitle
            className="text-4xl sm:text-5xl font-extrabold leading-tight tracking-tight"
            value={getEdit('hero.title', ai_content.hero?.title ?? business_name)}
            onCommit={(v) => setEdit('hero.title', v)}
            isEditing={isEditingMode}
            accentColor={secondaryAccent} />
          {(heroTagline || isEditingMode) && (
            <EditableText as="p" className="text-lg leading-relaxed opacity-85 max-w-sm"
              value={getEdit('hero.subtitle', heroTagline ?? '')}
              onCommit={(v) => setEdit('hero.subtitle', v)}
              isEditing={isEditingMode} />
          )}
          {ghostCta(heroCtaOverride)}
        </motion.div>
      </section>
    );
  }

  // Full-bleed editorial hero: image fills the whole viewport with the copy
  // bottom-anchored over a dark gradient, instead of centered in a glass card.
  // Distinct in silhouette from both renderHeroCenterBlock (centered card) and
  // renderHeroSplitBlock (two even columns) — used for the 'luxury' vibe.
  // Only ever chosen (see resolveHeroVariant) when a real hero image exists.
  function renderHeroFullBleedBlock() {
    return (
      <motion.section
        className={`relative flex flex-col justify-end px-6 sm:px-16 pb-16 sm:pb-20 min-h-[92vh] overflow-hidden ${layoutPt}`}
        variants={V.editorial.image} initial="hidden" animate="visible">
        <EditableImage src={heroImageUrl} primaryColor={primary} secondaryColor={secondary} logoUrl={logo_url}
          className="absolute inset-0 w-full h-full" darken
          isEditingMode={isEditingMode} canEdit={!!canEdit}
          onEditClick={() => openImageModal('hero')} />
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(to top, rgba(10,10,10,0.85) 0%, rgba(10,10,10,0.25) 45%, transparent 75%)' }} />
        <motion.div variants={V.editorial.body} className="relative z-10 flex flex-col items-start gap-4 max-w-2xl text-white">
          {logo_url && (
            <img src={logo_url} alt={business_name} className="h-14 w-14 object-contain"
              style={{ borderRadius: '4px', background: 'rgba(255,255,255,0.15)', padding: '6px' }} />
          )}
          <p className="text-xs font-semibold tracking-[0.3em] uppercase opacity-80">{business_name}</p>
          <AccentedHeroTitle
            className="text-4xl sm:text-6xl font-extrabold leading-[1.05] tracking-tight drop-shadow-lg"
            value={getEdit('hero.title', ai_content.hero?.title ?? business_name)}
            onCommit={(v) => setEdit('hero.title', v)}
            isEditing={isEditingMode}
            accentColor={secondaryAccent} />
          {(heroTagline || isEditingMode) && (
            <EditableText as="p" className="text-lg sm:text-xl leading-relaxed max-w-lg opacity-90 drop-shadow"
              value={getEdit('hero.subtitle', heroTagline ?? '')}
              onCommit={(v) => setEdit('hero.subtitle', v)}
              isEditing={isEditingMode} />
          )}
          {ghostCta({ color: '#ffffff', background: 'rgba(255,255,255,0.15)', border: '2px solid rgba(255,255,255,0.45)' })}
        </motion.div>
      </motion.section>
    );
  }

  function renderAboutSection(isAlt: boolean) {
    if (!ai_content.about?.content && !isEditingMode) return null;
    const bg = isAlt ? sectionBgAlt : sectionBg;
    return (
      <motion.section className={`${theme.fallbackBg} relative z-10 -mt-16 rounded-t-3xl px-6 pt-24 pb-16`} style={bg}
        variants={V.classic.container} initial="hidden" whileInView="visible" {...VIEW}>
        <motion.div variants={V.classic.item} className="max-w-2xl mx-auto text-center">
          <EditableText as="h2" className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-1" style={{ color: clrHead }}
            value={getEdit('about.heading', ai_content.about?.heading ?? 'קצת עלינו')}
            onCommit={(v) => setEdit('about.heading', v)}
            isEditing={isEditingMode} />
          {divider}
          <EditableText as="p" className="leading-relaxed text-lg mt-6" style={{ color: clrBody }}
            value={getEdit('about.content', ai_content.about?.content ?? '')}
            onCommit={(v) => setEdit('about.content', v)}
            isEditing={isEditingMode} />
          {legacyImages[1] && (
            <div className="mt-10">
              <img src={legacyImages[1]} alt={business_name} className="w-64 h-64 rounded-full object-cover mx-auto shadow-xl" />
            </div>
          )}
        </motion.div>
      </motion.section>
    );
  }

  function renderServicesGridBlock(isAlt: boolean) {
    if (!services.length) return null;
    const bg = isAlt ? sectionBgAlt : sectionBg;
    return (
      <motion.section className={`${theme.fallbackBg} px-6 py-16`} style={bg ?? { backgroundColor: '#f8fafc' }}
        variants={V.classic.container} initial="hidden" whileInView="visible" {...VIEW}>
        <div className="max-w-4xl mx-auto">
          <motion.div variants={V.classic.item} className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: clrHead }}>השירותים שלנו</h2>
            {divider}
          </motion.div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {serviceCards(isAiFormat ? iconUrls : legacyImages.slice(2, 5))}
          </div>
        </div>
      </motion.section>
    );
  }

  function renderServicesBentoBlock(isAlt: boolean) {
    if (!services.length) return null;
    const bg = isAlt ? sectionBgAlt : sectionBg;
    return (
      <motion.section className="px-6 py-20" style={bg ?? { backgroundColor: '#fafafa' }}
        variants={V.editorial.body} initial="hidden" whileInView="visible" {...VIEW}>
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-black tracking-[0.3em] uppercase text-center mb-12" style={{ color: primary }}>
            השירותים שלנו
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 items-end">
            {services.map((s, i) => {
              const img = isAiFormat ? iconUrls[i] : legacyImages[i + 2];
              return (
                <motion.div key={s.id}
                  initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-80px' }}
                  transition={{ duration: 0.6, delay: i * 0.14, ease: EASE_SMOOTH }}
                  className={`flex flex-col gap-3 ${theme.cardRadius} overflow-hidden bg-white/80 backdrop-blur-sm border border-white/60 transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl ${i === 0 ? 'shadow-xl' : 'shadow-md'}`}>
                  <EditableImage src={img} primaryColor={primary} secondaryColor={secondary} logoUrl={logo_url}
                    className={`w-full ${i === 0 ? 'h-72 md:h-80' : 'h-52 md:h-60'}`}
                    style={imgTreatmentStyle}
                    isEditingMode={isEditingMode} canEdit={!!canEdit}
                    onEditClick={() => openImageModal(`service_${i}`)} />
                  <div className="flex flex-col gap-3 p-5">
                    <span className="font-black tabular-nums text-5xl"
                      style={{ color: `${primary}22` }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="w-8 h-px" style={{ backgroundColor: primary }} />
                    <EditableText as="h3" className={`font-bold text-slate-800 ${i === 0 ? 'text-lg' : ''}`}
                      value={getEdit(`services.${i}.title`, s.title)}
                      onCommit={(v) => setEdit(`services.${i}.title`, v)}
                      isEditing={isEditingMode} />
                    <EditableText as="p" className="text-sm leading-relaxed text-slate-500"
                      value={getEdit(`services.${i}.description`, s.description)}
                      onCommit={(v) => setEdit(`services.${i}.description`, v)}
                      isEditing={isEditingMode} />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </motion.section>
    );
  }

  // Alternating image+text rows — extends the bento pattern's asymmetric,
  // per-item-count-driven idea to a short list (2-3 items), where a uniform
  // 3-col grid or bento block would squeeze each item too narrow to breathe.
  function renderServicesRowsBlock(isAlt: boolean) {
    if (!services.length) return null;
    const bg = isAlt ? sectionBgAlt : sectionBg;
    return (
      <motion.section className="px-6 py-20" style={bg ?? { backgroundColor: '#fafafa' }}
        variants={V.classic.container} initial="hidden" whileInView="visible" {...VIEW}>
        <div className="max-w-4xl mx-auto flex flex-col gap-3">
          <motion.div variants={V.classic.item} className="text-center mb-6">
            {sectionKicker('השירותים שלנו')}
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: clrHead }}>מה אנחנו מציעים</h2>
            {divider}
          </motion.div>
          <div className="flex flex-col gap-14 sm:gap-20 mt-8">
            {services.map((s, i) => {
              const img = isAiFormat ? iconUrls[i] : legacyImages[i + 2];
              const reversed = i % 2 === 1;
              return (
                <motion.div key={s.id} variants={V.classic.item}
                  className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                  <div className={`${theme.cardRadius} overflow-hidden min-h-56 lg:min-h-72 ${reversed ? 'lg:order-last' : ''}`}
                    style={imgTreatmentStyle}>
                    <EditableImage src={img} primaryColor={primary} secondaryColor={secondary} logoUrl={logo_url}
                      className="w-full h-full min-h-56 lg:min-h-72" style={imgTreatmentStyle}
                      isEditingMode={isEditingMode} canEdit={!!canEdit}
                      onEditClick={() => openImageModal(`service_${i}`)} />
                  </div>
                  <div className={`flex flex-col gap-3 ${reversed ? 'lg:order-first' : ''}`}>
                    <div className={`w-11 h-11 ${theme.badgeRadius} flex items-center justify-center text-lg font-bold`}
                      style={{ backgroundImage: `linear-gradient(135deg, ${primary}, ${accent})`, color: '#fff' }}>
                      {i + 1}
                    </div>
                    <EditableText as="h3" className="text-xl sm:text-2xl font-bold text-slate-800"
                      value={getEdit(`services.${i}.title`, s.title)}
                      onCommit={(v) => setEdit(`services.${i}.title`, v)}
                      isEditing={isEditingMode} />
                    <EditableText as="p" className="leading-relaxed" style={{ color: clrMuted }}
                      value={getEdit(`services.${i}.description`, s.description)}
                      onCommit={(v) => setEdit(`services.${i}.description`, v)}
                      isEditing={isEditingMode} />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </motion.section>
    );
  }

  // Clean scannable icon-list — no imagery dependency at all, so it degrades
  // perfectly when no service photos exist. Reads as "minimal", matching the
  // corporate/minimal vibe rather than forcing heavy imagery on a long list.
  function renderServicesIconListBlock(isAlt: boolean) {
    if (!services.length) return null;
    const bg = isAlt ? sectionBgAlt : sectionBg;
    return (
      <motion.section className="px-6 py-20" style={bg ?? { backgroundColor: '#fafafa' }}
        variants={V.classic.container} initial="hidden" whileInView="visible" {...VIEW}>
        <div className="max-w-3xl mx-auto">
          <motion.div variants={V.classic.item} className="text-center mb-14">
            {sectionKicker('השירותים שלנו')}
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: clrHead }}>מה אנחנו מציעים</h2>
            {divider}
          </motion.div>
          <div className="flex flex-col divide-y" style={{ borderColor: `${primary}1a` }}>
            {services.map((s, i) => (
              <motion.div key={s.id} variants={V.classic.item}
                className="flex items-start gap-5 py-6">
                <div className={`w-10 h-10 flex-shrink-0 ${theme.badgeRadius} flex items-center justify-center text-sm font-bold`}
                  style={{ border: `2px solid ${primary}`, color: primary }}>
                  {i + 1}
                </div>
                <div className="flex flex-col gap-1.5 min-w-0">
                  <EditableText as="h3" className="font-bold text-lg text-slate-800"
                    value={getEdit(`services.${i}.title`, s.title)}
                    onCommit={(v) => setEdit(`services.${i}.title`, v)}
                    isEditing={isEditingMode} />
                  <EditableText as="p" className="text-sm leading-relaxed" style={{ color: clrMuted }}
                    value={getEdit(`services.${i}.description`, s.description)}
                    onCommit={(v) => setEdit(`services.${i}.description`, v)}
                    isEditing={isEditingMode} />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>
    );
  }

  function renderBenefitsCardsBlock(isAlt: boolean) {
    const benefits = ai_content.benefits ?? [];
    if (!benefits.length) return null;
    const bg = isAlt ? sectionBgAlt : sectionBg;
    return (
      <section className="relative overflow-hidden px-6 py-20" style={bg ?? { backgroundColor: '#f8fafc' }}>
        <div className="absolute -top-40 -right-24 w-[480px] h-[480px] rounded-full blur-3xl opacity-20 pointer-events-none"
          style={{ backgroundColor: primary }} />
        <div className="relative max-w-4xl mx-auto">
          <motion.div className="text-center mb-14"
            initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.6, ease: EASE_SMOOTH }}>
            {sectionKicker('היתרונות שלנו')}
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: clrHead }}>למה לבחור בנו</h2>
            {divider}
          </motion.div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {benefits.map((b, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, y: 28, scale: 0.97 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.55, delay: i * 0.1, ease: EASE_EXPO }}
                className={`flex flex-col gap-4 p-6 ${theme.cardRadius} bg-white/80 backdrop-blur-md border border-white/60 shadow-lg hover:-translate-y-1.5 hover:shadow-2xl transition-all duration-300`}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundImage: `linear-gradient(135deg, ${primary}, ${accent})` }}>
                  <Check size={18} color="#fff" />
                </div>
                <EditableText as="h3" className="font-bold text-slate-800 leading-tight"
                  value={getEdit(`benefits.${i}.title`, b.title)}
                  onCommit={(v) => setEdit(`benefits.${i}.title`, v)}
                  isEditing={isEditingMode} />
                <EditableText as="p" className="text-sm leading-relaxed" style={{ color: clrMuted }}
                  value={getEdit(`benefits.${i}.description`, b.description)}
                  onCommit={(v) => setEdit(`benefits.${i}.description`, v)}
                  isEditing={isEditingMode} />
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  function renderProcessTimelineBlock(isAlt: boolean) {
    const steps = ai_content.process_steps ?? [];
    if (!steps.length) return null;
    const bg = isAlt ? sectionBgAlt : sectionBg;
    return (
      <section className="relative overflow-hidden px-6 py-20" style={bg ?? { backgroundColor: '#ffffff' }}>
        <div className="absolute top-0 right-1/2 w-[500px] h-[300px] rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ backgroundColor: secondary }} />
        <div className="relative max-w-2xl mx-auto">
          <motion.div className="text-center mb-16"
            initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.6, ease: EASE_SMOOTH }}>
            {sectionKicker('התהליך שלנו')}
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: clrHead }}>איך זה עובד</h2>
            {divider}
          </motion.div>
          <div className="relative flex flex-col gap-0">
            {steps.map((step, i) => (
              <motion.div key={step.step_number ?? i}
                initial={{ opacity: 0, x: 32 }} whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.5, delay: i * 0.12, ease: EASE_SMOOTH }}
                className="flex gap-6 pb-10 last:pb-0 relative">
                {i < steps.length - 1 && (
                  <div className="absolute right-7 top-14 bottom-0 w-px pointer-events-none"
                    style={{ backgroundImage: `linear-gradient(to bottom, ${primary}60, ${primary}10)` }} />
                )}
                <div className="flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center text-base font-black shadow-lg ring-4 ring-white z-10"
                  style={{ backgroundImage: `linear-gradient(135deg, ${primary}, ${accent})`, color: '#fff' }}>
                  {step.step_number ?? i + 1}
                </div>
                <div className="flex flex-col gap-1.5 pt-3 min-w-0">
                  <EditableText as="h3" className="font-bold text-slate-800 leading-tight"
                    value={getEdit(`process_steps.${i}.title`, step.title)}
                    onCommit={(v) => setEdit(`process_steps.${i}.title`, v)}
                    isEditing={isEditingMode} />
                  <EditableText as="p" className="text-sm text-slate-500 leading-relaxed"
                    value={getEdit(`process_steps.${i}.description`, step.description)}
                    onCommit={(v) => setEdit(`process_steps.${i}.description`, v)}
                    isEditing={isEditingMode} />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  function renderCtaBannerBlock() {
    const ctaHeadline = `מוכנים להתחיל עם ${business_name}?`;
    const ctaSubline = ai_content.cta_banner_subline || heroTagline || `נשמח לענות על כל שאלה ולעזור לכם להתחיל`;
    return (
      <section className="relative overflow-hidden px-6 py-28" style={{ background: heroBg }}>
        {/* Radial glow top */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.14) 0%, transparent 55%)' }} />
        {/* Bottom depth shadow */}
        <div className="absolute bottom-0 left-0 right-0 h-40 pointer-events-none"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.13), transparent)' }} />

        <div className="relative max-w-2xl mx-auto text-center">
          <motion.div className="flex flex-col items-center gap-7"
            initial={{ opacity: 0, y: 32 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.7, ease: EASE_SMOOTH }}>

            {/* Trust badges */}
            {(ai_content.trust_badges && ai_content.trust_badges.length > 0) ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {ai_content.trust_badges.map((badge, i) => (
                  <div key={i} className="flex items-center gap-2 px-4 py-2 rounded-full"
                    style={{ background: 'rgba(255,255,255,0.16)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.28)' }}>
                    <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13"
                      style={{ color: onPrimary, opacity: 0.9 }} aria-hidden>
                      <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-xs font-bold tracking-wide" style={{ color: onPrimary, opacity: 0.9 }}>
                      {badge.label}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 px-4 py-2 rounded-full"
                style={{ background: 'rgba(255,255,255,0.16)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.28)' }}>
                <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13"
                  style={{ color: onPrimary, opacity: 0.9 }} aria-hidden>
                  <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-xs font-bold tracking-wide" style={{ color: onPrimary, opacity: 0.9 }}>
                  מאות לקוחות מרוצים
                </span>
              </div>
            )}

            <h2 className="text-4xl sm:text-5xl font-black tracking-tight leading-tight" style={{ color: onPrimary }}>
              {ctaHeadline}
            </h2>

            <p className="text-base sm:text-lg leading-relaxed max-w-md opacity-90" style={{ color: onPrimary }}>
              {ctaSubline}
            </p>

            {/* Prominent white button */}
            <motion.a
              href={primaryCtaHref} target="_blank" rel="noopener noreferrer"
              whileHover={{ scale: 1.04, y: -2 }} whileTap={{ scale: 0.97 }}
              className="inline-flex items-center gap-3 px-10 py-4 font-extrabold text-lg transition-shadow"
              style={{
                borderRadius: btnR,
                backgroundColor: '#ffffff',
                color: primary,
                boxShadow: '0 8px 32px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12)',
              }}>
              {ctaIcon}{ctaText}
            </motion.a>

            {/* Micro trust line — niche-neutral so it fits any business (shop, clinic, agency…) */}
            <p className="text-xs opacity-60 tracking-wide" style={{ color: onPrimary }}>
              מענה אישי ומהיר · שירות אמין ומקצועי
            </p>
          </motion.div>
        </div>
      </section>
    );
  }

  function renderComparisonTableBlock(isAlt: boolean) {
    const bg = isAlt ? sectionBgAlt : sectionBg;
    const rows: Array<{ feature: string; us: boolean; them: boolean }> = [
      { feature: 'מענה אישי ומהיר', us: true, them: false },
      { feature: 'מחיר שקוף ללא הפתעות', us: true, them: false },
      { feature: 'ניסיון מוכח בתחום', us: true, them: true },
    ];
    return (
      <section className={`${theme.fallbackBg} relative overflow-hidden px-6 py-20`} style={bg ?? { backgroundColor: '#f8fafc' }}>
        <div className="absolute -top-32 -right-24 w-[400px] h-[400px] rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ backgroundColor: primary }} />
        <div className="relative max-w-3xl mx-auto">
          <motion.div className="text-center mb-14"
            initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.6, ease: EASE_SMOOTH }}>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: clrHead }}>למה אנחנו?</h2>
            {divider}
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.6, ease: EASE_EXPO }}
            className={`overflow-hidden ${theme.cardRadius} border border-slate-200 bg-white/90 backdrop-blur-sm shadow-lg`}>
            {/* Table header */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-0">
              <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
                <span className="text-xs font-black tracking-[0.15em] uppercase text-slate-400">השוואה</span>
              </div>
              <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 text-center border-r border-slate-200 min-w-[100px]"
                style={{ backgroundColor: `${primary}12` }}>
                <span className="text-xs font-black tracking-wide" style={{ color: primary }}>אצלנו</span>
              </div>
              <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 text-center min-w-[100px]">
                <span className="text-xs font-black tracking-wide text-slate-400">אחרים</span>
              </div>
            </div>
            {/* Rows */}
            {rows.map((row, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, x: 16 }} whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.4, delay: i * 0.08, ease: EASE_SMOOTH }}
                className={`grid grid-cols-[1fr_auto_auto] gap-0 ${i < rows.length - 1 ? 'border-b border-slate-100' : ''}`}>
                <div className="px-6 py-4 flex items-center">
                  <EditableText as="span" className="text-sm font-semibold text-slate-700"
                    value={getEdit(`comparison_table.${i}.feature`, row.feature)}
                    onCommit={(v) => setEdit(`comparison_table.${i}.feature`, v)}
                    isEditing={isEditingMode} />
                </div>
                <div className="px-6 py-4 flex items-center justify-center border-r border-slate-100 min-w-[100px]"
                  style={{ backgroundColor: `${primary}06` }}>
                  {row.us ? (
                    <div className="w-7 h-7 rounded-full flex items-center justify-center"
                      style={{ backgroundImage: `linear-gradient(135deg, ${primary}, ${accent})` }}>
                      <Check size={14} color="#fff" strokeWidth={3} />
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center">
                      <span className="text-slate-300 font-black text-base leading-none">✕</span>
                    </div>
                  )}
                </div>
                <div className="px-6 py-4 flex items-center justify-center min-w-[100px]">
                  {row.them ? (
                    <div className="w-7 h-7 rounded-full flex items-center justify-center"
                      style={{ backgroundImage: `linear-gradient(135deg, ${primary}, ${accent})` }}>
                      <Check size={14} color="#fff" strokeWidth={3} />
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center">
                      <span className="text-slate-300 font-black text-base leading-none">✕</span>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>
    );
  }

  function renderPortfolioGridBlock(isAlt: boolean) {
    const bg = isAlt ? sectionBgAlt : sectionBg;
    const allImages = [...(heroImageUrl ? [] : []), ...iconUrls, ...legacyImages].filter(Boolean);
    const gridImages = allImages.slice(0, 6);
    const displayCount = Math.max(gridImages.length, isEditingMode ? 4 : 0);
    if (!displayCount && !isEditingMode) return null;
    return (
      <section className={`${theme.fallbackBg} relative overflow-hidden px-6 py-20`} style={bg ?? { backgroundColor: '#ffffff' }}>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[260px] rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ backgroundColor: secondary }} />
        <div className="relative max-w-4xl mx-auto">
          <motion.div className="text-center mb-14"
            initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.6, ease: EASE_SMOOTH }}>
            <EditableText as="h2" className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: clrHead }}
              value={getEdit('portfolio.heading', 'תיק עבודות')}
              onCommit={(v) => setEdit('portfolio.heading', v)}
              isEditing={isEditingMode} />
            {divider}
          </motion.div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
            {Array.from({ length: Math.max(displayCount, 4) }).map((_, i) => {
              const src = gridImages[i];
              return (
                <motion.div key={i}
                  initial={{ opacity: 0, scale: 0.96 }} whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true, margin: '-60px' }}
                  transition={{ duration: 0.5, delay: i * 0.07, ease: EASE_EXPO }}
                  className={`relative overflow-hidden ${theme.cardRadius} ${i === 0 ? 'col-span-2 row-span-2 aspect-square sm:aspect-[4/3]' : 'aspect-square'} bg-slate-100 shadow-md hover:-translate-y-1 hover:shadow-xl transition-all duration-300`}>
                  <EditableImage
                    src={src}
                    primaryColor={primary}
                    secondaryColor={secondary}
                    logoUrl={logo_url}
                    className="absolute inset-0 w-full h-full"
                    style={imgTreatmentStyle}
                    isEditingMode={isEditingMode}
                    canEdit={!!canEdit}
                    onEditClick={() => openImageModal(`portfolio_${i}`)}
                  />
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  const blockMap: Record<string, (isAlt: boolean) => React.ReactNode> = {
    // Both hero block ids dispatch through renderHeroBlock, which picks the
    // actual variant (center / split / fullbleed) from design_style + whether
    // a real hero image exists — see resolveHeroVariant above. Likewise both
    // services block ids dispatch through renderServicesBlock (grid / bento /
    // rows / iconlist), picked by item count + design_style — see
    // resolveServicesVariant. This overrides the AI's structural_layout/
    // layout_composition guess with a render-time decision driven by real,
    // checkable signals, which is what actually varies the page's SHAPE
    // rather than just its color.
    'hero_center':        () => renderHeroBlock(),
    'hero_split':         () => renderHeroBlock(),
    'services_bento':     (isAlt) => renderServicesBlock(isAlt),
    'services_grid':      (isAlt) => renderServicesBlock(isAlt),
    'benefits_list':      () => renderBenefits(),
    'benefits_cards':     (isAlt) => renderBenefitsCardsBlock(isAlt),
    'process_timeline':   (isAlt) => renderProcessTimelineBlock(isAlt),
    'process_horizontal': () => renderProcessSteps(),
    'testimonials_grid':  () => renderTestimonials(),
    'faq_accordion':      () => renderFaq(),
    'cta_banner':         () => renderCtaBannerBlock(),
    'comparison_table':   (isAlt) => renderComparisonTableBlock(isAlt),
    'portfolio_grid':     (isAlt) => renderPortfolioGridBlock(isAlt),
  };

  // ── Dispatch to correct layout ────────────────────────────────────────────

  const BLOCK_LABELS: Record<string, string> = {
    'services_bento': 'שירותים', 'services_grid': 'שירותים',
    'benefits_list': 'יתרונות', 'benefits_cards': 'יתרונות',
    'process_timeline': 'תהליך', 'process_horizontal': 'תהליך',
    'testimonials_grid': 'המלצות', 'faq_accordion': 'שאלות נפוצות',
    'cta_banner': 'קריאה לפעולה', 'about': 'קצת עלינו',
    'comparison_table': 'השוואת מתחרים', 'portfolio_grid': 'תיק עבודות',
  };

  function renderLayout() {
    if (!ai_content.layout_composition) {
      console.error('[Generative UI] missing layout_composition in ai_content — falling back to static composition. Check AI service output.');
    }
    const VALID_BLOCKS = new Set(['hero_center', 'hero_split', 'services_bento', 'services_grid', 'benefits_list', 'benefits_cards', 'process_timeline', 'process_horizontal', 'testimonials_grid', 'faq_accordion', 'cta_banner', 'comparison_table', 'portfolio_grid']);
    const composition = ai_content.layout_composition ?? getFallbackComposition();
    const nodes: React.ReactNode[] = [];
    let sectionIdx = 0;

    for (const blockId of composition) {
      if (!VALID_BLOCKS.has(blockId)) continue;
      const isHero = blockId === 'hero_center' || blockId === 'hero_split';
      const isAlt = sectionIdx % 2 !== 0;
      const isHidden = hiddenSections.includes(blockId);

      const node = blockMap[blockId]?.(isAlt);
      if (node != null) {
        if (isHero) {
          // Hero blocks are never hideable
          nodes.push(<React.Fragment key={`${blockId}-${sectionIdx}`}>{node}</React.Fragment>);
        } else {
          nodes.push(
            <SectionEditorWrapper
              key={`${blockId}-${sectionIdx}`}
              isEditing={isEditingMode}
              isHidden={isHidden}
              label={BLOCK_LABELS[blockId] ?? blockId}
              onToggleHide={() => toggleSectionVisibility(blockId)}
            >
              {node}
            </SectionEditorWrapper>
          );
        }
      }

      if (isHero && (ai_content.about?.content || isEditingMode)) {
        sectionIdx++;
        const aboutHidden = hiddenSections.includes('about');
        const aboutNode = renderAboutSection(sectionIdx % 2 !== 0);
        if (aboutNode) {
          nodes.push(
            <SectionEditorWrapper
              key={`about-${sectionIdx}`}
              isEditing={isEditingMode}
              isHidden={aboutHidden}
              label={BLOCK_LABELS['about']}
              onToggleHide={() => toggleSectionVisibility('about')}
            >
              {aboutNode}
            </SectionEditorWrapper>
          );
        }
      }

      sectionIdx++;
    }

    // ── Macro-layout wrapper ────────────────────────────────────────────────
    const macroLayout = structural; // already computed from page_strategy → hints → 'classic'

    if (macroLayout === 'split') {
      return (
        <div className="lg:grid lg:grid-cols-2 items-start relative">
          <div className="lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] overflow-hidden">
            {nodes[0]}
          </div>
          <div className="flex flex-col">
            {nodes.slice(1)}
          </div>
        </div>
      );
    }

    if (macroLayout === 'bento') {
      return (
        <div className="bg-slate-50 px-4 py-8 sm:py-12 flex flex-col gap-6 sm:gap-10">
          {nodes.map((node, i) => (
            <div key={i} className="max-w-6xl mx-auto w-full rounded-3xl overflow-hidden shadow-sm border border-slate-200/60">
              {node}
            </div>
          ))}
        </div>
      );
    }

    if (macroLayout === 'editorial') {
      return (
        <div className="bg-white flex flex-col gap-20 sm:gap-32 py-16 sm:py-24 editorial-macro">
          <style>{`.editorial-macro section { box-shadow: none !important; } .editorial-macro .shadow-lg, .editorial-macro .shadow-xl, .editorial-macro .shadow-2xl { --tw-shadow: 0 0 #0000; box-shadow: var(--tw-shadow); }`}</style>
          {nodes}
        </div>
      );
    }

    // classic (default)
    return <div className="flex flex-col">{nodes}</div>;
  }

  // ── Shared lead form ──────────────────────────────────────────────────────
  async function handleLeadSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isDraft || leadSubmitting) return;
    if (!page) return;

    setLeadSubmitting(true);
    setLeadError(null);
    try {
      const res = await fetch(`/api/landing/${page.id}/lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: leadName.trim(),
          phone: leadPhone.trim(),
          email: leadEmail.trim() || undefined,
          message: leadMessage.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `שגיאה ${res.status}`);
      }
      setLeadSent(true);
      setLeadName('');
      setLeadPhone('');
      setLeadEmail('');
      setLeadMessage('');
    } catch (err) {
      setLeadError(err instanceof Error ? err.message : 'שגיאה בשליחת הפרטים. אנא נסו שוב.');
    } finally {
      setLeadSubmitting(false);
    }
  }

  function renderLeadForm() {
    return (
      <motion.section className="px-6 py-16" style={sectionBgAlt ?? { backgroundColor: '#f8fafc' }}
        variants={V.classic.container} initial="hidden" whileInView="visible" {...VIEW}>
        <div className="max-w-md mx-auto">
          <motion.div variants={V.classic.item} className="text-center mb-8">
            <h2 className="text-2xl font-bold" style={{ color: clrHead }}>השאירו פרטים</h2>
            {divider}
            <p className="mt-3 text-sm" style={{ color: clrBody }}>ניצור איתכם קשר בהקדם</p>
          </motion.div>

          {leadSent ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-3 py-10 text-center"
            >
              <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl shadow-md"
                style={{ backgroundColor: primary, color: textOnColor(primary) }}>✓</div>
              <p className="text-xl font-bold" style={{ color: clrHead }}>פרטיך התקבלו בהצלחה!</p>
              <p className="text-sm" style={{ color: clrBody }}>ניצור איתך קשר בהקדם האפשרי.</p>
            </motion.div>
          ) : (
            <>
              {isDraft && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 text-center font-medium">
                  הדף עדיין בטיוטה — לא ניתן לשלוח פניות דרך הטופס עד לפרסום הדף
                </div>
              )}
              <form onSubmit={handleLeadSubmit} className="flex flex-col gap-4">
                {[
                  { label: 'שם מלא *', type: 'text',  value: leadName,  set: setLeadName,  placeholder: 'ישראל ישראלי',  dir: 'rtl' as const, required: true  },
                  { label: 'טלפון *',  type: 'tel',   value: leadPhone, set: setLeadPhone, placeholder: '050-0000000',    dir: 'ltr' as const, required: true  },
                  { label: 'אימייל',   type: 'email', value: leadEmail, set: setLeadEmail, placeholder: 'you@example.com', dir: 'ltr' as const, required: false },
                ].map(({ label, type, value, set, placeholder, dir, required }) => (
                  <div key={label} className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium" style={{ color: clrHead }}>{label}</label>
                    <input
                      type={type}
                      required={required}
                      value={value}
                      onChange={(e) => set(e.target.value)}
                      placeholder={placeholder}
                      dir={dir}
                      disabled={leadSubmitting}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:ring-2 transition disabled:opacity-60"
                      style={{ '--tw-ring-color': primary } as React.CSSProperties}
                    />
                  </div>
                ))}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium" style={{ color: clrHead }}>הודעה (אופציונלי)</label>
                  <textarea
                    rows={3}
                    value={leadMessage}
                    onChange={(e) => setLeadMessage(e.target.value)}
                    placeholder="ספרו לנו איך נוכל לעזור..."
                    disabled={leadSubmitting}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:ring-2 transition resize-none disabled:opacity-60"
                    style={{ '--tw-ring-color': primary } as React.CSSProperties}
                  />
                </div>

                {leadError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 text-center">
                    {leadError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isDraft || leadSubmitting}
                  className="w-full py-3.5 text-base font-bold rounded-xl transition active:scale-95 shadow-md mt-1 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={{ backgroundColor: primary, color: textOnColor(primary) }}
                >
                  {leadSubmitting ? (
                    <>
                      <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                        <path d="M12 2a10 10 0 0110 10" strokeLinecap="round" />
                      </svg>
                      שולח...
                    </>
                  ) : 'שליחה'}
                </button>
              </form>
            </>
          )}
        </div>
      </motion.section>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  const ogDescription =
    heroTagline ||
    ai_content.about?.content?.slice(0, 150) ||
    'דף נחיתה מקצועי';

  const toolbarVisible = !!canEdit;
  const fabBottom = toolbarVisible ? 'bottom-20' : 'bottom-6';

  return (
    <div dir="rtl" className={`lp-root min-h-screen bg-white ${fontClass}`} style={{ fontFamily: `${bodyFont}, system-ui, sans-serif` }}>
      <Helmet>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@400;500;700;900&family=Assistant:wght@300;400;600;700&family=Heebo:wght@300;400;500;700;800;900&family=Rubik:wght@300;400;500;700;800&display=swap" rel="stylesheet" />
        <style>{`.lp-root h1,.lp-root h2,.lp-root h3{font-family:${headingFont},system-ui,sans-serif}`}</style>
        {/* White-label is a PAID agency perk: when it's on, the "| Pagey" suffix
            must be gone here too. The server-rendered <title> in
            og.controller.ts already respected whiteLabel, but this Helmet tag
            overwrote it in the browser, so paying agency customers still saw
            "| Pagey" in the tab — the perk was sold and only half-delivered. */}
        <title>{whiteLabel
          ? (ai_content.seo_title || business_name || 'דף נחיתה')
          : `${ai_content.seo_title || business_name || 'דף נחיתה'} | Pagey`}</title>
        <meta name="description" content={ai_content.seo_description ?? ogDescription} />
        <meta property="og:title" content={(ai_content.seo_title || business_name || 'דף נחיתה')} />
        <meta property="og:description" content={ai_content.seo_description ?? ogDescription} />
        <meta property="og:type" content="website" />
        {heroImageUrl && <meta property="og:image" content={heroImageUrl} />}
        <meta property="og:locale" content="he_IL" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={(ai_content.seo_title || business_name || 'דף נחיתה')} />
        <meta name="twitter:description" content={ai_content.seo_description ?? ogDescription} />
        {heroImageUrl && <meta name="twitter:image" content={heroImageUrl} />}
      </Helmet>

      {/* Sticky glassmorphism header */}
      <header className="fixed top-0 inset-x-0 z-50 h-16 backdrop-blur-md bg-white/80 border-b border-slate-100/60 shadow-sm">
        <div className="max-w-5xl mx-auto h-full flex items-center justify-between px-4">
          <a href={primaryCtaHref} target="_blank" rel="noopener noreferrer"
            className="text-sm font-semibold px-4 py-2 text-white transition hover:opacity-90 active:scale-95"
            style={{ backgroundColor: primary, borderRadius: vibe === 'luxury' ? '4px' : '10px' }}>
            {ctaText}
          </a>
          {canEdit && user?.email && (
            <WalletBadge
              email={user.email}
              refreshKey={creditsRefreshKey}
              onLoad={setCredits}
            />
          )}
          <div className="flex items-center gap-2.5">
            {logo_url && <img src={logo_url} alt={business_name} className="h-8 w-8 rounded-lg object-contain" />}
            <span className="font-bold text-slate-800 text-sm">{business_name}</span>
          </div>
        </div>
      </header>

      {/* Draft banner — visible to all visitors when page is in draft.
          The copy must stay TRUE: a draft page is served by the public,
          unauthenticated GET /api/landing/:slug, so anyone holding the link
          sees the full page. What a draft cannot do is receive submissions —
          the lead endpoint rejects them server-side (lead.controller.ts). */}
      {isDraft && (
        <div className="fixed top-16 inset-x-0 z-40 flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-50 border-b border-amber-200 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-amber-800 font-medium min-w-0">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0 text-amber-500" aria-hidden>
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <span className="truncate">הדף במצב טיוטה: גלוי לכל מי שיש לו הקישור, אך לא ניתן לשלוח דרכו פניות עד לפרסום</span>
          </div>
          {canEdit && (
            <button
              onClick={openPublishFlow}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition active:scale-95 shadow-sm whitespace-nowrap"
              style={{ backgroundColor: '#f59e0b' }}>
              שחרר דף לאוויר ←
            </button>
          )}
        </div>
      )}

      {/* Dynamic layout body */}
      {renderLayout()}

      {/* Lead capture form */}
      {enable_form && renderLeadForm()}

      {/* Contact footer */}
      <footer className="bg-slate-900 text-white px-6 py-16">
        <div className="max-w-md mx-auto flex flex-col items-center gap-6 text-center">
          <h2 className="text-xl font-bold">בואו נדבר</h2>
          <div className="w-10 h-0.5" style={{ backgroundImage: `linear-gradient(to right, ${primary}, ${accent})` }} />
          <div className="flex flex-col gap-3 w-full text-sm">
            {(ai_content.contact?.phone || phone_number) && (
              <div className="flex items-center justify-center gap-2 text-slate-300">
                <Phone size={15} className="flex-shrink-0" style={{ color: accent }} />
                <span dir="ltr">{ai_content.contact?.phone || phone_number}</span>
              </div>
            )}
            {ai_content.contact?.email && (
              <div className="flex items-center justify-center gap-2 text-slate-300">
                <Mail size={15} className="flex-shrink-0" style={{ color: accent }} />
                <a href={`mailto:${ai_content.contact.email}`} className="hover:text-white transition" dir="ltr">
                  {ai_content.contact.email}
                </a>
              </div>
            )}
            {ai_content.contact?.address && (
              <div className="flex items-center justify-center gap-2 text-slate-300">
                <MapPin size={15} className="flex-shrink-0" style={{ color: accent }} />
                <span>{ai_content.contact.address}</span>
              </div>
            )}
          </div>

          {(facebook_url || instagram_url) && (
            <div className="flex items-center gap-4">
              {facebook_url && (
                <a href={facebook_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-700 hover:bg-slate-600 transition" aria-label="Facebook">
                  <Globe size={18} style={{ color: accent }} />
                </a>
              )}
              {instagram_url && (
                <a href={instagram_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-700 hover:bg-slate-600 transition" aria-label="Instagram">
                  <Globe size={18} style={{ color: accent }} />
                </a>
              )}
            </div>
          )}

          <a href={primaryCtaHref} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 w-full max-w-xs justify-center py-4 text-white font-bold shadow-lg transition active:scale-95 mt-2"
            style={{ backgroundColor: useExternalLink ? primary : '#25D366', borderRadius: '16px' }}>
            {ctaIcon}{ctaText}
          </a>
        </div>
      </footer>

      {/* Viral credit line — hidden for agency-plan owners who paid for white-label */}
      {!whiteLabel && (
        <div className={`bg-white py-4 text-center ${toolbarVisible ? 'pb-20' : ''}`}>
          <a href="/" className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors">
            <LandoMark size={16} />
            נוצר באמצעות Pagey
          </a>
        </div>
      )}

      {/* Primary CTA FAB — WhatsApp or external link */}
      <a href={primaryCtaHref} target="_blank" rel="noopener noreferrer"
        aria-label={useExternalLink ? ctaText : 'פתח שיחת WhatsApp'}
        className={`fixed ${fabBottom} left-6 z-50 flex items-center justify-center w-14 h-14 rounded-full text-white shadow-xl transition-all duration-300`}
        style={{ backgroundColor: useExternalLink ? primary : '#25D366' }}>
        <span className="absolute inset-0 rounded-full animate-ping opacity-30"
          style={{ backgroundColor: useExternalLink ? primary : '#4ade80' }} />
        {useExternalLink ? <ExternalLinkIcon size={24} /> : <WhatsAppIcon size={26} />}
      </a>

      {/* Secondary WhatsApp FAB — only shown on external-link pages as a contact fallback, and only when a real WhatsApp number exists */}
      {useExternalLink && waUrl && (
        <a href={waUrl} target="_blank" rel="noopener noreferrer"
          aria-label="פתח שיחת WhatsApp"
          className={`fixed ${fabBottom} left-24 z-50 flex items-center justify-center w-12 h-12 rounded-full text-white shadow-lg transition-all duration-300`}
          style={{ backgroundColor: '#25D366' }}>
          <WhatsAppIcon size={22} />
        </a>
      )}

      {/* ── Checkout modal ──────────────────────────────────────────────────── */}
      {(checkoutStatus === 'modal' || checkoutStatus === 'paying') && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden" dir="rtl">

            {/* Coloured top strip */}
            <div className="h-1.5 w-full" style={{ backgroundImage: `linear-gradient(to left, ${primary}, ${accent})` }} />

            <div className="p-7 flex flex-col gap-5">
              {/* Close */}
              {checkoutStatus !== 'paying' && (
                <button
                  onClick={() => setCheckoutStatus('idle')}
                  className="absolute top-4 left-4 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition text-lg leading-none"
                  aria-label="סגור">×</button>
              )}

              {/* Header */}
              <div className="text-center pt-1">
                <div className="text-3xl mb-2">🔒</div>
                <h2 className="text-xl font-extrabold text-slate-900">שחרור דף לאוויר</h2>
                <p className="text-sm text-slate-500 mt-1">הדף שלך מוכן — השלם תשלום כדי לפרסם</p>
              </div>

              {/* Why a charge — plan coverage was checked and did not apply here,
                  shown BEFORE the price so the user isn't surprised by it. */}
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 text-center leading-relaxed">
                {planStatus && !planStatus.active
                  ? 'אין לך מסלול פעיל, ולכן פרסום דף זה יעלה 249 ש״ח.'
                  : 'לא זיהינו מסלול פעיל שמכסה פרסום דף זה בחינם, ולכן נדרש תשלום חד־פעמי.'}
              </div>

              {/* Price summary */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700">שחרור דף נחיתה לשנה</span>
                  <span className="text-xl font-extrabold text-slate-900">249 ש״ח</span>
                </div>
                <div className="border-t border-slate-200 pt-2.5 flex flex-col gap-1.5 text-sm text-slate-600">
                  {[
                    'פרסום מיידי — גלוי לציבור',
                    'טפסי יצירת קשר פעילים',
                    'תוקף לשנה מלאה',
                    '20 עריכות AI כלולות',
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-2">
                      <span className="text-emerald-500 font-bold text-base leading-none">✓</span>
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              {/* Secure redirect notice — card details are entered on SUMIT's
                  secure page, never here (PCI-safe). */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
                <span className="text-xl leading-none mt-0.5">🔐</span>
                <p className="text-sm text-slate-600 leading-relaxed">
                  התשלום מתבצע בעמוד המאובטח של <span className="font-semibold">סאמיט</span>. נעביר אותך לשם להזנת פרטי הכרטיס, וחשבונית מס תישלח אליך אוטומטית.
                </p>
              </div>

              {/* Error message — surfaces a failed publish instead of silently closing */}
              {checkoutError && (
                <div className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 text-center">
                  {checkoutError}
                </div>
              )}

              {/* Pay CTA */}
              <button
                onClick={checkout}
                disabled={checkoutStatus === 'paying'}
                className="w-full py-4 rounded-xl text-base font-extrabold text-white transition active:scale-95 disabled:opacity-80 flex items-center justify-center gap-2.5 shadow-lg"
                style={{ backgroundColor: checkoutStatus === 'paying' ? '#94a3b8' : primary }}>
                {checkoutStatus === 'paying' ? (
                  <>
                    <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 0110 10" strokeLinecap="round" />
                    </svg>
                    מעביר לתשלום מאובטח...
                  </>
                ) : 'המשך לתשלום מאובטח — 249 ש״ח'}
              </button>

              <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden><path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" /></svg>
                סביבת בדיקה — לא יחויב כרטיס אמיתי
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Plan lookup — brief spinner while we fetch a fresh plan snapshot ──── */}
      {checkoutStatus === 'loadingPlan' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
          <div className="w-full max-w-xs rounded-2xl bg-white shadow-2xl p-8 flex flex-col items-center gap-3" dir="rtl">
            <svg className="animate-spin w-7 h-7 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              <path d="M12 2a10 10 0 0110 10" strokeLinecap="round" />
            </svg>
            <p className="text-sm text-slate-500">בודקים את המסלול שלך...</p>
          </div>
        </div>
      )}

      {/* ── Plan-covered publish confirmation ───────────────────────────────────
          Shown when a fresh /api/users/plan check found an active plan with a
          free live-page slot. Nothing publishes until the user explicitly
          clicks the confirm button below — no silent balance spend. ──────── */}
      {(checkoutStatus === 'confirm' || checkoutStatus === 'confirmPaying') && planStatus && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden" dir="rtl">
            <div className="h-1.5 w-full" style={{ backgroundImage: `linear-gradient(to left, ${primary}, ${accent})` }} />
            <div className="p-7 flex flex-col gap-5">
              {checkoutStatus !== 'confirmPaying' && (
                <button
                  onClick={() => setCheckoutStatus('idle')}
                  className="absolute top-4 left-4 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition text-lg leading-none"
                  aria-label="סגור">×</button>
              )}

              <div className="text-center pt-1">
                <div className="text-3xl mb-2">✅</div>
                <h2 className="text-xl font-extrabold text-slate-900">שחרור דף לאוויר — כלול במסלול שלך</h2>
                <p className="text-sm text-slate-500 mt-1">אין תשלום נוסף — הפרסום ינוכה מיתרת הדפים הפעילים במסלול {planStatus.label}</p>
              </div>

              {/* Plan balance — exactly what will happen, in plain numbers */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col gap-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">המסלול שלך</span>
                  <span className="font-extrabold text-slate-900">{planStatus.label}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">דפים פעילים כרגע</span>
                  <span className="font-semibold text-slate-800">{planStatus.activePages} מתוך {planStatus.maxActivePages}</span>
                </div>
                <div className="border-t border-slate-200 pt-2.5 flex items-center justify-between">
                  <span className="text-slate-600">יישארו לך לאחר הפרסום</span>
                  <span className="font-bold text-emerald-600">
                    {planStatus.maxActivePages - planStatus.activePages - 1} דפים פעילים
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 leading-relaxed text-center">
                פרסום הדף ישתמש ב-1 מתוך {planStatus.maxActivePages} הדפים הפעילים במסלול {planStatus.label} שלך —
                יישארו לך {planStatus.maxActivePages - planStatus.activePages - 1} דפים פעילים לאחר מכן.
              </div>

              {checkoutError && (
                <div className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 text-center">
                  {checkoutError}
                </div>
              )}

              <div className="flex flex-col gap-2.5">
                <button
                  onClick={confirmPlanPublish}
                  disabled={checkoutStatus === 'confirmPaying'}
                  className="w-full py-4 rounded-xl text-base font-extrabold text-white transition active:scale-95 disabled:opacity-80 flex items-center justify-center gap-2.5 shadow-lg"
                  style={{ backgroundColor: checkoutStatus === 'confirmPaying' ? '#94a3b8' : primary }}>
                  {checkoutStatus === 'confirmPaying' ? (
                    <>
                      <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                        <path d="M12 2a10 10 0 0110 10" strokeLinecap="round" />
                      </svg>
                      מפרסמים את הדף...
                    </>
                  ) : 'אשר ופרסם עכשיו'}
                </button>
                {checkoutStatus !== 'confirmPaying' && (
                  <button
                    onClick={() => setCheckoutStatus('idle')}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold text-slate-500 hover:bg-slate-50 transition">
                    ביטול
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Plan limit reached — offer to upgrade instead of charging per page ── */}
      {checkoutStatus === 'limitReached' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden" dir="rtl">
            <div className="h-1.5 w-full bg-amber-400" />
            <div className="p-7 flex flex-col gap-5">
              <button
                onClick={() => setCheckoutStatus('idle')}
                className="absolute top-4 left-4 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition text-lg leading-none"
                aria-label="סגור">×</button>

              <div className="text-center pt-1">
                <div className="text-3xl mb-2">📦</div>
                <h2 className="text-xl font-extrabold text-slate-900">הגעת למכסת הדפים הפעילים</h2>
                <p className="text-sm text-slate-500 mt-1">
                  {planStatus
                    ? `המסלול ${planStatus.label} שלך מכסה עד ${planStatus.maxActivePages} דפים פעילים במקביל, וכולם בשימוש.`
                    : 'המסלול הפעיל שלך מכסה מספר מוגבל של דפים פעילים במקביל, וכולם בשימוש.'}
                </p>
              </div>

              {checkoutError && (
                <div className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 text-center">
                  {checkoutError}
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 leading-relaxed text-center">
                אפשר לשדרג מסלול כדי לפנות מקום לדפים נוספים, או להסיר/להשבית דף פעיל קיים ולפרסם במקומו.
              </div>

              <div className="flex flex-col gap-2.5">
                <Link
                  to="/dashboard?upgrade=1"
                  className="w-full py-4 rounded-xl text-base font-extrabold text-white transition active:scale-95 shadow-lg text-center"
                  style={{ backgroundColor: primary }}>
                  שדרג מסלול
                </Link>
                <button
                  onClick={() => setCheckoutStatus('idle')}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold text-slate-500 hover:bg-slate-50 transition">
                  ביטול
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Publish success — explicit confirmation instead of the modal just
          silently disappearing once the page's status flips to 'published'. */}
      {checkoutStatus === 'done' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden" dir="rtl">
            <div className="h-1.5 w-full bg-emerald-500" />
            <div className="p-7 flex flex-col items-center gap-4 text-center">
              <div className="text-4xl">🎉</div>
              <h2 className="text-xl font-extrabold text-slate-900">הדף פורסם בהצלחה!</h2>
              <p className="text-sm text-slate-500">
                {planStatus && planStatus.active
                  ? `נוצל 1 מדפי המסלול ${planStatus.label} שלך — הדף כעת גלוי לציבור.`
                  : 'הדף כעת גלוי לציבור.'}
              </p>
              <button
                onClick={() => setCheckoutStatus('idle')}
                className="w-full py-3 rounded-xl text-sm font-extrabold text-white transition active:scale-95 shadow-lg"
                style={{ backgroundColor: primary }}>
                מעולה
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Image selector modal ────────────────────────────────────────────── */}
      <ImageSelectorModal
        isOpen={imageModalSlot !== null}
        pageId={page.id}
        slot={imageModalSlot ?? ''}
        initialPrompt={imageModalPrompt}
        credits={credits}
        primaryColor={primary}
        onClose={() => setImageModalSlot(null)}
        onImageUpdated={handleImageUpdated}
      />

      {/* ── Edit toolbar — shown only to page owner / admin ─────────────────── */}
      {toolbarVisible && (
        <div className="fixed bottom-0 inset-x-0 z-50 flex items-center justify-between px-5 py-3 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-[0_-4px_24px_rgba(0,0,0,0.08)]">
          <div className="flex items-center gap-2">
            <Link
              to="/dashboard"
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 transition active:scale-95">
              <LayoutDashboard size={15} />
              לאזור אישי
            </Link>
            <button
              onClick={() => {
                if (isEditingMode) setEdits({});
                setIsEditingMode((v) => !v);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition active:scale-95"
              style={{
                backgroundColor: isEditingMode ? '#f1f5f9' : primary,
                color: isEditingMode ? '#475569' : textOnColor(primary),
              }}>
              <Pencil size={15} />
              {isEditingMode ? 'ביטול עריכה' : 'עריכת דף'}
            </button>
          </div>

          {isEditingMode && (
            <div className="flex items-center gap-3 min-w-0">
              {/* AI rewrite buttons — coming soon */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleRewrite('hero')}
                  disabled={rewriteStatus === 'rewriting'}
                  title="כתיבה מחדש של הכותרת הראשית"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition">
                  <Sparkles size={12} />
                  {rewriteStatus === 'rewriting' ? 'כותב...' : 'כתיבה מחדש לכותרת (1 ✦)'}
                </button>
                <button
                  onClick={() => handleRewrite('all')}
                  disabled={rewriteStatus === 'rewriting'}
                  title="כתיבה מחדש של כל תוכן הדף"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition">
                  <Sparkles size={12} />
                  {rewriteStatus === 'rewriting' ? 'כותב...' : 'כתיבה מחדש הכל (3 ✦)'}
                </button>
              </div>
              {saveStatus === 'saved' && (
                <span className="text-sm font-semibold text-emerald-600 flex-shrink-0">✓ נשמר!</span>
              )}
              {saveStatus === 'error' && (
                <span className="text-sm font-semibold text-red-500 flex-shrink-0">שגיאה בשמירה</span>
              )}
              <button
                onClick={save}
                disabled={saveStatus === 'saving' || (Object.keys(edits).length === 0 && !colorOverrides.primary && !colorOverrides.accent)}
                className="flex-shrink-0 flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: saveStatus === 'saving' ? '#94a3b8' : '#22c55e',
                  color: '#fff',
                }}>
                {saveStatus === 'saving' ? 'שומר...' : 'שמור שינויים'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Global palette editor — owner only, in edit mode */}
      {isEditingMode && (
        <div className="fixed top-20 left-4 z-50 w-44 rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200 shadow-xl p-4 flex flex-col gap-3" dir="rtl">
          <p className="text-xs font-bold text-slate-700">🎨 צבעי הדף</p>
          <label className="flex items-center justify-between text-sm text-slate-600">
            ראשי
            <input type="color" value={primary}
              onChange={(e) => setColorOverrides((c) => ({ ...c, primary: e.target.value }))}
              className="w-9 h-9 rounded-lg cursor-pointer border border-slate-200 bg-transparent" />
          </label>
          <label className="flex items-center justify-between text-sm text-slate-600">
            הדגשה
            <input type="color" value={secondaryAccent}
              onChange={(e) => setColorOverrides((c) => ({ ...c, accent: e.target.value }))}
              className="w-9 h-9 rounded-lg cursor-pointer border border-slate-200 bg-transparent" />
          </label>
          <p className="text-[11px] text-slate-400 leading-tight">השינוי נשמר עם "שמור שינויים"</p>
        </div>
      )}
    </div>
  );
}
