// Who operates Pagey: the ONE place the legal pages (privacy, terms, accessibility) read it from.
// Israeli law expects an online seller to identify itself (name, business number, address, contact).

export const OPERATOR = {
  name: 'Tirnoer Digital',
  businessNumber: '207963521',
  address: 'גפן 3, שמעה',
  phone: '0586690351',
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
