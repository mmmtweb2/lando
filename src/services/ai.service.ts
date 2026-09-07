import Anthropic from '@anthropic-ai/sdk';

// ─── Shared prompt fragments ───────────────────────────────────────────────────
// This rule is injected into every prompt that can produce consumer-visible
// copy — including single-section rewrites — because a business owner reading
// a fabricated stat, award, or quote on their own page is the single worst
// failure mode for this product. Keep this wording forceful and specific.
const NO_FABRICATION_RULE = `NO FABRICATION — THE SINGLE MOST IMPORTANT RULE (this outranks every other instruction below):
You may ONLY state facts that were explicitly given in the input (business name, niche/description, page goal,
contact details, and any user-provided marketing text). You must NEVER invent, guess, or "round up":
- specific numbers: customer/client counts, years in business, percentages, prices, ratings or star counts
- named clients, case studies, partner companies, or real-sounding testimonial quotes/authors
- awards, certifications, licenses, press mentions, or "as seen in" claims
- specific dates, deadlines, or "since [year]" founding claims
- guarantees or business-model claims (e.g. "free consultation", "money-back guarantee") unless stated in the input
If a concrete fact was not provided, write qualitative, non-numeric language instead — e.g. "ניסיון בתחום" instead of
"12 שנות ניסיון", "לקוחות מרוצים" instead of "500 לקוחות". When in doubt, leave the claim out entirely. This rule
applies even if it makes the copy feel less impressive — a vague-but-true page beats a specific-but-fabricated one.`;

// Companion to the rule above — NOT a relaxation of it. The wizard's optional
// follow-up interview (see suggestIntakeQuestions / "פרטים נוספים שסופקו" in the
// user-provided text) is designed to collect exactly the concrete facts the rule
// above otherwise forces us to write around. When such a fact IS present, using
// the vague fallback anyway is what makes every page read the same.
const USE_PROVIDED_SPECIFICS_RULE = `USE THE SPECIFICS YOU WERE GIVEN (companion to the no-fabrication rule — it does NOT relax it):
The rule above tells you to fall back to vague qualitative language ONLY when a concrete fact is missing.
When a concrete detail IS present anywhere in the input — including any "פרטים נוספים שסופקו" / Q&A block in the
user-provided text — use it VERBATIM instead of the vague substitute: write "12 שנות ניסיון" if the owner said 12
years, "הגעה תוך שעה" if they said an hour, "החל מ-350₪" if they gave that price, and name the real areas/brands/hours
they listed. Weave these specifics into hero copy, about text, service descriptions, benefits, FAQ answers and trust
badges wherever they fit naturally — they are the difference between a generic page and this business's page.
Never stretch, round, or extrapolate beyond what was actually written, and never invent a specific to fill a gap.`;

// VIBE → VOICE: sentence-level register (word choice, sentence rhythm, formality) that
// differentiates how a page SOUNDS by design_style/vibe — layered ON TOP OF, never instead
// of, the WORD DIET and ANTI-CLICHÉ rules each prompt already enforces below. This is
// deliberately a separate axis from PAGE GOAL → COPY TONE (emotional charge: reassuring/
// urgent/warm/excited) — see the note the returned block ends with for how the two combine
// when a business's vibe and goal would otherwise pull in different directions (e.g. a
// "luxury" vibe on a "donation" goal, or a "vibrant"/playful vibe on a "direct_sale" goal).
//
// design_style's real values today (Wizard.tsx DESIGN_STYLE_OPTIONS) are '', 'luxury',
// 'vibrant', 'minimal', 'warm' — mapped at render time (LandingViewer.tsx DESIGN_STYLE_VIBE)
// to the ThemeVibe names luxury/playful/corporate/warm. 'tech' is a 5th ThemeVibe the render
// engine already understands but no current design_style option produces; a voice branch for
// it is included anyway so this stays correct with zero changes if/when a 'tech' option is
// added to the Wizard, instead of silently falling through to the unspecified case.
function buildVibeVoiceBlock(input: GenerateInput): string {
  const voice =
    input.design_style === 'luxury'
      ? `"luxury": understated and confident — the opposite of a hard sell. Use short, declarative
  sentences; avoid stacking two clauses with "ו-" where one plain sentence would do. NO
  exclamation marks anywhere. Avoid superlative-reaching words like "הכי", "ללא תחרות",
  "יוקרתי ביותר" — let a specific, concrete detail (materials, craft, exclusivity, attention to
  detail) imply quality instead of asserting it outright. Address the reader with quiet
  formality ("אתם"), never slangy contractions, chat-speak, or emoji.`
      : input.design_style === 'vibrant'
      ? `"vibrant" (playful): warm, energetic, conversational — sounds like a person talking, not a
  brochure. Everyday words and natural spoken phrasing are welcome ("קבלו" rather than "אנו
  שמחים להציע לכם"); mix short, punchy sentences with an occasional longer one for rhythm. At
  most ONE exclamation mark in the ENTIRE section — spend it on the single most energetic
  line, not every sentence. Prefer plain, concrete nouns over formal or institutional ones.`
      : input.design_style === 'minimal'
      ? `"minimal" (corporate): plain, precise, low-adjective. Each sentence should carry one clear
  fact, benefit, or instruction rather than a mood. Prefer nouns and verbs over adjectives;
  when an adjective is truly needed, make it a measurable-sounding one ("תוך 24 שעות") rather
  than a mood word ("מדהים"). NO exclamation marks. Address the reader efficiently and
  formally — brisk, not cold, not warm.`
      : input.design_style === 'warm'
      ? `"warm": personal, human, unhurried. Favor words that evoke closeness and care ("קרובים
  אליכם", "מלווים אתכם לאורך הדרך") over corporate distance or process-speak. Sentences may run
  a touch longer and more conversational than the other vibes — still fully inside the WORD
  DIET caps above. ONE soft exclamation mark is acceptable when it reads as genuine warmth,
  not hype.`
      : (input.design_style as string) === 'tech'
      ? `"tech": crisp, modern, competence-first. Short, active-voice sentences; no flowery or
  emotional language. Favor precise capability/outcome words ("תוצאה מדידה", "זמן תגובה", "ממשק
  פשוט") over feeling words. NO exclamation marks — let specificity carry the confidence
  instead of enthusiasm.`
      : `unspecified — infer a plausible, moderate register from the niche/description below.
  Default to neutral-professional rather than picking a strong voice arbitrarily.`;

  return `VIBE → VOICE (sentence-level register — word choice, sentence rhythm, formality — layered
strictly INSIDE the WORD DIET and ANTI-CLICHÉ rules above: it never justifies exceeding a
word/character cap, and it never justifies reusing a banned word under a different pretext):
- ${voice}

VIBE vs. PAGE GOAL — how the two combine: VIBE controls HOW something is said (register,
rhythm, formality); PAGE GOAL controls WHAT emotional charge the message carries (reassurance /
urgency / warmth / excitement). Apply both together — never let one replace the other. When
they would pull in different directions (e.g. a "luxury" vibe on a "donation" goal, or a
"minimal" vibe on a "registration" goal), let PAGE GOAL's emotional charge win, but express it
THROUGH the vibe's word-choice/rhythm rules rather than by abandoning them — e.g. a
luxury-voiced donation page stays warm and mission-driven in WHAT it says, but keeps luxury's
short declarative sentences and still avoids exclamation marks; a minimal-voiced registration
page still creates excitement through concrete specifics, never through exclamation marks or
hype adjectives.`;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type StructuralLayout = 'bento' | 'editorial' | 'split' | 'classic';
export type FontStyle = 'sans' | 'serif' | 'rounded';
export type ThemeVibe = 'luxury' | 'playful' | 'warm' | 'corporate' | 'tech';

export interface ServiceItem {
  id: string;
  title: string;
  description: string;
  service_image_prompt?: string;  // v2 — cinematic landscape photo prompt
  service_icon_keyword?: string;  // v2 — English keyword for 3D icon generation
  icon_prompt?: string;           // v1 compat
}

export interface PageStrategy {
  detected_goal?: string;
  target_audience_emotion?: string;
  structural_layout?: StructuralLayout;
}
export interface DesignSystem {
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  bg_light_tint?: string;
  font_style?: FontStyle;
  image_keywords?: string[];
}

// v1 compat — kept for reading existing DB rows
export interface DesignHints {
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  theme_vibe?: ThemeVibe;
  font_style?: FontStyle;
  bg_style?: { type?: 'gradient' | 'solid'; colors?: string[] };
  image_keywords?: string[];
  structural_layout?: StructuralLayout;
}

export interface AiContent {
  page_strategy?: PageStrategy;
  hero?: {
    title?: string;
    subtitle?: string;
    slogan?: string;           // v1 compat
    primary_cta_text?: string;
    hero_image_prompt?: string;
  };
  about?: { heading?: string; content?: string };
  services_or_benefits?: ServiceItem[];
  services?: ServiceItem[];    // v1 compat
  // AI-generated section headings/kickers — added so each section reads as
  // written for THIS business rather than a fixed literal string. Optional:
  // pages generated before this change have none of these, so every renderer
  // must fall back to its old hardcoded Hebrew heading when a field is absent.
  services_heading?: string;
  services_kicker?: string;
  contact?: {
    phone?: string;
    email?: string;
    address?: string;
    business_hours?: string;   // free text, rendered/copied verbatim — never reformatted by the AI
    cta_text?: string;         // v1 compat
    whatsapp_message?: string;
    cta_type?: string;         // user-chosen CTA target: whatsapp|email|phone|link
  };
  design_system?: DesignSystem;
  design_hints?: DesignHints;  // v1 compat
  // v2 long-form sections
  benefits?: Array<{ title: string; description: string }>;
  benefits_heading?: string;
  benefits_kicker?: string;
  faq?: Array<{ question: string; answer: string }>;
  faq_heading?: string;
  faq_kicker?: string;
  process_steps?: Array<{ step_number: number; title: string; description: string }>;
  process_heading?: string;
  process_kicker?: string;
  testimonials?: Array<{ quote: string; author: string; role: string }>;
  testimonials_heading?: string;
  testimonials_kicker?: string;
  cta_banner_subline?: string; // closing copy for CTA section, from Call B
  seo_title?: string;          // max 60 chars — for <title> and OG tags
  seo_description?: string;    // max 150 chars — for meta description and OG
  trust_badges?: Array<{ label: string }>; // 3 short trust signals, from Call B
  typography_pairing?: 'luxury' | 'tech' | 'modern_clean';
  color_palette?: { primary: string; secondary_accent: string; surface_bg: string };
  layout_composition?: string[];
  design_tokens?: {
    image_treatment?: string; // 'rounded' | 'sharp_edges' | 'organic_blob' | 'full_bleed'
    background_effect?: string; // 'glassmorphism' | 'clean' | 'gradient' | 'textured'
    image_style?: string; // 'photo' | 'icon' — realistic photos vs 3D glassmorphism icons
  };
  hidden_sections?: string[];
}

export interface GenerateInput {
  business_name: string;
  phone_number: string;
  email?: string;
  address?: string;
  business_hours?: string;
  vibe: string;
  design_style?: string;
  image_source: string;
  about_business?: string;
  user_provided_text?: string;
  page_goal?: string;
  // Brand color overrides
  primary_color?: string;
  secondary_color?: string;
  // Vision-based color extraction
  auto_extract_colors?: boolean;
  logo_base64?: string;
  logo_media_type?: string;
  // Content options
  include_testimonials?: boolean;
  // Optional REAL testimonial supplied by the owner in the wizard — when
  // present, USE_PROVIDED_SPECIFICS_RULE applies: the AI must use it verbatim
  // instead of writing the usual "fill this in yourself" placeholder quote.
  testimonial_quote?: string;
  testimonial_author?: string;
}

// ─── Internal parallel-call intermediate types ────────────────────────────────

interface CoreOutput {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  bgLightTint: string;
  fontStyle: FontStyle;
  layoutComposition: string[];
  structuralLayout: 'classic' | 'split' | 'bento' | 'editorial';
  designTokens: { imageTreatment: string; backgroundEffect: string };
  typographyPairing: 'luxury' | 'tech' | 'modern_clean';
  colorPalette: { primary: string; secondaryAccent: string; surfaceBg: string };
  detectedGoal: string;
  targetAudienceEmotion: string;
  seoTitle: string;
  seoDescription: string;
  heroTitle: string;
  heroSubtitle: string;
  heroImagePrompt: string;
  ctaText: string;
  aboutHeading: string;
  aboutContent: string;
  services: Array<{ id: string; title: string; description: string; serviceImagePrompt: string; serviceIconKeyword: string }>;
  servicesHeading: string;
  servicesKicker: string;
  whatsappMessage: string;
  imageKeywords: string[];
  imageStyle: 'photo' | 'icon';
}

interface TrustOutput {
  benefits: Array<{ title: string; description: string }>;
  benefitsHeading: string;
  benefitsKicker: string;
  processSteps: Array<{ stepNumber: number; title: string; description: string }>;
  processHeading: string;
  processKicker: string;
  faq: Array<{ question: string; answer: string }>;
  faqHeading: string;
  faqKicker: string;
  testimonials: Array<{ quote: string; author: string; role: string }>;
  testimonialsHeading: string;
  testimonialsKicker: string;
  trustBadges: Array<{ label: string }>;
  ctaBannerSubline: string;
}

type Step1Output = CoreOutput & TrustOutput;

// ─── Robust JSON parsing ──────────────────────────────────────────────────────
// Claude is told to return raw JSON, but occasionally wraps it in ```json fences
// or adds a sentence around it. Strip fences and extract the outermost {...} so a
// stray wrapper doesn't trigger a silent fallback to generic content.
function parseJsonLoose<T>(raw: string): T {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }
  return JSON.parse(s) as T;
}

// ─── Mock ─────────────────────────────────────────────────────────────────────

function getMockContent(input: GenerateInput): AiContent {
  return {
    page_strategy: {
      detected_goal: 'Drive customer inquiries via WhatsApp',
      target_audience_emotion: 'reassured',
    },
    hero: {
      title: `ברוכים הבאים ל${input.business_name}`,
      subtitle: 'מקצועיות, אמינות ושירות ללא פשרות',
      primary_cta_text: 'צרו קשר עכשיו',
      hero_image_prompt: `Professional business interior for "${input.business_name}", ${input.vibe}, warm ambient lighting, no people, commercial photography, landscape 4:3`,
    },
    about: {
      heading: 'קצת עלינו',
      content:
        input.user_provided_text ||
        input.about_business ||
        'אנחנו עסק מוביל בתחומנו עם שנות ניסיון רבות. אנחנו מחויבים לספק את השירות הטוב ביותר לכל לקוח.',
    },
    services_or_benefits: [
      {
        id: '1',
        title: 'שירות מקצועי',
        description: 'מגיבים מהר, מקיימים הבטחות.',
        service_image_prompt: `Professional team delivering expert service for "${input.business_name}", ${input.vibe}. Cinematic lighting, photorealistic, NO text, NO watermarks, landscape orientation.`,
        service_icon_keyword: 'professional service',
      },
      {
        id: '2',
        title: 'צוות מומחים',
        description: 'ניסיון מוכח, תוצאות מיידיות.',
        service_image_prompt: `Skilled professionals at work in ${input.vibe} setting. Cinematic lighting, photorealistic, NO text, NO watermarks, landscape orientation.`,
        service_icon_keyword: 'expert team',
      },
      {
        id: '3',
        title: 'תמורה מעולה',
        description: 'תמחור שקוף, ללא הפתעות.',
        service_image_prompt: `High-quality result related to ${input.vibe}. Cinematic lighting, photorealistic, NO text, NO watermarks, landscape orientation.`,
        service_icon_keyword: 'quality value',
      },
    ],
    services_heading: 'השירותים שלנו',
    services_kicker: 'מה אנחנו מציעים',
    contact: {
      phone: input.phone_number,
      email: input.email ?? '',
      address: input.address ?? '',
      business_hours: input.business_hours ?? '',
      whatsapp_message: `שלום! מצאתי את הדף של ${input.business_name} ואשמח לקבל פרטים נוספים.`,
    },
    design_system: {
      primary_color: input.primary_color ?? '#2563eb',
      secondary_color: input.secondary_color ?? '#7c3aed',
      accent_color: '#f59e0b',
      bg_light_tint: '#f0f4ff',
      font_style: 'sans',
      image_keywords: ['professional office', 'business workspace', 'modern interior'],
    },
    benefits: [
      { title: 'שירות מהיר', description: 'מגיבים תוך שעות, לא ימים.' },
      { title: 'ניסיון מוכח', description: 'שנות שטח שהביאו עשרות לקוחות מרוצים.' },
      { title: 'תמחור שקוף', description: 'מחיר ברור מראש. אפס הפתעות.' },
    ],
    benefits_heading: 'למה לבחור בנו',
    benefits_kicker: 'היתרונות שלנו',
    faq: [
      { question: 'כיצד ניצור קשר לתיאום?', answer: 'בוואטסאפ, טלפון, או טופס הפנייה — נחזור תוך 24 שעות.' },
      { question: 'כמה זמן לוקח התהליך?', answer: 'בונים לוח זמנים מותאם אישית כבר בשיחה הראשונה.' },
      { question: 'האם יש אחריות?', answer: 'כן. עומדים מאחורי כל עבודה עד לשביעות רצונכם המלאה.' },
    ],
    faq_heading: 'שאלות נפוצות',
    faq_kicker: 'עזרה ותשובות',
    process_steps: [
      { step_number: 1, title: 'יצירת קשר', description: 'פנו אלינו ונקבע שיחת היכרות.' },
      { step_number: 2, title: 'התאמה אישית', description: 'נבנה פתרון מדויק לצרכים שלכם.' },
      { step_number: 3, title: 'תוצאה מיידית', description: 'מקבלים שירות מקצועי ותוצאה אמיתית.' },
    ],
    process_heading: 'איך זה עובד',
    process_kicker: 'התהליך שלנו',
    testimonials: input.include_testimonials
      ? (input.testimonial_quote?.trim()
          ? [
              { quote: input.testimonial_quote.trim(), author: input.testimonial_author?.trim() || 'שם הלקוח', role: '' },
              { quote: 'הכנס כאן ציטוט אמיתי של לקוח שמספר על החוויה שלו', author: 'שם הלקוח', role: 'תפקיד או עיר' },
            ]
          : [
              { quote: 'הכנס כאן ציטוט אמיתי של לקוח שמספר על החוויה שלו', author: 'שם הלקוח', role: 'תפקיד או עיר' },
              { quote: 'הכנס כאן ציטוט אמיתי של לקוח שמספר על החוויה שלו', author: 'שם הלקוח', role: 'תפקיד או עיר' },
            ])
      : [],
    testimonials_heading: 'מה לקוחות אומרים',
    testimonials_kicker: 'לקוחות מספרים',
    cta_banner_subline: `נשמח לענות על כל שאלה ולעזור לכם להתחיל`,
    seo_title: `${input.business_name} | שירות מקצועי`,
    seo_description: `גלו את ${input.business_name} — פתרונות מותאמים אישית במחיר שקוף. צרו קשר עוד היום.`,
    trust_badges: [
      { label: '100% אחריות' },
      { label: 'תגובה תוך 24 שעות' },
      { label: 'ללא התחייבות' },
    ],
    typography_pairing: 'modern_clean',
    color_palette: {
      primary: input.primary_color ?? '#2563eb',
      secondary_accent: '#f59e0b',
      surface_bg: '#f0f4ff',
    },
    layout_composition: ['hero_center', 'services_grid', 'benefits_list', 'process_timeline', 'faq_accordion', 'cta_banner'],
    design_tokens: {
      image_treatment: 'rounded',
      background_effect: 'glassmorphism',
    },
  };
}

// ─── Call A: Core & Design — palette, layout, hero, services ─────────────────

function buildCoreSystem(input: GenerateInput): string {
  const hasManualColors = input.primary_color && input.secondary_color;
  const extractFromLogo = input.auto_extract_colors && input.logo_base64;

  const colorBlock = extractFromLogo
    ? `COLOR EXTRACTION — a logo image is provided in this message:
- primaryColor: single most prominent color in the logo
- secondaryColor: second most visible color in the logo
- accentColor: warm/golden pop color harmonizing with logo colors (NEVER grey, white, or transparent)
- bgLightTint: very light tint from primaryColor — lightness MUST be ≥ 88%`
    : hasManualColors
    ? `COLOR CONSTRAINT — user has specified brand colors:
- primaryColor: use EXACTLY "${input.primary_color}" — do NOT change this hex
- secondaryColor: use EXACTLY "${input.secondary_color}" — do NOT change this hex
- accentColor: warm complementary pop color (NEVER grey, white, or near-primary)
- bgLightTint: very light tint (lightness ≥ 88%) complementary to primaryColor`
    : `COLOR DESIGN — generate a professional palette based on design_style:
- "luxury": deep jewel primary (navy/forest/burgundy), gold/cream secondary, serif font
- "vibrant": electric primary (violet/coral/cyan), contrasting secondary, sans font
- "minimal": muted slate/sage primary, low-contrast secondary, sans font
- "warm": earthy primary (terracotta/amber), warm secondary, rounded font
- (unspecified): infer from business niche
- primaryColor and secondaryColor must be visibly distinct (different hues)
- accentColor: warm-golden or bright pop — NEVER grey, white, or near-primary
- bgLightTint: MUST be very light (lightness ≥ 88%)`;

  return `You are an elite Hebrew copywriter and brand strategist for Israeli small businesses.

MISSION: Generate the CORE IDENTITY and HERO sections of a landing page — palette, layout, hero copy, and services.
The result must read as professional, benefit-led, and trustworthy — like copy a paid strategist wrote after a real
client interview — while staying strictly grounded in what the business owner actually told you.

${NO_FABRICATION_RULE}

${USE_PROVIDED_SPECIFICS_RULE}

LANGUAGE RULES (CRITICAL):
- ALL consumer-visible text MUST be in natural, fluent Hebrew
- Image prompts and imageKeywords MUST be in English
- Return ONLY a valid JSON object — no markdown fences, no explanation

WORD DIET (STRICT — no exceptions):
- heroTitle: maximum 7 Hebrew words
- heroSubtitle: maximum 15 Hebrew words — one sharp, benefit-driven sentence that makes the core value proposition unmistakable
- ctaText: exactly 3 to 4 Hebrew words
- Each service description: maximum 20 Hebrew words — specific benefit, no fluff
- aboutContent: 2-3 Hebrew sentences, drawn from user-provided text when available — confident, professional tone; state plainly what the business does and the concrete benefit to the customer, without inventing history or credentials it wasn't given
- Do NOT use vague superlatives like "מוביל", "הטוב ביותר", "מקצועי" without a concrete reason
- Each service description: Hebrew — max 20 words. Format as Action + Benefit. Example: "במקום X, קבלו Y". No passive voice.
- seoTitle: max 60 characters — business name + primary keyword, written for search engines
- seoDescription: max 150 characters — one compelling sentence, main benefit, written for meta description
- servicesHeading: maximum 4 Hebrew words — a section heading specific to what THIS business offers, never a generic
  label like "השירותים שלנו" or "מה אנחנו מציעים"
- servicesKicker: maximum 3 Hebrew words — a short uppercase eyebrow label above servicesHeading, specific to the niche

ANTI-CLICHÉ RULE (CRITICAL — violations will be rejected):
Banned words — NEVER use any of these in any Hebrew text field:
"חדשני", "מקצועיות ללא פשרות", "יחס אישי", "מוביל בתחומו", "שירות אדיב", "פתרונות מתקדמים", "ניסיון רב שנים"
If a banned word appears in your output, replace it with something concrete and specific.

INPUT COHERENCE: If the business description is incomprehensible, random characters, or has no discernible business meaning, set "detectedGoal" to exactly "UNCLEAR_INPUT" (still return valid JSON for the remaining fields).

HERO COPY — PAS FRAMEWORK (Problem → Agitation → Solution):
- heroTitle: surface the PROBLEM or DESIRE the customer has (max 7 words) — make it about them, not you
- heroSubtitle: AGITATE — name the cost of the problem or the emotional gain in 1 sentence
- ctaText: bridge to the SOLUTION — 3-4 action words

${colorBlock}

PAGE GOAL → COPY TONE:
- "lead_gen": reassuring, professional, inquiry-focused
- "direct_sale": urgent, benefit-focused, action-driving
- "donation": warm, mission-driven, impact-focused
- "registration": excited, benefit-led, community-building

${buildVibeVoiceBlock(input)}

LAYOUT COMPOSITION RULES:
Available block IDs (use ONLY these exact strings):
hero_center, hero_split, services_bento, services_grid, benefits_list, benefits_cards,
process_timeline, process_horizontal, testimonials_grid, faq_accordion, cta_banner,
portfolio_grid
// NOTE: "comparison_table" is intentionally NOT offered here (page-quality fix,
// 2026-09) — its rendered rows are 3 hardcoded generic claims plus an unnamed
// "אחרים" (competitors) column making blanket unverifiable comparisons, which
// violates NO_FABRICATION_RULE. Do not add it back without first making the
// section's content AI-personalized per business.

Strict rules:
1. Start with exactly ONE hero: hero_center OR hero_split (never both)
2. Always end with cta_banner
3. Choose 3-5 content blocks between hero and cta_banner (total array: 5-7 items)
4. Never repeat any block ID
5. Only include testimonials_grid if include_testimonials is TRUE

Art direction:
- Visual / beauty / retail / construction → hero_center, portfolio_grid, services_grid, benefits_list, faq_accordion, cta_banner
- Consulting / law / medical / coaching / direct_sale → hero_split, process_timeline, benefits_cards, testimonials_grid (if allowed), faq_accordion, cta_banner
- Tech / startup / agency / SaaS → hero_split, services_bento, benefits_cards, faq_accordion, cta_banner
- Food / local / traditional / community → hero_center, services_grid, benefits_list, process_horizontal, faq_accordion, cta_banner

Also, choose a macro structuralLayout based on the niche:
- 'split': Legal, Real Estate, Medical, Consulting, High-end services.
- 'bento': Tech, SaaS, Startups, Digital products, Modern agencies.
- 'editorial': Fashion, Photography, Interior Design, Beauty, Art.
- 'classic': Local businesses, Contractors, Traditional services.

VISUAL CONTRAST RULE (CRITICAL):
- services_grid → pair with process_timeline
- services_bento → pair with process_horizontal

DESIGN TOKENS RULES:
- imageTreatment:
  - "organic_blob": beauty, wellness, florist, yoga, playful, creative
  - "sharp_edges": tech, finance, luxury, legal, architecture, minimal
  - "rounded": local, food, family, bakery, community, friendly
  - "full_bleed": photography, travel, hospitality, restaurant, visual
- backgroundEffect:
  - "glassmorphism": tech, modern, premium, startup, agency
  - "clean": medical, legal, corporate, minimalist, professional
  - "gradient": creative, vibrant, marketing, events
  - "textured": traditional, crafts, warm, artisan, local

TYPOGRAPHY PAIRING RULES:
Choose typographyPairing based on the business niche:
- "luxury": Frank Ruhl Libre headings + Assistant body — jewelry, legal, real estate, finance, architecture, fine dining, boutique fashion
- "tech": Heebo Black headings — SaaS, startup, tech services, digital agencies, software, IT
- "modern_clean": Rubik headings — all other businesses (service businesses, contractors, health, food, retail, local)

Return EXACTLY this JSON (ALL fields required — do not omit any):
{
  "primaryColor": "#hex",
  "secondaryColor": "#hex",
  "accentColor": "#hex — warm pop, never grey or white",
  "bgLightTint": "#hex — lightness ≥ 88%",
  "fontStyle": "sans | serif | rounded",
  "layoutComposition": ["hero_center", "services_grid", "benefits_list", "process_timeline", "faq_accordion", "cta_banner"],
  "structuralLayout": "classic | split | bento | editorial",
  "designTokens": {
    "imageTreatment": "rounded | sharp_edges | organic_blob | full_bleed",
    "backgroundEffect": "glassmorphism | clean | gradient | textured"
  },
  "imageStyle": "photo | icon — choose 'photo' for visual/physical niches (food, bakery, restaurant, beauty, fashion, real-estate, hospitality, events, crafts, fitness, photography) where realistic photography sells; choose 'icon' for digital/abstract niches (software, SaaS, app, agency, consulting, finance, courses, tech services)",
  "typographyPairing": "luxury | tech | modern_clean",
  "colorPalette": {
    "primary": "#hex — same as primaryColor",
    "secondaryAccent": "#hex — vivid accent for text highlights, distinct from accentColor",
    "surfaceBg": "#hex — card surface background, lightness ≥ 92%"
  },
  "detectedGoal": "one English sentence — what must this page achieve",
  "targetAudienceEmotion": "one English emotion word",
  "seoTitle": "Hebrew — max 60 chars — business name + primary keyword",
  "seoDescription": "Hebrew — max 150 chars — one compelling sentence, main benefit",
  "heroTitle": "Hebrew — max 7 words",
  "heroSubtitle": "Hebrew — max 15 words, one sharp benefit sentence",
  "heroImagePrompt": "Cinematic Flux AI prompt in English. Landscape 4:3, photorealistic, dramatic lighting, rich details. No text, no logos, no watermarks.",
  "ctaText": "Hebrew — exactly 3-4 words",
  "aboutHeading": "Hebrew — 2-3 words",
  "aboutContent": "Hebrew — 2-3 sentences, drawn heavily from user-provided text if present",
  "servicesHeading": "Hebrew — max 4 words, specific to this business's actual offering, not generic",
  "servicesKicker": "Hebrew — max 3 words, short uppercase eyebrow label specific to the niche",
  "services": [
    {
      "id": "1",
      "title": "Hebrew — 2-4 words",
      "description": "Hebrew — max 20 words. Action + Benefit format: 'במקום X, קבלו Y'. No passive voice.",
      "serviceImagePrompt": "English cinematic landscape photograph. Cinematic lighting, photorealistic, rich contextual environment, NO text, NO watermarks, landscape orientation.",
      "serviceIconKeyword": "English 1-3 word noun for 3D icon — e.g. 'plumbing pipe', 'wedding ring', 'legal scale'"
    },
    { "id": "2", "title": "...", "description": "...", "serviceImagePrompt": "...", "serviceIconKeyword": "..." },
    { "id": "3", "title": "...", "description": "...", "serviceImagePrompt": "...", "serviceIconKeyword": "..." }
  ],
  "whatsappMessage": "Hebrew — 1-2 sentences, sounds like a real customer",
  "imageKeywords": ["English landscape keyword", "keyword 2", "keyword 3"]
}

CRITICAL: Copy phone, email, address, and business hours EXACTLY as provided — never reformat or invent hours. Base copy heavily on any user-provided marketing text.`;
}

function buildCoreUser(input: GenerateInput): string {
  const lines = [
    `Generate landing page CORE content for this business:`,
    ``,
    `- Business name: ${input.business_name}`,
    `- Niche / description: ${input.vibe}`,
    `- Page goal: ${input.page_goal || 'lead_gen'}`,
    `- Design style: ${input.design_style || 'not specified — infer from niche'}`,
    `- Phone: ${input.phone_number}`,
    `- Email: ${input.email || 'not provided'}`,
    `- Address: ${input.address || 'not provided'}`,
    `- Business hours (free text, present verbatim — do not reformat or invent): ${input.business_hours || 'not provided'}`,
    `- Include testimonials section: ${input.include_testimonials ? 'YES' : 'NO'}`,
  ];
  if (input.about_business) lines.push(`- About: ${input.about_business}`);
  if (input.user_provided_text) {
    lines.push(`- PRIORITY — Existing marketing text (base all copy heavily on this):\n${input.user_provided_text}`);
  }
  if (input.auto_extract_colors && input.logo_base64) {
    lines.push(`- Logo image is provided above. Extract the two dominant brand colors from it.`);
  } else if (input.primary_color && input.secondary_color && !input.auto_extract_colors) {
    lines.push(`- User-specified colors — primaryColor MUST be "${input.primary_color}", secondaryColor MUST be "${input.secondary_color}"`);
  }
  lines.push(`\nReturn ONLY the JSON.`);
  return lines.join('\n');
}

// ─── Call B: Trust & Conversion — benefits, process, faq, testimonials ────────

// Builds the literal "testimonials" example array embedded in Call B's JSON
// schema. When the owner supplied a real quote in the wizard, the FIRST
// example testimonial is that real quote/author (verbatim, JSON-escaped) so
// the model has an unambiguous, concrete example to copy instead of having to
// infer the substitution from prose rules alone.
function buildTestimonialsExampleJson(input: GenerateInput): string {
  if (!input.include_testimonials) return '[]';
  const placeholder = '{ "quote": "הכנס כאן ציטוט אמיתי של לקוח שמספר על החוויה שלו", "author": "שם הלקוח", "role": "תפקיד או עיר" }';
  const realQuote = input.testimonial_quote?.trim();
  if (realQuote) {
    const realAuthor = input.testimonial_author?.trim() || 'שם הלקוח';
    const real = `{ "quote": ${JSON.stringify(realQuote)}, "author": ${JSON.stringify(realAuthor)}, "role": "" }`;
    return `[\n    ${real},\n    ${placeholder}\n  ]`;
  }
  return `[\n    ${placeholder},\n    ${placeholder}\n  ]`;
}

function buildTrustSystem(input: GenerateInput): string {
  return `You are an elite Hebrew conversion copywriter for Israeli small businesses.

MISSION: Generate TRUST and CONVERSION sections for a landing page — benefits, process, FAQ, testimonials, and a closing CTA line.
These sections exist to make a real, professional business feel more credible — not to manufacture credibility with
invented specifics. Every claim must survive the business owner reading it and saying "yes, that's true."

${NO_FABRICATION_RULE}

${USE_PROVIDED_SPECIFICS_RULE}

LANGUAGE RULES (CRITICAL):
- ALL text MUST be in natural, fluent Hebrew
- Return ONLY a valid JSON object — no markdown fences, no explanation

WORD DIET (STRICT — no exceptions):
- Each benefit title: 2-4 Hebrew words
- Each benefit description: maximum 15 Hebrew words — direct, factual, scannable
- Each process step title: 2-3 Hebrew words
- Each process step description: maximum 15 Hebrew words — action-oriented verb phrase
- Each FAQ answer: maximum 25 Hebrew words — authoritative, no hedging
- ctaBannerSubline: 1 punchy Hebrew sentence, max 15 words — creates urgency or desire
- Do NOT use vague superlatives or filler. Be direct and authoritative.
- benefitsHeading, processHeading, testimonialsHeading, faqHeading: maximum 4 Hebrew words each — a section
  heading specific to this business/niche, never a generic label like "למה לבחור בנו" or "איך זה עובד"
- benefitsKicker, processKicker, testimonialsKicker, faqKicker: maximum 3 Hebrew words each — short uppercase
  eyebrow labels above their matching heading, specific to the niche

ANTI-CLICHÉ RULE (CRITICAL):
Banned words — NEVER use any of these in any Hebrew text:
"חדשני", "מקצועיות ללא פשרות", "יחס אישי", "מוביל בתחומו", "שירות אדיב", "פתרונות מתקדמים", "ניסיון רב שנים"

${buildVibeVoiceBlock(input)}

SECTION RULES:
- benefits: EXACTLY 3 items — concrete value, never invented facts, grounded in the business niche
- processSteps: EXACTLY 3 items — Contact → Action → Result arc
- faq: 3 to 5 items — realistic questions a real customer of THIS specific business would ask

TRUST BADGES RULE:
- Generate EXACTLY 3 trust badges relevant to the specific niche
- Each label: 2-3 Hebrew words maximum — short, punchy, credibility signals
- Examples (style only): "אחריות מלאה", "תגובה מהירה", "תשלום אחרי תוצאה", "ליווי אישי"
- Match the badge claims to the business niche — do NOT use generic empty promises
- Do NOT invent numeric claims (years, counts, ratings) unless they were provided in the input

TESTIMONIALS RULE:
- include_testimonials = ${input.include_testimonials ? 'TRUE' : 'FALSE'}
- If FALSE: "testimonials" MUST be an empty array []. Do NOT generate any quotes, names, or roles.${
  input.include_testimonials && input.testimonial_quote?.trim()
    ? `
- If TRUE: a REAL customer quote was supplied by the owner (see below) — per USE_PROVIDED_SPECIFICS_RULE, the
  FIRST testimonial's "quote" and "author" MUST be that real text VERBATIM, with NO rewriting or paraphrasing.
  Its "role" MUST be "" (empty string) — do NOT invent a role/city that was not given. The SECOND testimonial
  MUST still be EXACTLY the placeholder: quote "הכנס כאן ציטוט אמיתי של לקוח שמספר על החוויה שלו", author
  "שם הלקוח", role "תפקיד או עיר".`
    : `
- If TRUE: both "quote" fields MUST be EXACTLY "הכנס כאן ציטוט אמיתי של לקוח שמספר על החוויה שלו" — verbatim, unaltered. "author" MUST be EXACTLY "שם הלקוח", "role" MUST be EXACTLY "תפקיד או עיר". DO NOT invent real-sounding quotes, names, or roles.`
}

Return EXACTLY this JSON (ALL fields required):
{
  "benefits": [
    { "title": "Hebrew 2-4 words", "description": "Hebrew max 15 words" },
    { "title": "...", "description": "..." },
    { "title": "...", "description": "..." }
  ],
  "benefitsHeading": "Hebrew — max 4 words, specific to this business, not generic",
  "benefitsKicker": "Hebrew — max 3 words, short uppercase eyebrow label",
  "processSteps": [
    { "stepNumber": 1, "title": "Hebrew 2-3 words", "description": "Hebrew max 15 words" },
    { "stepNumber": 2, "title": "...", "description": "..." },
    { "stepNumber": 3, "title": "...", "description": "..." }
  ],
  "processHeading": "Hebrew — max 4 words, specific to this business, not generic",
  "processKicker": "Hebrew — max 3 words, short uppercase eyebrow label",
  "faq": [
    { "question": "Hebrew question specific to this business", "answer": "Hebrew max 25 words" },
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." }
  ],
  "faqHeading": "Hebrew — max 4 words, specific to this business, not generic",
  "faqKicker": "Hebrew — max 3 words, short uppercase eyebrow label",
  "testimonials": ${buildTestimonialsExampleJson(input)},
  "testimonialsHeading": "Hebrew — max 4 words, specific to this business, not generic",
  "testimonialsKicker": "Hebrew — max 3 words, short uppercase eyebrow label",
  "trustBadges": [
    { "label": "Hebrew 2-3 words" },
    { "label": "..." },
    { "label": "..." }
  ],
  "ctaBannerSubline": "Hebrew — 1 sentence max 15 words, creates urgency or concrete promise"
}`;
}

function buildTrustUser(input: GenerateInput): string {
  const lines = [
    `Generate landing page TRUST content for this business:`,
    ``,
    `- Business name: ${input.business_name}`,
    `- Niche / description: ${input.vibe}`,
    `- Page goal: ${input.page_goal || 'lead_gen'}`,
  ];
  if (input.about_business) lines.push(`- About: ${input.about_business}`);
  if (input.user_provided_text) {
    lines.push(`- PRIORITY — Existing marketing text (ground benefits/FAQ in this):\n${input.user_provided_text}`);
  }
  if (input.include_testimonials && input.testimonial_quote?.trim()) {
    lines.push(
      `- REAL customer testimonial supplied by the owner — use it VERBATIM per USE_PROVIDED_SPECIFICS_RULE (do not rewrite, paraphrase, or invent a role/city for it): "${input.testimonial_quote.trim()}"`,
    );
    if (input.testimonial_author?.trim()) {
      lines.push(`- REAL testimonial author name — use it VERBATIM: "${input.testimonial_author.trim()}"`);
    }
  }
  lines.push(`\nReturn ONLY the JSON.`);
  return lines.join('\n');
}

// ─── Deterministic mapping → AiContent ───────────────────────────────────────

function mapToAiContent(s: Step1Output, input: GenerateInput): AiContent {
  return {
    page_strategy: {
      detected_goal: s.detectedGoal,
      target_audience_emotion: s.targetAudienceEmotion,
      structural_layout: s.structuralLayout ?? undefined,
    },
    hero: {
      title: s.heroTitle,
      subtitle: s.heroSubtitle,
      primary_cta_text: s.ctaText,
      hero_image_prompt: s.heroImagePrompt,
    },
    about: {
      heading: s.aboutHeading,
      content: s.aboutContent,
    },
    services_or_benefits: s.services.map((svc) => ({
      id: svc.id,
      title: svc.title,
      description: svc.description,
      service_image_prompt: svc.serviceImagePrompt,
      service_icon_keyword: svc.serviceIconKeyword,
    })),
    services_heading: s.servicesHeading || undefined,
    services_kicker: s.servicesKicker || undefined,
    typography_pairing: s.typographyPairing || 'modern_clean',
    color_palette: s.colorPalette ? {
      primary: s.colorPalette.primary,
      secondary_accent: s.colorPalette.secondaryAccent,
      surface_bg: s.colorPalette.surfaceBg,
    } : undefined,
    contact: {
      phone: input.phone_number,
      email: input.email ?? '',
      address: input.address ?? '',
      business_hours: input.business_hours ?? '',
      whatsapp_message: s.whatsappMessage,
    },
    design_system: {
      primary_color: s.primaryColor,
      secondary_color: s.secondaryColor,
      accent_color: s.accentColor,
      bg_light_tint: s.bgLightTint,
      font_style: s.fontStyle,
      image_keywords: s.imageKeywords,
    },
    benefits: s.benefits,
    benefits_heading: s.benefitsHeading || undefined,
    benefits_kicker: s.benefitsKicker || undefined,
    faq: s.faq,
    faq_heading: s.faqHeading || undefined,
    faq_kicker: s.faqKicker || undefined,
    process_steps: s.processSteps.map((step) => ({
      step_number: step.stepNumber,
      title: step.title,
      description: step.description,
    })),
    process_heading: s.processHeading || undefined,
    process_kicker: s.processKicker || undefined,
    testimonials: input.include_testimonials ? s.testimonials : [],
    testimonials_heading: s.testimonialsHeading || undefined,
    testimonials_kicker: s.testimonialsKicker || undefined,
    seo_title: s.seoTitle || undefined,
    seo_description: s.seoDescription || undefined,
    trust_badges: s.trustBadges?.length ? s.trustBadges : undefined,
    cta_banner_subline: s.ctaBannerSubline || undefined,
    layout_composition: (s.layoutComposition ?? []).filter(
      (b) =>
        (b !== 'testimonials_grid' || input.include_testimonials) &&
        // Defensive: comparison_table is no longer an offered choice (see the
        // "NOTE" in buildCoreSystem's LAYOUT COMPOSITION RULES) — strip it here
        // too in case a model response drifts and includes it anyway.
        b !== 'comparison_table',
    ),
    design_tokens: {
      image_treatment: s.designTokens?.imageTreatment || 'rounded',
      background_effect: s.designTokens?.backgroundEffect || 'glassmorphism',
      image_style: s.imageStyle || 'icon',
    },
  };
}

// ─── Micro-generation: rewrite a single section ───────────────────────────────

const ANTI_CLICHE_RULE = `ANTI-CLICHÉ RULE (CRITICAL — violations will be rejected):
Banned words — NEVER use any of these in any Hebrew text field:
"חדשני", "מקצועיות ללא פשרות", "יחס אישי", "מוביל בתחומו", "שירות אדיב", "פתרונות מתקדמים", "ניסיון רב שנים"
If a banned word appears in your output, replace it with a concrete, specific alternative.`;

const WORD_DIET_RULE = `WORD DIET (STRICT — no exceptions):
- hero title: max 7 Hebrew words — surface the customer's PROBLEM or DESIRE
- hero subtitle: max 15 Hebrew words — one sharp benefit-driven sentence
- hero CTA text: exactly 3-4 Hebrew words
- about content: 2-3 Hebrew sentences, grounded in real business facts
- service description: max 20 Hebrew words — Action + Benefit format: "במקום X, קבלו Y". No passive voice.
- Do NOT use vague superlatives without a concrete reason`;

const SECTION_SCHEMAS: Record<string, string> = {
  hero: `{
  "title": "Hebrew — max 7 words",
  "subtitle": "Hebrew — max 15 words, one sharp benefit sentence",
  "primary_cta_text": "Hebrew — exactly 3-4 words"
}`,
  about: `{
  "heading": "Hebrew — 2-3 words",
  "content": "Hebrew — 2-3 sentences"
}`,
  service: `{
  "title": "Hebrew — 2-4 words",
  "description": "Hebrew — max 20 words. Action + Benefit: 'במקום X, קבלו Y'. No passive voice."
}`,
};

export interface BusinessContext {
  business_name: string;
  vibe?: string;
  page_goal?: string;
}

export async function regenerateSectionText(
  sectionName: string,
  currentData: unknown,
  businessContext: BusinessContext,
  userPrompt?: string,
): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.warn('[AI:micro] ANTHROPIC_API_KEY not set — returning currentData unchanged');
    return currentData;
  }

  // Determine which schema applies
  const schemaKey = sectionName.startsWith('services')
    ? 'service'
    : (sectionName in SECTION_SCHEMAS ? sectionName : null);

  const schema = schemaKey ? SECTION_SCHEMAS[schemaKey] : JSON.stringify(currentData, null, 2);

  const systemPrompt = `You are an elite Hebrew copywriter and brand strategist for Israeli small businesses.

MISSION: Rewrite ONLY the requested section of a landing page. Preserve all keys and JSON structure.
Return ONLY a valid JSON object — no markdown fences, no explanation.

${NO_FABRICATION_RULE}

${WORD_DIET_RULE}

${ANTI_CLICHE_RULE}

LANGUAGE RULES:
- ALL consumer-visible text MUST be in natural, fluent Hebrew
- Return ONLY the JSON for the requested section — nothing else

Expected output schema:
${schema}`;

  const userLines = [
    `Business: ${businessContext.business_name}${businessContext.vibe ? ` (${businessContext.vibe})` : ''}`,
    `Page goal: ${businessContext.page_goal ?? 'lead_gen'}`,
    `Section to rewrite: ${sectionName}`,
    `Current data:\n${JSON.stringify(currentData, null, 2)}`,
    `Rewrite instruction: ${userPrompt ?? 'Improve this section — keep the same structure, make the copy sharper and more compelling'}`,
    `\nReturn ONLY the JSON.`,
  ];

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userLines.join('\n') }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    const parsed: unknown = parseJsonLoose(raw);
    console.log(`[AI:micro] Section "${sectionName}" rewritten successfully`);
    return parsed;
  } catch (err) {
    console.error(`[AI:micro] Failed to rewrite section "${sectionName}":`, err);
    throw new Error(`AI rewrite failed for section "${sectionName}"`);
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Cheap, strict pre-check: does the input describe a REAL business/service/cause?
 * Runs before the expensive generation so gibberish (random letters, keyboard
 * mashing) is rejected without spending credits or image cost. Relying on the
 * main generation prompt alone was unreliable — the model is biased to "be
 * helpful" and builds a page anyway. This dedicated yes/no call is not.
 *
 * Fails OPEN (returns coherent=true) if the API key is missing or the call errors,
 * so real users are never blocked by an infrastructure hiccup.
 */
export async function checkBusinessCoherence(businessName?: string, description?: string): Promise<boolean> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return true;

  const client = new Anthropic({ apiKey });
  const payload = `Business name: ${businessName || '(empty)'}\nDescription: ${description || '(empty)'}`;

  try {
    const r = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 5,
      system:
        'You validate input for a landing-page builder. Decide whether the text below describes a REAL, ' +
        'understandable business, product, service, cause, or event that a landing page could be built for. ' +
        'If it is random characters, keyboard-mashing, meaningless repeated or unrelated letters, or has no ' +
        'discernible real-world meaning, it is INVALID. A short but real name/idea is VALID. ' +
        'Reply with exactly one word: VALID or INVALID. No other text.',
      messages: [{ role: 'user', content: payload }],
    });
    const text = r.content[0].type === 'text' ? r.content[0].text.trim().toUpperCase() : '';
    console.log('[AI] coherence check =>', text || '(empty)');
    return !text.includes('INVALID');
  } catch (e) {
    console.error('[AI] coherence check errored — allowing through:', e);
    return true;
  }
}

export async function generateAiContent(input: GenerateInput): Promise<AiContent> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.warn('[AI] ANTHROPIC_API_KEY not set — using mock content');
    return getMockContent(input);
  }

  const client = new Anthropic({ apiKey });

  try {
    // ── Build Call A message content (may include logo image for vision) ──────
    type ContentBlock =
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } };

    const supportedType = (mt?: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' => {
      const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
      return (allowed as readonly string[]).includes(mt ?? '') ? mt as 'image/jpeg' : 'image/jpeg';
    };

    // Only send the logo to vision when it's a format Claude accepts. SVG / unknown
    // types are skipped (generation continues without logo color extraction) instead
    // of being mislabeled as JPEG, which used to crash the whole generation.
    const visionAllowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const useVision = !!(
      input.auto_extract_colors &&
      input.logo_base64 &&
      input.logo_media_type &&
      visionAllowed.includes(input.logo_media_type)
    );
    const coreUserContent: ContentBlock[] | string = useVision
      ? [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: supportedType(input.logo_media_type),
              data: input.logo_base64!,
            },
          },
          { type: 'text', text: buildCoreUser(input) },
        ]
      : buildCoreUser(input);

    console.log('[AI] Parallel calls start — vision:', useVision, '| goal:', input.page_goal ?? 'lead_gen');

    // ── Fire Call A and Call B in parallel ────────────────────────────────────
    const [coreResult, trustResult] = await Promise.allSettled([
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: buildCoreSystem(input),
        messages: [{ role: 'user', content: coreUserContent as Parameters<typeof client.messages.create>[0]['messages'][0]['content'] }],
      }),
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1536,
        system: buildTrustSystem(input),
        messages: [{ role: 'user', content: buildTrustUser(input) }],
      }),
    ]);

    // ── Parse Call A — fatal: if core fails the whole generation fails ────────
    if (coreResult.status === 'rejected') {
      throw coreResult.reason;
    }
    const coreRaw = coreResult.value.content[0].type === 'text'
      ? coreResult.value.content[0].text.trim()
      : '';
    const core = parseJsonLoose<CoreOutput>(coreRaw);
    console.log('[AI] Call A (core) done — layout_composition:', core.layoutComposition, '| design_tokens:', core.designTokens, '| primary:', core.primaryColor);

    // ── Parse Call B — graceful: if trust fails, use empty sections ───────────
    let trust: TrustOutput;
    if (trustResult.status === 'rejected') {
      console.error('[AI] Call B (trust) failed — falling back to empty trust sections:', trustResult.reason);
      trust = { benefits: [], benefitsHeading: '', benefitsKicker: '', processSteps: [], processHeading: '', processKicker: '', faq: [], faqHeading: '', faqKicker: '', testimonials: [], testimonialsHeading: '', testimonialsKicker: '', trustBadges: [], ctaBannerSubline: '' };
    } else {
      try {
        const trustRaw = trustResult.value.content[0].type === 'text'
          ? trustResult.value.content[0].text.trim()
          : '';
        trust = parseJsonLoose<TrustOutput>(trustRaw);
        console.log('[AI] Call B (trust) done — benefits:', trust.benefits?.length, '| faq:', trust.faq?.length, '| steps:', trust.processSteps?.length);
      } catch (parseErr) {
        console.error('[AI] Call B response parse failed — falling back to empty trust sections:', parseErr);
        trust = { benefits: [], benefitsHeading: '', benefitsKicker: '', processSteps: [], processHeading: '', processKicker: '', faq: [], faqHeading: '', faqKicker: '', testimonials: [], testimonialsHeading: '', testimonialsKicker: '', trustBadges: [], ctaBannerSubline: '' };
      }
    }

    // ── Merge parallel results and map to AiContent ───────────────────────────
    const step1: Step1Output = { ...core, ...trust };
    const aiContent = mapToAiContent(step1, input);
    console.log('[AI] Mapping done — layout_composition:', aiContent.layout_composition);

    return aiContent;
  } catch (err) {
    console.error('[AI] Generation failed, falling back to mock:', err);
    return getMockContent(input);
  }
}

// ─── Intake interview: suggest short, niche-specific follow-up questions ──────
//
// WHY: the wizard collects very little real material (name + a one-line vibe +
// optional free text), so NO_FABRICATION_RULE correctly forces the generator into
// safe, qualitative language on every page — which is exactly what makes the copy
// feel templated. The fix is a richer intake, not a looser prompt: 3-4 tiny,
// business-specific questions whose (optional) answers become TRUE specifics the
// generator is already allowed to use.
//
// This is a deliberately cheap, low-stakes call — Haiku, tiny token budget — and
// it is entirely off the generation hot path: it runs only if the user actually
// reaches the intake step, and every failure mode (no API key, API error, bad
// JSON) degrades to a static fallback or an empty list. The wizard treats an
// empty list as "skip this step", so page creation behaves exactly as before.

export interface IntakeQuestionsInput {
  business_name: string;
  vibe?: string;
  page_goal?: string;
}

const INTAKE_QUESTIONS_MODEL = 'claude-haiku-4-5';
const MAX_INTAKE_QUESTIONS = 4;

// Used when ANTHROPIC_API_KEY is unset (local dev), mirroring getMockContent.
const MOCK_INTAKE_QUESTIONS = [
  'כמה שנים אתם פעילים?',
  'אילו אזורים אתם מכסים?',
  'מה מחיר ההתחלה או טווח המחירים?',
  'תוך כמה זמן אתם חוזרים ללקוח?',
];

function sanitizeQuestions(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((q): q is string => typeof q === 'string')
    .map((q) => q.trim())
    .filter((q) => q.length > 0 && q.length <= 80)
    .slice(0, MAX_INTAKE_QUESTIONS);
}

export async function suggestIntakeQuestions(input: IntakeQuestionsInput): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.warn('[AI:intake] ANTHROPIC_API_KEY not set — using mock intake questions');
    return MOCK_INTAKE_QUESTIONS.slice(0, 3);
  }

  const system = `You help an Israeli landing-page builder interview a small-business owner.

TASK: given a business, write 3-4 VERY SHORT Hebrew questions whose answers would be concrete, factual
selling points on that business's landing page — the kind of specifics its customers actually decide on.

RULES:
- Hebrew only. Each question max 8 words, answerable in a few words (a number, a price, a time, a place, a name).
- Ask ONLY about facts the owner can state off the top of their head. No essay questions, no "why" or "tell us about".
- Make them specific to THIS niche — not a generic questionnaire.
- Never ask for customer testimonials, ratings, awards or anything the owner would have to make up.
- Return ONLY a JSON array of strings. No markdown, no explanation.

EXAMPLES (style and specificity — never copy verbatim unless the niche truly matches):
- Emergency plumber → ["מה זמן ההגעה הממוצע לקריאה?", "אילו אזורים אתם מכסים?", "מה מחיר ביקור הבית?", "אתם זמינים גם בלילה ובשבת?"]
- Boutique bakery → ["באיזו שעה יוצא הלחם מהתנור?", "כמה זמן מראש מזמינים עוגת אירוע?", "יש אפשרויות ללא גלוטן?", "מה מחיר ההתחלה לעוגה?"]
- Family law firm → ["כמה שנים אתם עוסקים בתחום?", "הפגישה הראשונה בתשלום?", "באילו בתי משפט אתם מייצגים?", "תוך כמה זמן חוזרים לפונה?"]
- SaaS / digital product → ["מה המחיר החודשי ההתחלתי?", "כמה זמן לוקח ההטמעה?", "עם אילו מערכות יש אינטגרציה?", "יש תקופת ניסיון?"]
- Nonprofit / donations → ["כמה מתנדבים פעילים אצלכם?", "מאיזו שנה העמותה פועלת?", "מה עושה תרומה של 100 ₪?", "באילו אזורים אתם פועלים?"]`;

  const user = [
    `Business name: ${input.business_name}`,
    `Niche / description: ${input.vibe || '(not provided)'}`,
    `Page goal: ${input.page_goal || 'lead_gen'}`,
    ``,
    `Return ONLY a JSON array of 3-4 Hebrew question strings.`,
  ].join('\n');

  const client = new Anthropic({ apiKey });

  try {
    const r = await client.messages.create({
      model: INTAKE_QUESTIONS_MODEL,
      max_tokens: 300,
      system,
      messages: [{ role: 'user', content: user }],
    });
    let raw = r.content[0].type === 'text' ? r.content[0].text.trim() : '';
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
    const first = raw.indexOf('[');
    const last = raw.lastIndexOf(']');
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);

    const questions = sanitizeQuestions(JSON.parse(raw));
    console.log('[AI:intake] suggested', questions.length, 'questions for', input.business_name);
    return questions;
  } catch (err) {
    // Never block or fail the wizard over an optional nicety.
    console.error('[AI:intake] question suggestion failed — returning none:', err);
    return [];
  }
}
