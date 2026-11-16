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

/** One line for footers and contact sections: "name, ע.מ …, address · phone · email". */
export const OPERATOR_LINE = `${OPERATOR.name}, עוסק מס' ${OPERATOR.businessNumber}, ${OPERATOR.address} · טלפון ${OPERATOR.phone} · ${OPERATOR.email}`;
