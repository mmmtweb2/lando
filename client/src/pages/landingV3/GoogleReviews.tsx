// The Google reviews of the business, on its own landing page (README part 143). Read from the owner's own
// listing (Business Profile API), selected on the server (4-5 stars, detailed, recent). Each review is shown
// exactly as the reviewer wrote it, with the first name, the stars and the date, under a clear "from Google"
// attribution and a link to the listing. The page's fixed words come from pageStrings; the review texts are
// never translated (dir="auto" so a review in another language reads the right way).
import type { PageReviews } from '../../lib/pageGoogle';
import { reviewDate } from '../../lib/pageGoogle';
import type { PageStrings } from '../../i18n/pageStrings';

function Stars({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className="gr-stars" role="img" aria-label={label} dir="ltr">
      <span className="gr-stars-off" aria-hidden="true">★★★★★</span>
      <span className="gr-stars-on" aria-hidden="true" style={{ width: `${pct}%` }}>★★★★★</span>
    </span>
  );
}

function GoogleMark() {
  return (
    <svg className="gr-g" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.8-2.1 5.1-4.4 6.7v5.6h7.1c4.2-3.8 6.6-9.5 6.6-16.3z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.6c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.6-3.9-12.3-9.1H4.4v5.7C8 41.1 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.7 28.1c-.4-1.3-.7-2.7-.7-4.1s.3-2.8.7-4.1v-5.7H4.4C2.9 17.2 2 20.5 2 24s.9 6.8 2.4 9.8l7.3-5.7z" />
      <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.4 2 8 6.9 4.4 14.2l7.3 5.7c1.7-5.2 6.6-9.1 12.3-9.1z" />
    </svg>
  );
}

export function GoogleReviews({ reviews, t, editNote }: { reviews: PageReviews; t: PageStrings; editNote?: string | null }) {
  const R = t.reviews;
  const score = reviews.rating.toLocaleString(R.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (
    <div className="greviews">
      <div className="gr-head" data-rv="">
        <span className="gr-score">{score}</span>
        <div className="gr-sum">
          <Stars value={reviews.rating} label={`${score} ${R.outOf}`} />
          <span className="gr-count">{R.count(reviews.count)}</span>
        </div>
        <span className="gr-attr" translate="no"><GoogleMark /> {R.fromGoogle}</span>
      </div>
      {editNote && <p className="gr-note">{editNote}</p>}
      <ul className="gr-list">
        {reviews.items.map((r, i) => (
          <li key={i} data-rv="">
            <figure>
              <Stars value={r.rating} label={R.stars(r.rating)} />
              <blockquote dir="auto">{r.text}</blockquote>
              <figcaption><b dir="auto">{r.name ?? R.anonymous}</b>{r.date ? <> · <time dateTime={r.date}>{reviewDate(r.date, R.locale)}</time></> : null}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
      {reviews.mapsUrl && (
        <a className="gr-all" href={reviews.mapsUrl} target="_blank" rel="noopener noreferrer">{R.seeAll}</a>
      )}
    </div>
  );
}
