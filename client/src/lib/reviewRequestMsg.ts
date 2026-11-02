// Texts and links for review requests. The owner sends them from their own WhatsApp.

export const reviewUrl = (placeId: string) => `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;

export function requestText(kind: 'first' | 'followup', name: string, business: string, link: string): string {
  return kind === 'first'
    ? `היי ${name}, תודה שבחרת ב${business}! נשמח מאוד אם תכתבו לנו ביקורת קצרה בגוגל, זה לוקח דקה: ${link}`
    : `היי ${name}, תזכורת קטנה: אם נוח לך, נשמח לביקורת קצרה בגוגל על ${business}: ${link} תודה רבה!`;
}

/** phone is already normalized (9725XXXXXXXX). */
export function waLink(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function localPhone(phone: string): string {
  return phone.startsWith('972') ? '0' + phone.slice(3) : phone;
}
