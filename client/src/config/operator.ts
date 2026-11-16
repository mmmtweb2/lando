// Who operates Pagey: the ONE place the legal pages (privacy, terms, accessibility) read it from.
// TODO(Moshe): replace the bracketed placeholders with the real details before opening to the public.
// Israeli law expects an online seller to identify itself (name, business number, address, contact).

export const OPERATOR = {
  name: '[שם העסק המלא]',
  businessNumber: '[מספר עוסק]',
  address: '[כתובת]',
  phone: '[טלפון]',
  email: 'tirnoer.digital@gmail.com',
  site: 'pagey.co.il',
} as const;

/** A detail is shown only once it is filled in: the live site never shows "[...]" placeholders. */
export const filled = (v: string): boolean => Boolean(v) && !v.startsWith('[');

/** One line for footers and contact sections: "name, ע.מ …, address · phone · email" (filled parts only). */
export const OPERATOR_LINE = [
  [filled(OPERATOR.name) ? OPERATOR.name : 'Pagey', filled(OPERATOR.businessNumber) ? `עוסק מס' ${OPERATOR.businessNumber}` : '', filled(OPERATOR.address) ? OPERATOR.address : '']
    .filter(Boolean).join(', '),
  filled(OPERATOR.phone) ? `טלפון ${OPERATOR.phone}` : '',
  OPERATOR.email,
].filter(Boolean).join(' · ');
