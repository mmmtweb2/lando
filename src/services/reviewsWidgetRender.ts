// Stage 6.2 — HTML for the embeddable Google-reviews widget (served in an <iframe>).
//
// Places policy (developers.google.com/maps/documentation/places/web-service/policies):
//   • show the author of every review (avatar + name + profile link) next to it;
//   • link each review to the original on Google Maps (googleMapsUri);
//   • show Google attribution ("Google Maps" text, unchanged, translate="no") in the same
//     container as the content, visually separated from our own content;
//   • say how reviews are ordered, flag translations, note that Google doesn't verify
//     reviews, and offer flagContentUri.
// Not done on purpose: no aggregateRating / JSON-LD (Places content is not ours to mark up),
// no caching (the caller fetches per view). Every value is HTML-escaped; links are only
// emitted for https URLs.

import { esc } from './seoRender';
import type { PlaceReviewsSnapshot, RawReview } from './places.service';

export const MAX_REVIEWS_SHOWN = 5;
const POLICY_URL = 'https://support.google.com/contributionpolicy/answer/7400114';

export function writeReviewUrl(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

/** Only https links from Google-controlled fields are rendered; anything else is dropped. */
export function safeHttps(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function stars(rating: number): string {
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  return `<span class="stars" role="img" aria-label="${n} מתוך 5 כוכבים" dir="ltr">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;
}

function reviewHtml(r: RawReview): string {
  const a = r.authorAttribution ?? {};
  const name = esc(a.displayName || 'משתמש Google');
  const profile = safeHttps(a.uri);
  const photo = safeHttps(a.photoUri);
  const original = safeHttps(r.googleMapsUri);
  const flag = safeHttps(r.flagContentUri);
  const body = (r.text?.text ?? '').trim();
  const translated =
    !!r.originalText?.languageCode && !!r.text?.languageCode && r.originalText.languageCode !== r.text.languageCode;

  const avatar = photo
    ? `<img class="av" src="${esc(photo)}" alt="" width="36" height="36" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="av ph" aria-hidden="true"></span>`;
  const author = profile
    ? `<a href="${esc(profile)}" target="_blank" rel="noopener noreferrer">${name}</a>`
    : `<span>${name}</span>`;

  return `<li class="rv">
  <div class="rh">${avatar}<div class="who"><div class="nm">${author}</div>
  <div class="meta">${typeof r.rating === 'number' ? stars(r.rating) : ''}${r.relativePublishTimeDescription ? ` <span class="when">${esc(r.relativePublishTimeDescription)}</span>` : ''}</div></div></div>
  ${body ? `<p class="tx">${esc(body)}</p>` : ''}
  ${translated ? `<p class="note">תורגם על ידי Google</p>` : ''}
  <div class="links">${original ? `<a href="${esc(original)}" target="_blank" rel="noopener noreferrer">צפייה בביקורת ב-Google Maps</a>` : ''}${flag ? `<a href="${esc(flag)}" target="_blank" rel="noopener noreferrer">דיווח על תוכן</a>` : ''}</div>
</li>`;
}

const CSS = `
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:#1f2937;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;font-size:14px;line-height:1.5}
.box{border:1px solid #e2e8f0;border-radius:12px;margin:8px;padding:14px;background:#fff}
.top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
.attr{font-size:12px;font-weight:400;font-style:normal;color:#5E5E5E}
.sum{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.sum .big{font-size:22px;font-weight:700}
.stars{color:#f59e0b;letter-spacing:1px}.stars .off{color:#d1d5db}
ul{list-style:none;margin:0;padding:0}
.rv{border-top:1px solid #f1f5f9;padding:12px 0}
.rh{display:flex;gap:10px;align-items:center}
.av{width:36px;height:36px;border-radius:50%;background:#e5e7eb;flex:none;object-fit:cover}
.nm{font-weight:600}.nm a{color:inherit;text-decoration:none}
.meta{font-size:12px;color:#6b7280}
.tx{margin:8px 0 4px;white-space:pre-wrap;overflow-wrap:anywhere}
.note{margin:0;font-size:12px;color:#6b7280}
.links{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;margin-top:4px}
a{color:#2E63F6}
.cta{display:inline-block;margin-top:8px;background:#2E63F6;color:#fff;border-radius:8px;padding:8px 14px;text-decoration:none;font-weight:600}
.foot{font-size:11px;color:#6b7280;margin-top:10px;border-top:1px solid #f1f5f9;padding-top:8px}
`;

function shell(inner: string): string {
  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>ביקורות Google</title><style>${CSS}</style></head>
<body>${inner}</body></html>`;
}

/** Live view: Google content + required attribution, all in one visually separated container. */
export function renderReviewsWidget(data: PlaceReviewsSnapshot, placeId: string): string {
  const reviews = (data.reviews ?? []).slice(0, MAX_REVIEWS_SHOWN);
  const maps = safeHttps(data.googleMapsUri);
  const rating = typeof data.rating === 'number' ? data.rating : null;
  const count = typeof data.userRatingCount === 'number' ? data.userRatingCount : null;
  return shell(`<div class="box">
  <div class="top"><div><strong>${esc(data.displayName?.text ?? '')}</strong></div>
  <span class="attr" translate="no">Google Maps</span></div>
  ${rating !== null ? `<div class="sum"><span class="big" dir="ltr">${esc(rating.toFixed(1))}</span>${stars(rating)}${count !== null ? `<span class="meta">(${esc(count)} ביקורות ב-Google)</span>` : ''}</div>` : ''}
  ${reviews.length ? `<ul>${reviews.map(reviewHtml).join('')}</ul>` : `<p class="note">אין עדיין ביקורות להצגה.</p>`}
  <div><a class="cta" href="${esc(writeReviewUrl(placeId))}" target="_blank" rel="noopener noreferrer">כתבו ביקורת ב-Google</a>${maps ? ` <a href="${esc(maps)}" target="_blank" rel="noopener noreferrer">צפייה בכל הביקורות ב-Google Maps</a>` : ''}</div>
  <div class="foot">מוצגות עד ${MAX_REVIEWS_SHOWN} ביקורות, לפי הרלוונטיות שקבעה Google. Google אינה מאמתת ביקורות, ומסירה תוכן שזוהה כמזויף (<a href="${esc(POLICY_URL)}" target="_blank" rel="noopener noreferrer">מדיניות</a>).</div>
</div>`);
}

/**
 * No Google content at all (daily budget spent, or Google unreachable): only our own
 * "write a review" button, built from the stored place_id, plus a plain Maps link.
 */
export function renderReviewsFallback(placeId: string): string {
  return shell(`<div class="box"><p class="note">נהניתם? נשמח לביקורת.</p>
  <a class="cta" href="${esc(writeReviewUrl(placeId))}" target="_blank" rel="noopener noreferrer">כתבו ביקורת ב-Google</a></div>`);
}

/** Business missing, not entitled, or widget disabled. Reveals nothing about why. */
export function renderReviewsUnavailable(): string {
  return shell(`<div class="box"><p class="note">הווידג'ט אינו זמין כרגע.</p></div>`);
}
