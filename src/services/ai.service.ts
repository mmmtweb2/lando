import Anthropic from '@anthropic-ai/sdk';

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
  contact?: {
    phone?: string;
    email?: string;
    address?: string;
    cta_text?: string;         // v1 compat
    whatsapp_message?: string;
    cta_type?: string;         // user-chosen CTA target: whatsapp|email|phone|link
  };
  design_system?: DesignSystem;
  design_hints?: DesignHints;  // v1 compat
  // v2 long-form sections
  benefits?: Array<{ title: string; description: string }>;
  faq?: Array<{ question: string; answer: string }>;
  process_steps?: Array<{ step_number: number; title: string; description: string }>;
  testimonials?: Array<{ quote: string; author: string; role: string }>;
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
  whatsappMessage: string;
  imageKeywords: string[];
  imageStyle: 'photo' | 'icon';
}

interface TrustOutput {
  benefits: Array<{ title: string; description: string }>;
  processSteps: Array<{ stepNumber: number; title: string; description: string }>;
  faq: Array<{ question: string; answer: string }>;
  testimonials: Array<{ quote: string; author: string; role: string }>;
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
    contact: {
      phone: input.phone_number,
      email: input.email ?? '',
      address: input.address ?? '',
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
    faq: [
      { question: 'כיצד ניצור קשר לתיאום?', answer: 'בוואטסאפ, טלפון, או טופס הפנייה — נחזור תוך 24 שעות.' },
      { question: 'כמה זמן לוקח התהליך?', answer: 'בונים לוח זמנים מותאם אישית כבר בשיחה הראשונה.' },
      { question: 'האם יש אחריות?', answer: 'כן. עומדים מאחורי כל עבודה עד לשביעות רצונכם המלאה.' },
    ],
    process_steps: [
      { step_number: 1, title: 'יצירת קשר', description: 'פנו אלינו ונקבע שיחת היכרות.' },
      { step_number: 2, title: 'התאמה אישית', description: 'נבנה פתרון מדויק לצרכים שלכם.' },
      { step_number: 3, title: 'תוצאה מיידית', description: 'מקבלים שירות מקצועי ותוצאה אמיתית.' },
    ],
    testimonials: [
      { quote: 'הכנס כאן ציטוט אמיתי של לקוח שמספר על החוויה שלו', author: 'שם הלקוח', role: 'תפקיד או עיר' },
      { quote: 'הכנס כאן ציטוט אמיתי של לקוח שמספר על החוויה שלו', author: 'שם הלקוח', role: 'תפקיד או עיר' },
    ],
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

LANGUAGE RULES (CRITICAL):
- ALL consumer-visible text MUST be in natural, fluent Hebrew
- Image prompts and imageKeywords MUST be in English
- Return ONLY a valid JSON object — no markdown fences, no explanation

WORD DIET (STRICT — no exceptions):
- heroTitle: maximum 7 Hebrew words
- heroSubtitle: maximum 15 Hebrew words — one sharp, benefit-driven sentence
- ctaText: exactly 3 to 4 Hebrew words
- Each service description: maximum 20 Hebrew words — specific benefit, no fluff
- aboutContent: 2-3 Hebrew sentences, drawn from user-provided text when available
- Do NOT use vague superlatives like "מוביל", "הטוב ביותר", "מקצועי" without a concrete reason
- Each service description: Hebrew — max 20 words. Format as Action + Benefit. Example: "במקום X, קבלו Y". No passive voice.
- seoTitle: max 60 characters — business name + primary keyword, written for search engines
- seoDescription: max 150 characters — one compelling sentence, main benefit, written for meta description

ANTI-CLICHÉ RULE (CRITICAL — violations will be rejected):
Banned words — NEVER use any of these in any Hebrew text field:
"חדשני", "מקצועיות ללא פשרות", "יחס אישי", "מוביל בתחומו", "שירות אדיב", "פתרונות מתקדמים", "ניסיון רב שנים"
If a banned word appears in your output, replace it with something concrete and specific.

NO FABRICATION (CRITICAL): NEVER invent factual or quantitative claims that were not provided in the input — no specific customer counts, years of experience, ratings, awards, certifications, guarantees, or business-model claims (e.g. "free first consultation", "money-back"). If a fact was not given, use only qualitative, non-numeric language.

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

LAYOUT COMPOSITION RULES:
Available block IDs (use ONLY these exact strings):
hero_center, hero_split, services_bento, services_grid, benefits_list, benefits_cards,
process_timeline, process_horizontal, testimonials_grid, faq_accordion, cta_banner,
comparison_table, portfolio_grid

Strict rules:
1. Start with exactly ONE hero: hero_center OR hero_split (never both)
2. Always end with cta_banner
3. Choose 3-5 content blocks between hero and cta_banner (total array: 5-7 items)
4. Never repeat any block ID
5. Only include testimonials_grid if include_testimonials is TRUE

Art direction:
- Visual / beauty / retail / construction → hero_center, portfolio_grid, services_grid, benefits_list, faq_accordion, cta_banner
- Consulting / law / medical / coaching / direct_sale → hero_split, comparison_table, process_timeline, benefits_cards, testimonials_grid (if allowed), faq_accordion, cta_banner
- Tech / startup / agency / SaaS → hero_split, comparison_table, services_bento, benefits_cards, faq_accordion, cta_banner
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

CRITICAL: Copy phone, email, and address EXACTLY as provided. Base copy heavily on any user-provided marketing text.`;
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

function buildTrustSystem(input: GenerateInput): string {
  return `You are an elite Hebrew conversion copywriter for Israeli small businesses.

MISSION: Generate TRUST and CONVERSION sections for a landing page — benefits, process, FAQ, testimonials, and a closing CTA line.

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

ANTI-CLICHÉ RULE (CRITICAL):
Banned words — NEVER use any of these in any Hebrew text:
"חדשני", "מקצועיות ללא פשרות", "יחס אישי", "מוביל בתחומו", "שירות אדיב", "פתרונות מתקדמים", "ניסיון רב שנים"

NO FABRICATION (CRITICAL): NEVER invent factual or quantitative claims not provided in the input — no customer counts, years of experience, ratings, awards, certifications, or guarantees. If a fact was not given, use qualitative, non-numeric language only.

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
- If FALSE: "testimonials" MUST be an empty array []. Do NOT generate any quotes, names, or roles.
- If TRUE: both "quote" fields MUST be EXACTLY "הכנס כאן ציטוט אמיתי של לקוח שמספר על החוויה שלו" — verbatim, unaltered. "author" MUST be EXACTLY "שם הלקוח", "role" MUST be EXACTLY "תפקיד או עיר". DO NOT invent real-sounding quotes, names, or roles.

Return EXACTLY this JSON (ALL fields required):
{
  "benefits": [
    { "title": "Hebrew 2-4 words", "description": "Hebrew max 15 words" },
    { "title": "...", "description": "..." },
    { "title": "...", "description": "..." }
  ],
  "processSteps": [
    { "stepNumber": 1, "title": "Hebrew 2-3 words", "description": "Hebrew max 15 words" },
    { "stepNumber": 2, "title": "...", "description": "..." },
    { "stepNumber": 3, "title": "...", "description": "..." }
  ],
  "faq": [
    { "question": "Hebrew question specific to this business", "answer": "Hebrew max 25 words" },
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." }
  ],
  "testimonials": ${input.include_testimonials
    ? `[
    { "quote": "הכנס כאן ציטוט אמיתי של לקוח שמספר על החוויה שלו", "author": "שם הלקוח", "role": "תפקיד או עיר" },
    { "quote": "הכנס כאן ציטוט אמיתי של לקוח שמספר על החוויה שלו", "author": "שם הלקוח", "role": "תפקיד או עיר" }
  ]`
    : '[]'},
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
    faq: s.faq,
    process_steps: s.processSteps.map((step) => ({
      step_number: step.stepNumber,
      title: step.title,
      description: step.description,
    })),
    testimonials: input.include_testimonials ? s.testimonials : [],
    seo_title: s.seoTitle || undefined,
    seo_description: s.seoDescription || undefined,
    trust_badges: s.trustBadges?.length ? s.trustBadges : undefined,
    cta_banner_subline: s.ctaBannerSubline || undefined,
    layout_composition: (s.layoutComposition ?? []).filter(
      (b) => b !== 'testimonials_grid' || input.include_testimonials,
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
      trust = { benefits: [], processSteps: [], faq: [], testimonials: [], trustBadges: [], ctaBannerSubline: '' };
    } else {
      try {
        const trustRaw = trustResult.value.content[0].type === 'text'
          ? trustResult.value.content[0].text.trim()
          : '';
        trust = parseJsonLoose<TrustOutput>(trustRaw);
        console.log('[AI] Call B (trust) done — benefits:', trust.benefits?.length, '| faq:', trust.faq?.length, '| steps:', trust.processSteps?.length);
      } catch (parseErr) {
        console.error('[AI] Call B response parse failed — falling back to empty trust sections:', parseErr);
        trust = { benefits: [], processSteps: [], faq: [], testimonials: [], trustBadges: [], ctaBannerSubline: '' };
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
