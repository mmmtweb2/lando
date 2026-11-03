// The full recommendations list of the Audit, sorted by impact on the score (task #9).
// Pure: built from the audit the server already returned. Honest about who does what: only items
// the product really handles carry the "we take care of it" label.

import type { Audit, AuditItem } from './auditShared';

export type Impact = 'high' | 'medium' | 'low';
export interface Recommendation {
  key: string; title: string; why: string; how: string; impact: Impact;
  /** null = the customer does it alone; 'now' / 'soon' = we do it for them after sign-up. */
  weDo: 'now' | 'soon' | null;
  weDoLabel: string | null;
  level: 'ok' | 'weak';
}

/** Points each item is worth in the score (they sum to 100). */
export const WEIGHT: Record<string, number> = { reviews: 25, rating: 25, photos: 15, website: 10, phone: 8, hours: 7, category: 5, status: 5 };

const ORDER = Object.keys(WEIGHT); // stable tie-break: the order above

const WHY: Record<string, string> = {
  reviews: 'ביקורות רבות ועדכניות עוזרות ללקוחות להחליט למי לפנות.',
  rating: 'דירוג גבוה עוזר ללקוח להחליט לפנות אליכם, ולא לעבור לעסק הבא ברשימה.',
  photos: 'לקוחות מסתכלים בתמונות לפני שהם מחליטים למי לפנות.',
  website: 'אתר או דף נחיתה נותנים ללקוח מקום לקרוא עוד ולפנות אליכם.',
  phone: 'בלי מספר טלפון בכרטיס העסק אי אפשר להתקשר בלחיצה אחת מהמפה.',
  hours: 'שעות פעילות מעודכנות עוזרות ללקוחות לדעת מתי אפשר להגיע או להתקשר.',
  category: 'הקטגוריה מסבירה ללקוחות איזה סוג עסק אתם.',
  status: 'כרטיס עסק שמסומן כסגור כמעט לא מקבל פניות.',
};

const impactOf = (points: number): Impact => (points >= 20 ? 'high' : points >= 8 ? 'medium' : 'low');

export function buildRecommendations(audit: Pick<Audit, 'items'>): Recommendation[] {
  const gaps = audit.items.filter((i): i is AuditItem & { level: 'ok' | 'weak' } => i.level !== 'good');
  return gaps
    .map((i) => {
      // Half the points are still open on an "ok" item.
      const open = (WEIGHT[i.key] ?? 5) * (i.level === 'weak' ? 1 : 0.5);
      const weDo = i.weDo && i.weDoAvailability ? i.weDoAvailability : null;
      return {
        rec: {
          key: i.key, title: i.label, level: i.level, impact: impactOf(open),
          why: WHY[i.key] ?? '',
          how: i.youDo || i.tip || i.weDo,
          weDo,
          weDoLabel: weDo === 'now' ? 'נטפל בזה בשבילכם אחרי ההרשמה' : weDo === 'soon' ? 'בקרוב: נטפל בזה בשבילכם' : null,
        } as Recommendation,
        open,
      };
    })
    .sort((a, b) => b.open - a.open || (WEIGHT[b.rec.key] ?? 0) - (WEIGHT[a.rec.key] ?? 0) || ORDER.indexOf(a.rec.key) - ORDER.indexOf(b.rec.key))
    .map((x) => x.rec);
}

export const IMPACT_LABEL: Record<Impact, string> = { high: 'השפעה גבוהה', medium: 'השפעה בינונית', low: 'השפעה נמוכה' };
