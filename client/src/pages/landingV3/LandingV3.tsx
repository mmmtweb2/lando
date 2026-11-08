// Design V3 ("Pinkas"): an open, editorial page — no cards inside sheets inside stripes. One folio
// (number + title + hairline) per section, services as a price-list, a single inked band for the
// process, a closing colour block. Motion is a thin layer that switches off in edit mode and for
// visitors who ask for reduced motion. Rendered by LandingViewer when `designV3` is on.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ComponentType, ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { buildPalette } from './color';
import './landingV3.css';

// ── What LandingViewer hands over (kept structural so there is no import cycle) ──
type TextComp = ComponentType<{
  as?: string; value: string; onCommit: (t: string) => void; isEditing: boolean;
  className?: string; style?: CSSProperties;
}>;
type ImageComp = ComponentType<{
  src?: string | null; primaryColor: string; secondaryColor: string; logoUrl?: string | null;
  className?: string; style?: CSSProperties; isEditingMode: boolean; canEdit: boolean;
  onEditClick: () => void; darken?: boolean; collapseEmpty?: boolean;
}>;
type SectionWrapComp = ComponentType<{
  children: ReactNode; isEditing: boolean; isHidden: boolean; label: string; onToggleHide: () => void;
}>;

export interface V3Ctx {
  businessName: string;
  logoUrl: string | null;
  phone: string;
  email: string;
  address: string;
  hours: string;
  facebookUrl: string | null;
  instagramUrl: string | null;
  hero: { title: string; subtitle: string; cta: string };
  about: { heading: string; content: string } | null;
  aboutImage: string | null;
  services: Array<{ id?: string; title: string; description: string }>;
  serviceImages: Array<string | null>;
  galleryUrls: string[];
  heroImageUrl: string | null;
  process: Array<{ step_number?: number; title: string; description: string }>;
  testimonials: Array<{ quote: string; author: string; role: string }>;
  faq: Array<{ question: string; answer: string }>;
  badges: string[];
  headings: { services: string; process: string; testimonials: string; faq: string };
  closing: { headline: string; subline: string; waMessage: string | null };
  // palette / type
  primary: string; secondary: string; accent: string; bgTint?: string;
  headingFont: string; bodyFont: string;
  vibe: 'luxury' | 'playful' | 'warm' | 'corporate' | 'tech';
  // behaviour
  isEditing: boolean; canEdit: boolean; reduceMotion: boolean; topPad: number;
  ctaHref: string; ctaIcon: ReactNode; isWhatsApp: boolean;
  serviceHref: (title: string) => string;
  onCta: (href: string) => void;
  getEdit: (path: string, fallback: string) => string;
  setEdit: (path: string, value: string) => void;
  openImageModal: (slot: string) => void;
  removeGalleryImage: (i: number) => void;
  isHidden: (ids: string[]) => boolean;
  toggleHidden: (ids: string[]) => void;
  maxGallery: number;
  EditableText: TextComp; EditableImage: ImageComp; SectionWrap: SectionWrapComp;
  headerExtra: ReactNode;
  leadForm: ReactNode;
  waIcon: ReactNode;
}

const d = (n: number): CSSProperties => ({ ['--d' as string]: `${n.toFixed(2)}s` } as CSSProperties);

// DIALS: what makes a barber, a clinic and a caterer look different with the same skeleton.
const DIALS = {
  luxury:    { imgR: '2px',  plateR: '2px',                 pill: '2px',  leaders: false },
  corporate: { imgR: '8px',  plateR: '8px',                 pill: '8px',  leaders: false },
  tech:      { imgR: '12px', plateR: '14px',                pill: '10px', leaders: false },
  warm:      { imgR: '18px', plateR: '999px 999px 18px 18px', pill: '999px', leaders: true },
  playful:   { imgR: '28px', plateR: '40px 40px 90px 40px', pill: '999px', leaders: true },
} as const;

// ── small pieces ──────────────────────────────────────────────────────────────

function Words({ text, base = 0, hlLast = false }: { text: string; base?: number; hlLast?: boolean }) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return (
    <>
      {words.map((w, i) => {
        const node = (
          <span className="w"><span className="wi" style={d(base + i * 0.09)}>{w}</span></span>
        );
        const last = i === words.length - 1;
        return (
          <Fragment key={i}>
            {hlLast && last ? (
              <span className="hl">{node}
                <svg viewBox="0 0 240 14" preserveAspectRatio="none" aria-hidden="true"><path pathLength={1} d="M3 9C40 3 80 12 120 7s80-4 117 2" /></svg>
              </span>
            ) : node}
            {!last && ' '}
          </Fragment>
        );
      })}
    </>
  );
}

function Count({ pre, num, suf, motion }: { pre: string; num: string; suf: string; motion: boolean }) {
  const target = parseFloat(num.replace(/,/g, ''));
  const comma = num.includes(',');
  const [v, setV] = useState(motion ? 0 : target);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!motion || !ref.current || !isFinite(target)) { setV(target); return; }
    let raf = 0;
    const io = new IntersectionObserver((es) => {
      if (!es[0].isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (now: number) => {
        const k = Math.min(1, (now - t0) / 1500);
        setV(Math.round(target * (1 - Math.pow(1 - k, 3))));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      setTimeout(() => { raf = requestAnimationFrame(tick); }, 250);
    }, { threshold: 0.3 });
    io.observe(ref.current);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [motion, target]);
  return <span ref={ref} dir="ltr" style={{ display: 'inline-block' }}>{pre}{comma ? v.toLocaleString('en-US') : v}{suf}</span>;
}

function parseFact(label: string): { pre: string; num: string; suf: string; rest: string } | null {
  const m = label.match(/^(\D*?)(\d[\d,.]*)(\S*)\s*(.*)$/);
  if (!m || !m[4] || parseFloat(m[2].replace(/,/g, '')) <= 0) return null;
  return { pre: m[1].trim(), num: m[2], suf: m[3], rest: m[4] };
}

function Typing({ text, motion }: { text: string; motion: boolean }) {
  const [phase, setPhase] = useState<'idle' | 'pre' | 'pop'>(motion ? 'idle' : 'pop');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!motion || !ref.current) return;
    let t: ReturnType<typeof setTimeout>;
    const io = new IntersectionObserver((es) => {
      if (!es[0].isIntersecting) return;
      io.disconnect();
      setPhase('pre');
      t = setTimeout(() => setPhase('pop'), 1100);
    }, { threshold: 0.4 });
    io.observe(ref.current);
    return () => { io.disconnect(); clearTimeout(t); };
  }, [motion]);
  return (
    <div ref={ref} className={`msg ${phase === 'pre' ? 'pre' : ''} ${phase === 'pop' ? 'pop' : ''}`} style={phase === 'idle' ? { opacity: 0 } : undefined}>
      <small>ההודעה שתישלח בוואטסאפ</small>
      <span className="dots"><b /><b /><b /></span>
      <p>{text}</p>
    </div>
  );
}

function FaqItem({ q, a, open, edit, motion }: { q: ReactNode; a: ReactNode; open: boolean; edit: boolean; motion: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pRef = useRef<HTMLDivElement>(null);
  function toggle(e: React.MouseEvent) {
    if (edit) return;
    e.preventDefault();
    const det = ref.current, p = pRef.current;
    if (!det || !p) return;
    if (!motion || !p.animate) { det.open = !det.open; return; }
    if (!det.open) {
      det.open = true;
      p.animate([{ height: '0px', opacity: 0 }, { height: `${p.offsetHeight}px`, opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.2,.7,.2,1)' });
    } else {
      p.animate([{ height: `${p.offsetHeight}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 280, easing: 'ease' })
        .onfinish = () => { det.open = false; };
    }
  }
  return (
    <details ref={ref} open={open || edit} data-rv="" >
      <summary onClick={toggle}>{q}<i /></summary>
      <div ref={pRef} className="ans">{a}</div>
    </details>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function LandingV3({ ctx }: { ctx: V3Ctx }) {
  const c = ctx;
  const { EditableText: ET, EditableImage: EI, SectionWrap: SW } = c;
  const motion = !c.reduceMotion && !c.isEditing;
  const rootRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const dial = DIALS[c.vibe] ?? DIALS.corporate;
  const pal = useMemo(() => buildPalette(c.primary, c.accent, c.bgTint), [c.primary, c.accent, c.bgTint]);

  const rootStyle = {
    '--paper': pal.paper, '--ink': pal.ink, '--primary': pal.primary, '--primary-ink': pal.primaryInk,
    '--accent': pal.accent, '--accent-ink': pal.accentInk, '--on-accent': pal.onAccent, '--hi': pal.hi,
    '--rule': pal.rule, '--muted': pal.muted, '--band-accent': pal.bandAccent,
    '--head': c.headingFont, '--body': c.bodyFont,
    '--img-r': dial.imgR, '--plate-r': dial.plateR, '--pill': dial.pill, '--img-f': 'none',
    '--toppad': `${c.topPad}px`, '--cut': '34px',
  } as CSSProperties;

  // reveal-on-scroll (adds `in` to [data-rv]/[data-io] elements once visible)
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!motion) { root.querySelectorAll('[data-rv],[data-io]').forEach((el) => el.classList.add('in')); return; }
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
    root.querySelectorAll('[data-rv]:not(.in),[data-io]:not(.in)').forEach((el) => io.observe(el));
    return () => io.disconnect();
  });

  useEffect(() => {
    if (!motion) { setReady(true); return; }
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    return () => cancelAnimationFrame(r);
  }, [motion]);

  // scroll progress line + slow drift of the hero photo (CSS variables, no re-render)
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !motion) return;
    let tick = false;
    const on = () => {
      if (tick) return;
      tick = true;
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - innerHeight;
        root.style.setProperty('--p', String(max > 0 ? Math.min(1, scrollY / max) : 0));
        if (scrollY < 900) root.style.setProperty('--py', `${(scrollY * 0.08).toFixed(1)}px`);
        tick = false;
      });
    };
    addEventListener('scroll', on, { passive: true });
    on();
    return () => removeEventListener('scroll', on);
  }, [motion]);

  // ── data shaping ──
  const placeholder = (q: string) => q.includes('הכנס כאן') || q.includes('ציטוט אמיתי');
  const testimonials = c.canEdit ? c.testimonials : c.testimonials.filter((t) => !placeholder(t.quote));
  const facts = c.badges.map(parseFact).filter((f): f is NonNullable<ReturnType<typeof parseFact>> => !!f).slice(0, 3);
  const stickerLabel = c.badges.find((b) => !parseFact(b) && b.length <= 18) ?? null;
  const filledGallery = c.galleryUrls.map((src, i) => ({ src, i })).filter((x) => !!x.src);
  const nextFree = (() => { for (let i = 0; i < c.maxGallery; i++) if (!c.galleryUrls[i]) return i; return -1; })();
  const hasPlate = !!c.heroImageUrl || c.isEditing;
  const cta = (href: string) => ({ href, target: '_blank' as const, rel: 'noopener noreferrer', onClick: () => c.onCta(href) });

  // section numbering (only visible sections count)
  let no = 0;
  const nextNo = () => String(++no).padStart(2, '0');
  const folio = (n: string, title: ReactNode) => (
    <header className="folio" data-io=""><span className="no">{n}</span><h2>{title}</h2><i className="rule" /></header>
  );

  // about: first sentence is the statement, the rest is body copy (edit mode edits the whole text)
  const aboutText = c.about ? c.getEdit('about.content', c.about.content) : '';
  const cut = aboutText.search(/[.!?](\s|$)/);
  const statement = !c.isEditing && cut > 8 && cut < aboutText.length - 1 ? aboutText.slice(0, cut + 1) : '';
  const aboutRest = statement ? aboutText.slice(statement.length).trim() : aboutText;
  const stWords = statement.replace(/[.!?]$/, '').split(' ');
  const stLast = stWords.pop() ?? '';

  const sec = (ids: string[], label: string, node: ReactNode) => (
    <SW isEditing={c.isEditing} isHidden={c.isHidden(ids)} label={label} onToggleHide={() => c.toggleHidden(ids)}>{node}</SW>
  );

  const heroTitle = c.getEdit('hero.title', c.hero.title);
  const subtitle = c.getEdit('hero.subtitle', c.hero.subtitle);
  const ctaText = c.getEdit('hero.primary_cta_text', c.hero.cta);

  return (
    <div ref={rootRef} className={`lp3 ${motion ? 'm' : ''}`} dir="rtl" style={rootStyle}>
      {/* header: one thin line */}
      <header className="top">
        <div className="wrap">
          <div className="brand">
            {c.logoUrl && <img src={c.logoUrl} alt={c.businessName} />}
            <b>{c.businessName}</b>
          </div>
          {c.headerExtra}
          <a className="btn sm" {...cta(c.ctaHref)}>{ctaText}</a>
        </div>
        {motion && <i className="prog" />}
      </header>

      <main>
        {/* hero: a typographic poster; with a photo, one shaped plate */}
        <section className={`hero wrap ${hasPlate ? 'has-img' : ''} ${ready ? 'go' : ''}`}>
          <div className="copy">
            {c.isEditing ? (
              <ET as="h1" value={heroTitle} onCommit={(v) => c.setEdit('hero.title', v)} isEditing />
            ) : (
              <h1><Words text={heroTitle} base={0.1} hlLast /></h1>
            )}
            <div className="sub">
              {(subtitle || c.isEditing) && (c.isEditing
                ? <ET as="p" className="lead" value={subtitle} onCommit={(v) => c.setEdit('hero.subtitle', v)} isEditing />
                : <p className="lead">{subtitle}</p>)}
              <div className="cta-row">
                <a className="btn" {...cta(c.ctaHref)}>{c.ctaIcon}{ctaText}</a>
                {c.phone && <a className="tel" href={`tel:${c.phone}`} onClick={() => c.onCta(`tel:${c.phone}`)} dir="ltr">{c.phone}</a>}
              </div>
            </div>
          </div>
          {hasPlate && (
            <div className="side">
              {stickerLabel && <div className="sticker"><small>{stickerLabel}</small></div>}
              <EI src={c.heroImageUrl} primaryColor={c.primary} secondaryColor={c.secondary} logoUrl={c.logoUrl}
                className="plate" isEditingMode={c.isEditing} canEdit={c.canEdit} onEditClick={() => c.openImageModal('hero')} />
            </div>
          )}
          {!hasPlate && stickerLabel && <div className="sticker"><small>{stickerLabel}</small></div>}
          {facts.length > 0 && (
            <dl className="facts" data-io="">
              {facts.map((f, i) => (
                <div key={i} style={d(i * 0.12)}><dt><Count pre={f.pre} num={f.num} suf={f.suf} motion={motion} /></dt><dd>{f.rest}</dd></div>
              ))}
            </dl>
          )}
        </section>

        {/* tape of the business's own services */}
        {c.services.length > 1 && (
          <div className="marqw" aria-hidden="true">
            <div className="marq"><div className="track">
              {[0, 1, 2, 3].map((k) => (
                <Fragment key={k}>{c.services.map((s, i) => <span key={`${k}-${i}`}>{s.title}<i>✦</i></span>)}</Fragment>
              ))}
            </div></div>
          </div>
        )}

        {/* about: a big statement + body copy */}
        {c.about && (c.about.content || c.isEditing) && sec(['about'], 'קצת עלינו', (
          <section className="wrap about"><div className="sec" style={{ '--pad': '56px' } as CSSProperties}>
            {folio(nextNo(), c.getEdit('about.heading', c.about.heading || 'הסיפור שלנו'))}
            <div>
              {statement && (
                <p className="statement" data-io="">{stWords.join(' ')} <em>{stLast}</em>.</p>
              )}
              {c.isEditing ? (
                <ET as="p" className="rest" value={aboutText} onCommit={(v) => c.setEdit('about.content', v)} isEditing />
              ) : (
                aboutRest && <div className="cols" data-rv=""><p className="rest">{aboutRest}</p></div>
              )}
              {c.aboutImage && <figure className="about-fig" data-rv=""><img src={c.aboutImage} alt={c.businessName} loading="lazy" /></figure>}
            </div>
          </div></section>
        ))}

        {/* services: a price-list, not cards */}
        {c.services.length > 0 && sec(['services_bento', 'services_grid'], 'שירותים', (
          <section className={`wrap ${dial.leaders ? 'leaders' : ''}`}><div className="sec">
            {folio(nextNo(), c.headings.services)}
            <ol className="rows">
              {c.services.map((s, i) => {
                const title = c.getEdit(`services.${i}.title`, s.title);
                const desc = c.getEdit(`services.${i}.description`, s.description);
                const img = c.serviceImages[i];
                const inner = (
                  <>
                    <span className="n">{String(i + 1).padStart(2, '0')}</span>
                    <div className="body">
                      {c.isEditing
                        ? <ET as="h3" value={title} onCommit={(v) => c.setEdit(`services.${i}.title`, v)} isEditing />
                        : <h3>{title}</h3>}
                      {c.isEditing
                        ? <ET as="p" value={desc} onCommit={(v) => c.setEdit(`services.${i}.description`, v)} isEditing />
                        : <p>{desc}</p>}
                      {!c.isEditing && <span className="go">{c.isWhatsApp ? 'שאלו על זה בוואטסאפ' : c.hero.cta}</span>}
                      {(img || c.isEditing) && (
                        <div className={img ? 'thumb-box' : 'thumb-edit'}>
                          <EI collapseEmpty src={img} primaryColor={c.primary} secondaryColor={c.secondary} logoUrl={c.logoUrl}
                            className="thumb" isEditingMode={c.isEditing} canEdit={c.canEdit} onEditClick={() => c.openImageModal(`service_${i}`)} />
                        </div>
                      )}
                    </div>
                  </>
                );
                const href = c.serviceHref(title);
                return (
                  <li key={s.id ?? i} data-rv="" style={d(i * 0.09)}>
                    {c.isEditing
                      ? <div className="row">{inner}</div>
                      : <a className="row" href={href} target="_blank" rel="noopener noreferrer" onClick={() => c.onCta(href)}>{inner}</a>}
                  </li>
                );
              })}
            </ol>
          </div></section>
        ))}

        {/* gallery: the owner's extra photos, natural proportions, no frames */}
        {(filledGallery.length > 0 || c.canEdit && c.isEditing) && sec(['gallery'], 'גלריה', (
          <section className="wrap"><div className="sec" style={{ '--padD': '72px', '--pad': '44px' } as CSSProperties}>
            {folio(nextNo(), c.isEditing
              ? <ET as="span" value={c.getEdit('gallery.heading', 'גלריה')} onCommit={(v) => c.setEdit('gallery.heading', v)} isEditing />
              : c.getEdit('gallery.heading', 'גלריה'))}
            {c.isEditing ? (
              <div className="gal-grid">
                {filledGallery.map((x) => (
                  <div className="tile" key={x.i}>
                    <EI src={x.src} primaryColor={c.primary} secondaryColor={c.secondary} logoUrl={c.logoUrl}
                      isEditingMode canEdit={c.canEdit} onEditClick={() => c.openImageModal(`gallery_${x.i}`)} />
                    <button type="button" className="rm" aria-label="הסר תמונה" onClick={() => c.removeGalleryImage(x.i)}><X size={16} /></button>
                  </div>
                ))}
                {nextFree >= 0 && (
                  <button type="button" className="tile-add" onClick={() => c.openImageModal(`gallery_${nextFree}`)}>
                    <Plus size={22} /> הוסף תמונה לגלריה
                  </button>
                )}
              </div>
            ) : (
              <div className="strip" data-io="">
                {filledGallery.map((x, i) => <img key={x.i} src={x.src} alt="" loading="lazy" style={d(i * 0.12)} />)}
              </div>
            )}
          </div></section>
        ))}

        {/* process: the one inked band */}
        {c.process.length > 0 && sec(['process_timeline', 'process_horizontal'], 'תהליך', (
          <section className="band slant"><div className="wrap"><div className="sec nobor" style={{ '--pad': '40px' } as CSSProperties}>
            {folio(nextNo(), c.headings.process)}
            <ol className="steps">
              {c.process.map((s, i) => (
                <li key={i} data-io="" style={d(i * 0.14)}>
                  <span className="big">{s.step_number ?? i + 1}</span>
                  <div>
                    {c.isEditing
                      ? <ET as="h3" value={c.getEdit(`process_steps.${i}.title`, s.title)} onCommit={(v) => c.setEdit(`process_steps.${i}.title`, v)} isEditing />
                      : <h3>{s.title}</h3>}
                    {c.isEditing
                      ? <ET as="p" value={c.getEdit(`process_steps.${i}.description`, s.description)} onCommit={(v) => c.setEdit(`process_steps.${i}.description`, v)} isEditing />
                      : <p>{s.description}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div></div></section>
        ))}

        {/* testimonials: one big quote, the rest as quiet rows */}
        {testimonials.length > 0 && sec(['testimonials_grid'], 'המלצות', (
          <section className="wrap"><div className="sec" style={{ '--pad': '64px' } as CSSProperties}>
            {folio(nextNo(), c.headings.testimonials)}
            <div className="qwrap">
              {testimonials.slice(0, 1).map((t, i) => (
                <figure className="qbig" key={i} data-io="">
                  <div className="qm" aria-hidden="true">”</div>
                  <blockquote>
                    {c.isEditing
                      ? <ET as="span" value={c.getEdit(`testimonials.${i}.quote`, t.quote)} onCommit={(v) => c.setEdit(`testimonials.${i}.quote`, v)} isEditing />
                      : t.quote}
                  </blockquote>
                  <figcaption>
                    {c.isEditing
                      ? <ET as="span" value={c.getEdit(`testimonials.${i}.author`, t.author)} onCommit={(v) => c.setEdit(`testimonials.${i}.author`, v)} isEditing />
                      : <b>{t.author}</b>}
                    {t.role ? <> · {c.isEditing
                      ? <ET as="span" value={c.getEdit(`testimonials.${i}.role`, t.role)} onCommit={(v) => c.setEdit(`testimonials.${i}.role`, v)} isEditing />
                      : t.role}</> : null}
                  </figcaption>
                </figure>
              ))}
              {testimonials.length > 1 && (
                <div className="qsmall">
                  {testimonials.slice(1).map((t, k) => {
                    const i = k + 1;
                    return (
                      <figure key={i} data-rv="" style={d(k * 0.09)}>
                        <blockquote>
                          {c.isEditing
                            ? <ET as="span" value={c.getEdit(`testimonials.${i}.quote`, t.quote)} onCommit={(v) => c.setEdit(`testimonials.${i}.quote`, v)} isEditing />
                            : t.quote}
                        </blockquote>
                        <figcaption>
                          {c.isEditing
                            ? <ET as="span" value={c.getEdit(`testimonials.${i}.author`, t.author)} onCommit={(v) => c.setEdit(`testimonials.${i}.author`, v)} isEditing />
                            : <b>{t.author}</b>}
                          {t.role ? <> · {t.role}</> : null}
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              )}
            </div>
          </div></section>
        ))}

        {/* faq: hairlines only */}
        {c.faq.length > 0 && sec(['faq_accordion'], 'שאלות נפוצות', (
          <section className="wrap faq"><div className="sec" style={{ '--pad': '56px' } as CSSProperties}>
            {folio(nextNo(), c.headings.faq)}
            <div>
              {c.faq.map((f, i) => (
                <FaqItem key={i} open={false} edit={c.isEditing} motion={motion}
                  q={c.isEditing
                    ? <ET as="span" value={c.getEdit(`faq.${i}.question`, f.question)} onCommit={(v) => c.setEdit(`faq.${i}.question`, v)} isEditing />
                    : f.question}
                  a={c.isEditing
                    ? <ET as="p" value={c.getEdit(`faq.${i}.answer`, f.answer)} onCommit={(v) => c.setEdit(`faq.${i}.answer`, v)} isEditing />
                    : <p>{f.answer}</p>} />
              ))}
            </div>
          </div></section>
        ))}

        {/* visit: big address + two links, no map iframe */}
        {(c.address || c.hours) && (
          <section className="wrap visit"><div className="sec" style={{ '--pad': '56px' } as CSSProperties}>
            {folio(nextNo(), 'בואו לבקר')}
            <div className="cols">
              <div>
                {c.address && <p className="addr" data-rv="">{c.address}</p>}
                {c.hours && <p className="hours" data-rv="" style={{ whiteSpace: 'pre-line' }}>{c.hours}</p>}
              </div>
              {c.address && (
                <div className="links">
                  <a data-rv="" href={`https://waze.com/ul?q=${encodeURIComponent(c.address)}&navigate=yes`} target="_blank" rel="noopener noreferrer">ניווט ב-Waze</a>
                  <a data-rv="" style={d(0.09)} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`} target="_blank" rel="noopener noreferrer">Google Maps</a>
                </div>
              )}
            </div>
          </div></section>
        )}

        {c.leadForm && <div className="wrap lead-wrap">{c.leadForm}</div>}

        {/* closing: one colour block */}
        <section className="close"><div className="wrap inner">
          <div>
            <h2 data-io="">{motion ? <Words text={c.closing.headline} /> : c.closing.headline}</h2>
            {c.closing.subline && <p style={{ marginTop: 14, maxWidth: 420 }}>{c.closing.subline}</p>}
          </div>
          <div>
            {c.closing.waMessage && <Typing text={c.closing.waMessage} motion={motion} />}
            <a className="btn on-accent" {...cta(c.ctaHref)}>{c.ctaIcon}{ctaText}</a>
          </div>
        </div></section>
      </main>

      <footer className="foot"><div className="wrap">
        <span><b>{c.businessName}</b>{c.phone ? <> · <span dir="ltr">{c.phone}</span></> : null}{c.email ? <> · <a href={`cta:${c.email}`} dir="ltr">{c.email}</a></> : null}</span>
        <span className="soc">
          {c.facebookUrl && <a href={c.facebookUrl} target="_blank" rel="noopener noreferrer">Facebook</a>}
          {c.instagramUrl && <a href={c.instagramUrl} target="_blank" rel="noopener noreferrer">Instagram</a>}
        </span>
      </div></footer>
    </div>
  );
}
