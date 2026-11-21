// The sections only the HEALTH template has (README part 141): the doctor and team, the practical
// guide (hours, address, parking, accessibility and the languages line) and the before/after gallery
// (switched off until the owner turns it on). The sections every template shares (treatments, reviews,
// first visit, FAQ) are LandingV3's own, drawn in the order the category asks for.
//
// Everything shown comes from what the owner provided; an empty field is simply not drawn for a
// visitor. In edit mode an empty field shows a grey hint the owner can type over.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import type { V3Ctx } from './LandingV3';
import { FIELD_HINTS, MAX_TEAM, languagesLine, parseLanguages } from '../../config/pageCategory';
import './landingV3.category.css';

/** What LandingV3 hands over so these sections look and count like the rest of the page. */
export interface Kit {
  c: V3Ctx;
  nextNo: () => string;
  folio: (n: string, title: ReactNode) => ReactNode;
  sec: (ids: string[], label: string, node: ReactNode) => ReactNode;
  d: (n: number) => CSSProperties;
}

const isFilled = (s: string | undefined | null) => !!s && s.trim().length > 0;

/** One editable line: a hint stands in for an empty value, and typing the hint back changes nothing. */
function Field({ c, path, value, hint, as = 'p', className }: { c: V3Ctx; path: string; value: string; hint: string; as?: string; className?: string }) {
  const ET = c.EditableText;
  const shown = c.getEdit(path, value);
  const empty = !isFilled(shown);
  return (
    <ET as={as} className={`${className ?? ''}${empty ? ' ph' : ''}`} value={empty ? hint : shown} isEditing
      onCommit={(v) => { const next = v === hint ? '' : v; if (next !== shown) c.setEdit(path, next); }} />
  );
}

// ── doctor and team ───────────────────────────────────────────────────────────

/** Does the team section have anything to show? (the owner always sees it, to fill it in) */
export function teamHasContent(c: V3Ctx): boolean {
  return c.isEditing || c.team.some((m) => isFilled(m.name)) || !!(c.about && isFilled(c.about.content));
}

export function TeamSection({ kit, no }: { kit: Kit; no: string }) {
  const { c, folio, sec } = kit;
  const [extra, setExtra] = useState(0);
  useEffect(() => { if (!c.isEditing) setExtra(0); }, [c.isEditing]);

  const members = c.team;
  // the owner always has one blank slot to fill when there is nobody yet, and can add more
  const blanks = c.isEditing ? (members.length === 0 ? Math.max(extra, 1) : extra) : 0;
  const count = Math.min(MAX_TEAM, members.length + blanks);
  const people = Array.from({ length: count }, (_, i) => ({ i, m: members[i] ?? { name: '', role: '', credentials: '', experience: '' } }));
  const shown = c.isEditing ? people : people.filter(({ m }) => isFilled(m.name));
  const aboutText = c.about ? c.getEdit('about.content', c.about.content) : '';
  const heading = shown.length > 0 || c.isEditing ? c.teamHeading : (c.about?.heading || c.t.health.teamNoPeople);

  return (
    <>{sec(['team'], 'הרופא והצוות', (
      <section className="wrap team"><div className="sec" style={{ '--pad': '56px' } as CSSProperties}>
        {folio(no, heading)}
        <div>
          {(aboutText || c.isEditing) && c.about && (
            c.isEditing
              ? <c.EditableText as="p" className="team-about" value={aboutText} onCommit={(v) => c.setEdit('about.content', v)} isEditing />
              : <p className="team-about" data-rv="">{aboutText}</p>
          )}
          {shown.length > 0 && (
            <ul className="people">
              {shown.map(({ i, m }) => {
                const photo = m.photo_url;
                const lic = c.getEdit(`team.${i}.license_number`, m.license_number ?? '');
                return (
                  <li key={i} data-rv="" style={kit.d(i * 0.1)}>
                    {photo && <img className="pic" src={photo} alt={m.name} loading="lazy" />}
                    <div className="who">
                      {c.isEditing
                        ? <Field c={c} as="h3" path={`team.${i}.name`} value={m.name} hint={FIELD_HINTS.name} />
                        : <h3>{c.getEdit(`team.${i}.name`, m.name)}</h3>}
                      {c.isEditing
                        ? <Field c={c} path={`team.${i}.role`} value={m.role} hint={FIELD_HINTS.role} className="role" />
                        : isFilled(m.role) && <p className="role">{m.role}</p>}
                      {c.isEditing
                        ? <Field c={c} path={`team.${i}.credentials`} value={m.credentials} hint={FIELD_HINTS.credentials} />
                        : isFilled(m.credentials) && <p>{m.credentials}</p>}
                      {c.isEditing
                        ? <Field c={c} path={`team.${i}.experience`} value={m.experience} hint={FIELD_HINTS.experience} />
                        : isFilled(m.experience) && <p>{m.experience}</p>}
                      {/* a licence number only when the owner provided one */}
                      {c.isEditing
                        ? <p className="lic"><span>{c.t.license}</span><Field c={c} as="span" path={`team.${i}.license_number`} value={m.license_number ?? ''} hint={FIELD_HINTS.license} /></p>
                        : isFilled(lic) && <p className="lic"><span>{c.t.license}</span><b dir="ltr">{lic}</b></p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {c.isEditing && count < MAX_TEAM && (
            <button type="button" className="tile-add team-add" onClick={() => setExtra(blanks + 1)}>
              <Plus size={20} /> הוספת איש צוות
            </button>
          )}
        </div>
      </div></section>
    ))}</>
  );
}

// ── practical guide ───────────────────────────────────────────────────────────

export function renderPracticalGuide(kit: Kit): ReactNode {
  const { c, folio, nextNo, d } = kit;
  const langs = c.spokenLanguages;
  const langsText = c.getEdit('spoken_languages', langs.join(', '));
  const line = c.lang === 'he' ? languagesLine(c.isEditing ? parseLanguages(langsText) : langs) : c.t.spokenLine(langs);
  const parking = c.getEdit('practical_info.parking', c.practical.parking ?? '');
  const access = c.getEdit('practical_info.accessibility', c.practical.accessibility ?? '');
  const no = nextNo();
  const rows: Array<{ label: string; node: ReactNode }> = [];
  if (c.address) rows.push({ label: c.t.guide.address, node: <span dir="auto">{c.address}</span> });
  if (c.hours) rows.push({ label: c.t.guide.hours, node: <span style={{ whiteSpace: 'pre-line' }}>{c.hours}</span> });
  if (c.isEditing || isFilled(parking)) rows.push({ label: c.t.guide.parking, node: c.isEditing ? <Field c={c} as="span" path="practical_info.parking" value={parking} hint={FIELD_HINTS.parking} /> : <span>{parking}</span> });
  if (c.isEditing || isFilled(access)) rows.push({ label: c.t.guide.accessibility, node: c.isEditing ? <Field c={c} as="span" path="practical_info.accessibility" value={access} hint={FIELD_HINTS.accessibility} /> : <span>{access}</span> });

  return (
    <section className="wrap visit guide"><div className="sec" style={{ '--pad': '56px' } as CSSProperties}>
      {folio(no, c.t.health.visit)}
      <div>
        {(line || c.isEditing) && (
          <p className="langs" data-rv="">
            {c.isEditing ? (
              <>
                {c.lang === 'he' && <span>מדברים </span>}
                <c.EditableText as="span" value={langsText || FIELD_HINTS.languages} isEditing
                  onCommit={(v) => { const next = v === FIELD_HINTS.languages ? '' : v; if (next !== langsText) c.setEdit('spoken_languages', next); }} />
              </>
            ) : line}
          </p>
        )}
        {rows.length > 0 && (
          <dl className="guide-rows">
            {rows.map((r, i) => (
              <div key={r.label} data-rv="" style={d(i * 0.08)}><dt>{r.label}</dt><dd>{r.node}</dd></div>
            ))}
          </dl>
        )}
        {c.address && (
          <div className="links">
            <a data-rv="" href={`https://waze.com/ul?q=${encodeURIComponent(c.address)}&navigate=yes`} target="_blank" rel="noopener noreferrer">{c.t.waze}</a>
            <a data-rv="" style={d(0.09)} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`} target="_blank" rel="noopener noreferrer">Google Maps</a>
          </div>
        )}
      </div>
    </div></section>
  );
}

// ── before / after (off by default) ───────────────────────────────────────────

/** Shown only when the owner switched the section on AND has photos (the owner always sees it to add some). */
export function beforeAfterHasContent(c: V3Ctx): boolean {
  return c.galleryUrls.some(Boolean) || (c.canEdit && c.isEditing);
}

export function renderBeforeAfter(kit: Kit): ReactNode {
  const { c, folio, nextNo, sec, d } = kit;
  const EI = c.EditableImage;
  const filled = c.galleryUrls.map((src, i) => ({ src, i })).filter((x) => !!x.src);
  const nextFree = (() => { for (let i = 0; i < c.maxGallery; i++) if (!c.galleryUrls[i]) return i; return -1; })();
  const heading = c.getEdit('before_after.heading', c.t.health.beforeAfter);
  const no = nextNo();
  return sec(['before_after'], 'לפני ואחרי', (
    <section className="wrap"><div className="sec" style={{ '--padD': '72px', '--pad': '44px' } as CSSProperties}>
      {folio(no, c.isEditing
        ? <c.EditableText as="span" value={heading} onCommit={(v) => c.setEdit('before_after.heading', v)} isEditing />
        : heading)}
      <div>
        {c.isEditing ? (
          <>
            <p className="ba-owner-note">מציגים תמונות של מטופלים רק בהסכמה כתובה שלהם. התמונות כאן הן תמונות הגלריה של הדף.</p>
            <div className="gal-grid">
              {filled.map((x) => (
                <div className="tile" key={x.i}>
                  <EI src={x.src} primaryColor={c.primary} secondaryColor={c.secondary} logoUrl={c.logoUrl}
                    isEditingMode canEdit={c.canEdit} onEditClick={() => c.openImageModal(`gallery_${x.i}`)} />
                  <button type="button" className="rm" aria-label="הסר תמונה" onClick={() => c.removeGalleryImage(x.i)}><X size={16} /></button>
                </div>
              ))}
              {nextFree >= 0 && (
                <button type="button" className="tile-add" onClick={() => c.openImageModal(`gallery_${nextFree}`)}>
                  <Plus size={22} /> הוסף תמונה
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="strip" data-io="">
              {filled.map((x, i) => <img key={x.i} src={x.src} alt="" loading="lazy" style={d(i * 0.12)} />)}
            </div>
            <p className="ba-note">{c.t.baNote}</p>
          </>
        )}
      </div>
    </div></section>
  ));
}
