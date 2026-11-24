import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronLeft, ClipboardCheck, Coins, Ellipsis, FileText, Globe, House, LogOut, Megaphone, Menu, Search, Settings, Star, TrendingUp, Users, X,
  type LucideIcon,
} from 'lucide-react';
import { LandoMark } from '../../components/Lando';
import { AREA_LABEL, type AreaId, type NavModel } from './areas';
import type { MenuSwitch } from './bridge';
import { MENU_COPY } from './setupMode';
import './shell.css';

// The dashboard's frame: ONE navigation (a sidebar; a drawer on small screens) grouped by product,
// and the page heading. It knows nothing about data: the page hands it the model and the content.

const ICON: Partial<Record<AreaId, LucideIcon>> = {
  home: House, reviews: Star, site: FileText, business: ClipboardCheck, automation: Megaphone, progress: TrendingUp, more: Ellipsis,
  pages: Globe, leads: Users, credits: Coins, settings: Settings, promote: Search,
};

// The pages-only account's way to the promotion product is a screen INSIDE the dashboard (area `promote`),
// which explains it and links to the public page; it is a regular entry, without an "external" arrow.
const OFFER_PAGES = { to: '/create', title: 'רוצים דפי נחיתה נוספים?', sub: 'דפים נוספים נרכשים בנפרד' } as const;

export interface ShellProps {
  /** null while the account is still loading */
  nav: NavModel | null;
  /** the sidebar entry that is lit */
  active: AreaId;
  onGo: (area: AreaId) => void;
  email: string;
  onLogout: () => void;
  /** the page heading; promotion screens bring their own, and pass only `srTitle` */
  title?: string;
  sub?: string;
  srTitle: string;
  /** right side of the heading (the credits, inside the pages area only) */
  tools?: ReactNode;
  /** small counters next to an entry (for example drafts that wait) */
  counts?: Partial<Record<AreaId, number>>;
  children: ReactNode;
  footer?: ReactNode;
  /** "מצב הגדרה" / "התפריט המלא", only while a setup is open */
  menuSwitch?: MenuSwitch | null;
  /** changes whenever another screen shows: focus then moves to that screen's heading */
  screenKey?: string;
}

function MenuSwitchBox({ sw, onNavigate }: { sw: MenuSwitch; onNavigate?: () => void }) {
  const c = MENU_COPY[sw.menu];
  return (
    <div className="dsh-menuswitch" data-menu={sw.menu}>
      <p>{c.line}</p>
      <button type="button" onClick={() => { sw.onSwitch(); onNavigate?.(); }}>{c.action}</button>
    </div>
  );
}

function NavList({ nav, active, onGo, counts, onNavigate, menuSwitch }: Pick<ShellProps, 'nav' | 'active' | 'onGo' | 'counts' | 'menuSwitch'> & { onNavigate?: () => void }) {
  const item = (a: AreaId) => {
    const Icon = ICON[a] ?? ChevronLeft;
    const n = counts?.[a] ?? 0;
    return (
      <li key={a}>
        <button type="button" className="dsh-item" aria-current={active === a ? 'page' : undefined} onClick={() => { onGo(a); onNavigate?.(); }}>
          <Icon size={18} aria-hidden />
          <span>{AREA_LABEL[a]}</span>
          {n > 0 && <span className="dsh-count">{n}<span className="sr-only"> מחכות לכם</span></span>}
        </button>
      </li>
    );
  };
  if (!nav) {
    return <div className="dsh-navload" aria-busy="true" aria-label="טוען"><span /><span /><span /><span /></div>;
  }
  return (
    <>
      {nav.groups.map((g) => (
        <section key={g.product} className="dsh-group" data-product={g.product} aria-label={g.label}>
          <h2 className="dsh-group-title">
            <span className="dsh-group-mark" aria-hidden>{g.product === 'promo' ? <Search size={14} strokeWidth={2.6} /> : <FileText size={14} strokeWidth={2.6} />}</span>
            {g.label}
          </h2>
          <ul>{g.items.map(item)}</ul>
          {g.product === 'promo' && menuSwitch && <MenuSwitchBox sw={menuSwitch} onNavigate={onNavigate} />}
        </section>
      ))}
      {nav.offer === 'promo' && (
        <button type="button" className="dsh-offer" aria-current={active === 'promote' ? 'page' : undefined} onClick={() => { onGo('promote'); onNavigate?.(); }}>
          <span><strong>{AREA_LABEL.promote}</strong><small>מוצר נפרד, במנוי חודשי</small></span>
          <Search size={16} aria-hidden />
        </button>
      )}
      {nav.offer === 'pages' && (
        <Link to={OFFER_PAGES.to} className="dsh-offer" onClick={onNavigate}>
          <span><strong>{OFFER_PAGES.title}</strong><small>{OFFER_PAGES.sub}</small></span>
          <ChevronLeft size={16} aria-hidden />
        </Link>
      )}
      <ul className="dsh-bottom">{nav.bottom.map(item)}</ul>
    </>
  );
}

function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <Link to="/" className="dsh-brand" onClick={onClick}>
      <LandoMark size={28} />
      <span className="dsh-wordmark">Pagey</span>
    </Link>
  );
}

export default function DashboardShell({ nav, active, onGo, email, onLogout, title, sub, srTitle, tools, counts, children, footer, menuSwitch, screenKey }: ShellProps) {
  const [open, setOpen] = useState(false);
  const headRef = useRef<HTMLHeadingElement>(null);
  const shownKey = useRef<string | undefined>(screenKey);

  // Another screen is showing (a click, the back button): focus moves to its heading, so a screen reader
  // announces it and the next Tab starts inside it. Not on the first load: the page starts at the top.
  useEffect(() => {
    if (screenKey === undefined || shownKey.current === screenKey) return;
    const first = shownKey.current === undefined;   // the account just finished loading: that is the first screen
    shownKey.current = screenKey;
    if (!first) headRef.current?.focus({ preventScroll: true });
  }, [screenKey]);
  const drawerId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // The drawer is a modal: focus goes in, Escape closes, Tab stays inside, focus returns to the button.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const menu = menuRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key !== 'Tab') return;
      const els = drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
      if (!els || els.length === 0) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; menu?.focus(); };
  }, [open]);

  const account = (after?: () => void) => (
    <div className="dsh-account">
      <p className="dsh-email" dir="ltr" title={email}>{email}</p>
      <button type="button" className="dsh-item dsh-logout" onClick={() => { after?.(); onLogout(); }}>
        <LogOut size={18} aria-hidden /><span>יציאה</span>
      </button>
    </div>
  );

  return (
    <div className="dsh" dir="rtl">
      <a href="#dsh-main" className="dsh-skip">דילוג לתוכן</a>

      <aside className="dsh-side">
        <div className="dsh-side-top"><Brand /></div>
        <nav className="dsh-nav" aria-label="ניווט ראשי"><NavList nav={nav} active={active} onGo={onGo} counts={counts} menuSwitch={menuSwitch} /></nav>
        {account()}
      </aside>

      {open && (
        <div className="dsh-drawer-wrap">
          <div className="dsh-backdrop" onClick={() => setOpen(false)} />
          <div className="dsh-drawer" id={drawerId} role="dialog" aria-modal="true" aria-label="תפריט" ref={drawerRef}>
            <div className="dsh-side-top">
              <Brand onClick={() => setOpen(false)} />
              <button type="button" ref={closeRef} className="dsh-iconbtn" aria-label="סגירת התפריט" onClick={() => setOpen(false)}><X size={22} aria-hidden /></button>
            </div>
            <nav className="dsh-nav" aria-label="ניווט ראשי"><NavList nav={nav} active={active} onGo={onGo} counts={counts} menuSwitch={menuSwitch} onNavigate={() => setOpen(false)} /></nav>
            {account(() => setOpen(false))}
          </div>
        </div>
      )}

      <div className="dsh-col">
        <header className="dsh-bar">
          <button type="button" ref={menuRef} className="dsh-iconbtn" aria-label="פתיחת התפריט" aria-expanded={open} aria-controls={drawerId} onClick={() => setOpen(true)}>
            <Menu size={22} aria-hidden />
          </button>
          <Brand />
          <span className="dsh-bar-where">{nav ? (nav.groups.find((g) => g.items.includes(active))?.label ?? AREA_LABEL[active]) : ''}</span>
        </header>

        <main id="dsh-main" className="dsh-main" tabIndex={-1}>
          {title ? (
            <div className="dsh-head">
              <div>
                <h1 ref={headRef} tabIndex={-1}>{title}</h1>
                {sub && <p>{sub}</p>}
              </div>
              {tools && <div className="dsh-tools">{tools}</div>}
            </div>
          ) : <h1 ref={headRef} tabIndex={-1} className="sr-only">{srTitle}</h1>}
          {children}
        </main>
        {footer}
      </div>
    </div>
  );
}
