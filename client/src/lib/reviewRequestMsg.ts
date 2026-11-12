// Texts and links for review requests. The owner sends them from their own WhatsApp.

export const reviewUrl = (placeId: string) => `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;

/**
 * `service` is optional: the owner picks which service the customer received, and the message
 * only names it as the topic. The customer writes (and sends) the review themselves; we never write it.
 */
export function requestText(kind: 'first' | 'followup', name: string, business: string, link: string, service?: string | null): string {
  const s = service?.trim();
  if (kind === 'first') {
    return s
      ? `היי ${name}, תודה שבחרת ב${business}! נשמח מאוד אם תכתבו לנו ביקורת קצרה בגוגל על ${s}, זה לוקח דקה: ${link}`
      : `היי ${name}, תודה שבחרת ב${business}! נשמח מאוד אם תכתבו לנו ביקורת קצרה בגוגל, זה לוקח דקה: ${link}`;
  }
  return s
    ? `היי ${name}, תזכורת קטנה: אם נוח לך, נשמח לביקורת קצרה בגוגל על ${s} אצל ${business}: ${link} תודה רבה!`
    : `היי ${name}, תזכורת קטנה: אם נוח לך, נשמח לביקורת קצרה בגוגל על ${business}: ${link} תודה רבה!`;
}

/** phone is already normalized (9725XXXXXXXX). */
export function waLink(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function localPhone(phone: string): string {
  return phone.startsWith('972') ? '0' + phone.slice(3) : phone;
}

/** The same request without a name, for a message the owner forwards to any customer (what ReviewsCard sends). */
export function requestTextOpen(business: string, link: string): string {
  return `היי, תודה שבחרתם ב${business}! נשמח אם תכתבו לנו ביקורת בגוגל, זה לוקח דקה: ${link}`;
}

/** WhatsApp with the text ready and no recipient: the owner picks the customer there. */
export function waShare(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
