import { useState } from 'react';
import { pageStrings } from '../i18n/pageStrings';
import { langDir } from '../i18n/landingLanguages';

// ─────────────────────────────────────────────────────────────────────────────
// Terms-of-use + accessibility block for a CUSTOMER-GENERATED page (/p/:slug).
//
// Why it lives on the generated page and not only on pagey.co.il: accessibility
// duties under חוק שוויון זכויות לאנשים עם מוגבלות, התשנ"ח-1998 and תקנות
// שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע"ג-2013 attach to
// the business whose service the site provides — i.e. to Pagey's CUSTOMER, not
// to Pagey. A page published for a business with no accessibility statement at
// all is the customer's exposure, so every generated page carries its own,
// named for that business.
//
// Everything here is templated from data the page object already has
// (business_name / phone / email / address). This component reads no AI content
// beyond the contact block and generates nothing.
//
// Presentation: collapsed by default to a single quiet line, so it never
// competes with the business's own design; when opened it inherits the page's
// own accent colour and sits inside the same dark footer band as the contact
// section, rather than looking like a bolted-on foreign block.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  businessName: string;
  phone?: string;
  email?: string;
  address?: string;
  /** The page's own accent colour, so the block matches its generated design. */
  accent: string;
  /** Extra bottom padding when the owner's edit toolbar is on screen. */
  extraBottomPad?: boolean;
  /** 'v3': drawn inside the Pinkas page, in its paper and ink colours (see landingV3.css) */
  variant?: 'v3';
  /** Page language (README part 142): French and English are static, faithful translations of the Hebrew text. */
  lang?: string;
}

export default function PageLegalFooter({
  businessName, phone, email, address, accent, extraBottomPad = false, variant, lang = 'he',
}: Props) {
  const v3 = variant === 'v3';
  const [open, setOpen] = useState(false);
  const L = pageStrings(lang).legal;
  const dir = langDir(lang);
  const name = businessName?.trim() || L.defaultName;
  const hasContact = !!(phone || email);

  // How a visitor reaches the business about an accessibility problem. Falls
  // back to the page's own contact form when the business published neither a
  // phone nor an email — never leaves the statement without a channel.
  const contactLine = hasContact
    ? [phone ? `${L.contactPhone}: ${phone}` : null, email ? `${L.contactEmail}: ${email}` : null].filter(Boolean).join(' · ')
    : L.contactForm;
  const [acc1, acc2] = L.acc(name);

  return (
    <section className={v3 ? `lp3-legal${extraBottomPad ? ' pad' : ''}` : `bg-slate-900 text-slate-400 px-6 ${extraBottomPad ? 'pb-24' : 'pb-8'}`} dir={dir} lang={lang}>
      <div className={v3 ? 'lp3-legal-in' : 'max-w-2xl mx-auto border-t border-white/10 pt-6'}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={v3 ? 'lp3-legal-toggle' : 'mx-auto flex items-center gap-1.5 text-xs hover:text-white transition'}
        >
          <span>{L.toggle}</span>
          <span aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`}>⌄</span>
        </button>

        {open && (
          <div className={v3 ? 'lp3-legal-body' : 'mt-5 flex flex-col gap-5 text-right text-[12px] leading-[1.85] text-slate-400'}>

            <div>
              <h3 className={v3 ? undefined : 'text-[13px] font-bold text-slate-200 mb-1.5'} style={v3 ? undefined : { color: accent }}>{L.termsTitle}</h3>
              {L.terms(name).map((para, i) => <p key={i} className={i ? 'mt-2' : undefined}>{para}</p>)}
            </div>

            <div>
              <h3 className={v3 ? undefined : 'text-[13px] font-bold text-slate-200 mb-1.5'} style={v3 ? undefined : { color: accent }}>{L.accTitle}</h3>
              <p>{acc1}</p>
              <p className="mt-2">{acc2}</p>
              <p className="mt-2">
                {L.accContactLead} {contactLine}
                {address ? <> · {L.address}: <bdi>{address}</bdi></> : null}
              </p>
              <p className={v3 ? 'note' : 'mt-2 text-slate-500'}>
                {L.responsibility(name)}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
