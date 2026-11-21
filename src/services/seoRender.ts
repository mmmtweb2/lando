// ─────────────────────────────────────────────────────────────────────────────
// seoRender.ts — server-side SEO output for published pages (SEO sprint 1, stage 3)
//
//   • renderSeoBody: a light semantic HTML body (h1 / h2 / h3 / p / address)
//     injected into <div id="root"> so crawlers see the real content without
//     running JS. The client uses createRoot, which REPLACES this markup.
//   • buildJsonLdScripts: LocalBusiness (+ FAQPage) structured data. Server-only;
//     the client no longer emits JSON-LD (it would duplicate).
//
// Both are built ONLY from real stored data — nothing is invented, and every
// value is HTML-escaped (business content is user/AI-authored: XSS).
// ─────────────────────────────────────────────────────────────────────────────

import { parseHttpUrl } from '../utils/safeUrl';

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Item { title?: string; description?: string }
interface Faq { question?: string; answer?: string }
interface Content {
  hero?: { title?: string; subtitle?: string; slogan?: string };
  about?: { heading?: string; content?: string };
  services_or_benefits?: Item[];
  services?: Item[];
  benefits?: Item[];
  faq?: Faq[];
  contact?: { phone?: string; email?: string; address?: string; business_hours?: string };
  services_heading?: string;
  benefits_heading?: string;
  faq_heading?: string;
  seo_title?: string;
  seo_description?: string;
  hidden_sections?: string[];
}

export interface SeoPage {
  business_name: string;
  ai_content: unknown;
  address?: string | null;
  phone_number?: string | null;
  logo_url?: string | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function isHidden(c: Content, prefix: string): boolean {
  return (c.hidden_sections ?? []).some((id) => typeof id === 'string' && id.startsWith(prefix));
}

function items(list: Item[] | undefined): Item[] {
  return (list ?? []).filter((i) => text(i?.title) || text(i?.description));
}

function faqItems(c: Content): { question: string; answer: string }[] {
  if (isHidden(c, 'faq')) return [];
  return (c.faq ?? [])
    .map((f) => ({ question: text(f?.question), answer: text(f?.answer) }))
    .filter((f) => f.question && f.answer);
}

function itemsHtml(list: Item[]): string {
  return list
    .map((i) => `<article>${text(i.title) ? `<h3>${esc(i.title)}</h3>` : ''}${text(i.description) ? `<p>${esc(i.description)}</p>` : ''}</article>`)
    .join('');
}

/** Fallback section headings of the server-rendered body, per page language (README part 142). */
const SEO_HEADINGS: Record<string, { about: string; services: string; benefits: string; faq: string }> = {
  he: { about: 'קצת עלינו', services: 'השירותים שלנו', benefits: 'למה לבחור בנו', faq: 'שאלות נפוצות' },
  fr: { about: 'À propos', services: 'Nos services', benefits: 'Pourquoi nous choisir', faq: 'Questions fréquentes' },
  en: { about: 'About us', services: 'Our services', benefits: 'Why choose us', faq: 'Frequently asked questions' },
};

export interface SeoLangOptions { lang?: string; dir?: 'rtl' | 'ltr' }

export function renderSeoBody(page: SeoPage, opts: SeoLangOptions = {}): string {
  const c = (page.ai_content ?? {}) as Content;
  const lang = opts.lang ?? 'he';
  const H = SEO_HEADINGS[lang] ?? SEO_HEADINGS.he;
  const h1 = text(c.hero?.title) || page.business_name;
  const sub = text(c.hero?.subtitle) || text(c.hero?.slogan);
  const out: string[] = [];

  out.push(`<header><h1>${esc(h1)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</header>`);

  if (text(c.about?.content) && !isHidden(c, 'about')) {
    out.push(`<section><h2>${esc(text(c.about?.heading) || H.about)}</h2><p>${esc(c.about?.content)}</p></section>`);
  }

  const services = items(c.services_or_benefits ?? c.services);
  if (services.length && !isHidden(c, 'services')) {
    out.push(`<section><h2>${esc(text(c.services_heading) || H.services)}</h2>${itemsHtml(services)}</section>`);
  }

  const benefits = items(c.benefits);
  if (benefits.length && !isHidden(c, 'benefits')) {
    out.push(`<section><h2>${esc(text(c.benefits_heading) || H.benefits)}</h2>${itemsHtml(benefits)}</section>`);
  }

  const faq = faqItems(c);
  if (faq.length) {
    out.push(
      `<section><h2>${esc(text(c.faq_heading) || H.faq)}</h2>${faq
        .map((f) => `<article><h3>${esc(f.question)}</h3><p>${esc(f.answer)}</p></article>`)
        .join('')}</section>`,
    );
  }

  const address = text(c.contact?.address) || text(page.address);
  const phone = text(c.contact?.phone) || text(page.phone_number);
  const hours = text(c.contact?.business_hours);
  if (address || phone || hours) {
    out.push(
      `<address>${esc(page.business_name)}${address ? `<br>${esc(address)}` : ''}${phone ? `<br>${esc(phone)}` : ''}${hours ? `<br>${esc(hours)}` : ''}</address>`,
    );
  }

  return `<main dir="${opts.dir ?? 'rtl'}" lang="${esc(lang)}" data-ssr="1">${out.join('')}</main>`;
}

/** Put the SEO body inside <div id="root">. No-op if the shell has no empty root. */
export function injectSeoBody(shell: string, body: string): string {
  return shell.replace(/<div id="root">\s*<\/div>/, () => `<div id="root">${body}</div>`);
}

function scriptTag(data: Record<string, unknown>): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

export function buildJsonLdScripts(page: SeoPage, canonical: string, image: string, opts: { inLanguage?: string; multilingual?: boolean } = {}): string {
  const c = (page.ai_content ?? {}) as Content;
  const tags: string[] = [];

  const business: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: page.business_name,
    url: canonical,
  };
  const description = text(c.seo_description);
  if (description) business.description = description;
  const phone = text(c.contact?.phone) || text(page.phone_number);
  if (phone) business.telephone = phone;
  const email = text(c.contact?.email);
  if (email) business.email = email;
  const address = text(c.contact?.address) || text(page.address);
  if (address) business.address = { '@type': 'PostalAddress', streetAddress: address, addressCountry: 'IL' };
  if (image) business.image = image;
  if (page.logo_url) business.logo = page.logo_url;
  // Re-validated at render time: rows written before server-side URL validation may hold anything.
  const sameAs = [page.facebook_url, page.instagram_url].map((u) => parseHttpUrl(u)).filter((u): u is string => !!u);
  if (sameAs.length) business.sameAs = sameAs;
  tags.push(scriptTag(business));
  // A page with more than one language says which one this address is in (README part 142).
  if (opts.multilingual) {
    tags.push(scriptTag({
      '@context': 'https://schema.org', '@type': 'WebPage', url: canonical, name: text(c.seo_title) || page.business_name,
      inLanguage: opts.inLanguage ?? 'he', ...(description ? { description } : {}),
    }));
  }

  const faq = faqItems(c);
  if (faq.length) {
    tags.push(
      scriptTag({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        inLanguage: opts.inLanguage ?? 'he',
        mainEntity: faq.map((f) => ({
          '@type': 'Question',
          name: f.question,
          acceptedAnswer: { '@type': 'Answer', text: f.answer },
        })),
      }),
    );
  }
  return tags.join('');
}
