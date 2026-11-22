// The fixed visitor-facing words of a landing page (design V3), per page language (README part 142).
// The page's own texts (headline, services, FAQ...) are translated per page; these are the words around them:
// buttons, fallback headings, the lead form, the legal block. The Hebrew entries are exactly the words the page
// always used. The legal block is a static, faithful translation of the Hebrew template (never generated).
// Adding a language later (Russian, Arabic) = one more entry here + `enabled` in both landingLanguages files.
import { HEALTH_HEADINGS, formatLanguages } from '../config/pageCategory';
import type { LangCode } from './landingLanguages';

export interface LegalText {
  toggle: string;
  termsTitle: string;
  terms: (name: string) => string[];
  accTitle: string;
  acc: (name: string) => [string, string];
  accContactLead: string;
  contactPhone: string;
  contactEmail: string;
  contactForm: string;
  address: string;
  responsibility: (name: string) => string;
  defaultName: string;
}

export interface PageStrings {
  langNavLabel: string;
  call: string;
  askOnWhatsApp: string;
  aboutFallback: string;
  gallery: string;
  visit: string;
  waze: string;
  waPreview: string;
  waFab: string;
  waFabLabel: string;
  headings: { services: string; process: string; testimonials: string; faq: string };
  health: { services: string; team: string; teamNoPeople: string; testimonials: string; process: string; faq: string; visit: string; beforeAfter: string };
  closingGeneral: (name: string) => string;
  closingHealth: string;
  ctaDefault: string;
  waDefault: (name: string) => string;
  waService: (title: string) => string;
  waChildSuffix: (page: string) => string;
  license: string;
  guide: { address: string; hours: string; parking: string; accessibility: string; areas: string };
  /** README part 143: the Google reviews section. The reviews themselves are shown as written, never translated. */
  reviews: {
    fromGoogle: string; outOf: string; count: (n: number) => string; seeAll: string; anonymous: string;
    stars: (n: number) => string; locale: string;
  };
  /** Short day names for opening hours read from the business card, Sunday first. */
  days: [string, string, string, string, string, string, string];
  /** Accessibility and parking details from the Google listing, by Google's attribute id (Hebrew uses Google's own words). */
  attrs: Record<string, string>;
  spokenLine: (list: string[]) => string;
  baNote: string;
  credit: string;
  altFallback: (name: string) => string;
  lead: {
    kicker: string; heading: string; sentTitle: string; sentBody: string; draftNote: string;
    name: string; namePh: string; phone: string; email: string; message: string; messagePh: string;
    submit: string; sending: string; privacy: (name: string) => string;
    errGeneric: string; errInvalid: string; errClosed: string; errTooMany: string;
  };
  legal: LegalText;
}

const list = (items: string[], and: string) => {
  const l = items.map((x) => x.trim()).filter(Boolean);
  if (l.length <= 1) return l[0] ?? '';
  return `${l.slice(0, -1).join(', ')} ${and} ${l[l.length - 1]}`;
};

const HE: PageStrings = {
  langNavLabel: 'שפת הדף',
  call: 'התקשרו',
  askOnWhatsApp: 'שאלו על זה בוואטסאפ',
  aboutFallback: 'הסיפור שלנו',
  gallery: 'גלריה',
  visit: 'בואו לבקר',
  waze: 'ניווט ב-Waze',
  waPreview: 'ההודעה שתישלח בוואטסאפ',
  waFab: 'דברו איתנו',
  waFabLabel: 'פתח שיחת WhatsApp',
  headings: { services: 'מה אנחנו מציעים', process: 'איך זה עובד', testimonials: 'מה אומרים עלינו', faq: 'שאלות נפוצות' },
  health: { ...HEALTH_HEADINGS },
  closingGeneral: (name) => `מוכנים להתחיל עם ${name}?`,
  closingHealth: 'נשמח לשמוע מכם',
  ctaDefault: 'צרו קשר עכשיו',
  waDefault: (name) => `שלום, מצאתי את הדף של ${name} ואשמח לקבל פרטים.`,
  waService: (title) => `שלום, אשמח לשמוע על ${title}`,
  waChildSuffix: (page) => ` (עמוד: ${page})`,
  license: 'מספר רישיון: ',
  guide: { address: 'כתובת', hours: 'שעות פעילות', parking: 'חניה', accessibility: 'נגישות', areas: 'אזורי שירות' },
  reviews: {
    fromGoogle: 'ביקורות מגוגל', outOf: 'מתוך 5', count: (n) => (n === 1 ? 'ביקורת אחת' : `${n.toLocaleString('he-IL')} ביקורות`),
    seeAll: 'לכל הביקורות בגוגל', anonymous: 'לקוח/ה מגוגל', stars: (n) => `${n} מתוך 5 כוכבים`, locale: 'he-IL',
  },
  days: ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'],
  attrs: {
    has_wheelchair_accessible_entrance: 'כניסה נגישה לכיסאות גלגלים',
    has_wheelchair_accessible_restroom: 'שירותים נגישים',
    has_wheelchair_accessible_seating: 'ישיבה נגישה',
    has_wheelchair_accessible_parking: 'חניית נכים',
    has_wheelchair_accessible_elevator: 'מעלית נגישה',
    has_hearing_loop: 'לולאת השראה',
    has_free_parking_lot: 'חניון חינם',
    has_paid_parking_lot: 'חניון בתשלום',
    has_free_street_parking: 'חניה חינם ברחוב',
    has_paid_street_parking: 'חניה בתשלום ברחוב',
    has_free_parking_garage: 'חניון מקורה חינם',
    has_paid_parking_garage: 'חניון מקורה בתשלום',
    has_valet_parking: 'שירות חניה (ולה)',
  },
  spokenLine: (l) => { const s = formatLanguages(l); return s ? `מדברים ${s}` : ''; },
  baNote: 'התוצאות משתנות מאדם לאדם.',
  credit: 'נוצר באמצעות Pagey',
  altFallback: (name) => (name.trim() ? `תמונה מהעבודה של ${name.trim().slice(0, 60)}` : 'תמונה מהעבודה שלנו'),
  lead: {
    kicker: 'השאירו פרטים', heading: 'נחזור אליכם בהקדם', sentTitle: 'הפרטים התקבלו.', sentBody: 'ניצור איתכם קשר בהקדם האפשרי.',
    draftNote: 'הדף עדיין בטיוטה. אי אפשר לשלוח פניות דרך הטופס עד שהדף מתפרסם.',
    name: 'שם מלא', namePh: 'ישראל ישראלי', phone: 'טלפון', email: 'אימייל (לא חובה)', message: 'הודעה (לא חובה)', messagePh: 'ספרו לנו איך נוכל לעזור',
    submit: 'שליחה', sending: 'שולח…',
    privacy: (name) => `הפרטים נמסרים ל${name || 'בעל העסק'} לצורך חזרה אליכם, ונשמרים במערכת Pagey המשמשת אותו. מסירתם אינה חובה.`,
    errGeneric: 'שגיאה בשליחת הפרטים. אנא נסו שוב.', errInvalid: 'יש לבדוק את הפרטים ולנסות שוב.',
    errClosed: 'הדף אינו מקבל פניות כרגע.', errTooMany: 'יותר מדי שליחות בזמן קצר. נסו שוב מאוחר יותר.',
  },
  legal: {
    toggle: 'תנאי שימוש ונגישות',
    termsTitle: 'תנאי שימוש',
    terms: (n) => [
      `דף זה מופעל על ידי ${n} ומיועד למסירת מידע על העסק ולפנייה אליו. המידע המוצג בדף, לרבות תיאורי שירותים, מחירים, שעות פעילות וזמינות, ניתן כמות שהוא ועשוי להשתנות מעת לעת. אין לראות במידע שבדף הצעה מחייבת, ייעוץ מקצועי או התחייבות למתן שירות, ואין להסתמך עליו כתחליף לבירור ישיר מול ${n}.`,
      `פנייה באמצעות טופס יצירת הקשר או באמצעות פרטי הקשר שבדף מהווה הסכמה לכך ש${n} יעשה שימוש בפרטים שמסרתם לצורך חזרה אליכם ומענה לפנייתכם. אין למסור בטופס מידע רגיש שאינו נדרש לצורך הפנייה.`,
      `קישורים לאתרים או לעמודים חיצוניים, ככל שקיימים בדף, ניתנים לנוחותכם בלבד. אין ל${n} שליטה על תוכנם והוא אינו אחראי להם. תוכן הדף, לרבות טקסטים, תמונות, לוגו וסימנים מסחריים, מיועד לשימושו של ${n}; אין להעתיקו או לעשות בו שימוש מסחרי ללא רשות. על השימוש בדף יחולו דיני מדינת ישראל.`,
    ],
    accTitle: 'הצהרת נגישות',
    acc: (n) => [
      `${n} רואה חשיבות במתן שירות לכלל הציבור, לרבות אנשים עם מוגבלות, ופועל לשיפור נגישות הדף בהתאם לחוק שוויון זכויות לאנשים עם מוגבלות, התשנ"ח-1998 ולתקנות שהותקנו מכוחו.`,
      'הדף נבנה בתשתית התומכת בנגישות: תוכן בעברית בכיוון מימין לשמאל, מבנה כותרות סמנטי, שדות טופס בעלי תוויות, טקסט חלופי לתמונות, ניווט באמצעות מקלדת ותצוגה המותאמת לגדלי מסך שונים ולהגדלת התצוגה בדפדפן. עם זאת, הדף טרם עבר ביקורת נגישות חיצונית ואינו מצהיר על עמידה מלאה בתקן הישראלי ת"י 5568, וייתכנו בו רכיבים שאינם נגישים במלואם.',
    ],
    accContactLead: 'נתקלתם בקושי בשימוש בדף? נשמח שתפנו אלינו ונפעל לתקן.',
    contactPhone: 'טלפון', contactEmail: 'דוא"ל', contactForm: 'באמצעות טופס יצירת הקשר בדף זה', address: 'כתובת',
    responsibility: (n) => `האחריות לתוכן הדף ולהנגשתו היא של ${n}, המפעיל את הדף.`,
    defaultName: 'העסק',
  },
};

const FR: PageStrings = {
  langNavLabel: 'Langue de la page',
  call: 'Appeler',
  askOnWhatsApp: 'Demander sur WhatsApp',
  aboutFallback: 'Notre histoire',
  gallery: 'Galerie',
  visit: 'Nous rendre visite',
  waze: 'Itinéraire Waze',
  waPreview: 'Le message envoyé sur WhatsApp',
  waFab: 'Écrivez-nous',
  waFabLabel: 'Ouvrir une conversation WhatsApp',
  headings: { services: 'Ce que nous proposons', process: 'Comment ça se passe', testimonials: 'Ce qu’on dit de nous', faq: 'Questions fréquentes' },
  health: {
    services: 'Nos soins', team: 'Le médecin et l’équipe', teamNoPeople: 'À propos du cabinet', testimonials: 'Ce que disent nos patients',
    process: 'La première visite', faq: 'Questions avant de venir', visit: 'Informations pratiques', beforeAfter: 'Avant et après',
  },
  closingGeneral: (name) => `Prêts à commencer avec ${name} ?`,
  closingHealth: 'Nous serons heureux de vous entendre',
  ctaDefault: 'Nous contacter',
  waDefault: (name) => `Bonjour, j’ai trouvé la page de ${name} et j’aimerais avoir des informations.`,
  waService: (title) => `Bonjour, j’aimerais en savoir plus sur : ${title}`,
  waChildSuffix: (page) => ` (page : ${page})`,
  license: 'Numéro de licence : ',
  guide: { address: 'Adresse', hours: 'Horaires', parking: 'Stationnement', accessibility: 'Accessibilité', areas: 'Zones desservies' },
  reviews: {
    fromGoogle: 'Avis Google', outOf: 'sur 5', count: (n) => (n === 1 ? '1 avis' : `${n.toLocaleString('fr-FR')} avis`),
    seeAll: 'Tous les avis sur Google', anonymous: 'Client Google', stars: (n) => `${n} étoiles sur 5`, locale: 'fr-FR',
  },
  days: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
  attrs: {
    has_wheelchair_accessible_entrance: 'Entrée accessible en fauteuil roulant',
    has_wheelchair_accessible_restroom: 'Toilettes accessibles',
    has_wheelchair_accessible_seating: 'Places assises accessibles',
    has_wheelchair_accessible_parking: 'Parking accessible',
    has_wheelchair_accessible_elevator: 'Ascenseur accessible',
    has_hearing_loop: 'Boucle magnétique',
    has_free_parking_lot: 'Parking gratuit',
    has_paid_parking_lot: 'Parking payant',
    has_free_street_parking: 'Stationnement gratuit dans la rue',
    has_paid_street_parking: 'Stationnement payant dans la rue',
    has_free_parking_garage: 'Parking couvert gratuit',
    has_paid_parking_garage: 'Parking couvert payant',
    has_valet_parking: 'Voiturier',
  },
  spokenLine: (l) => { const s = list(l, 'et'); return s ? `Nous parlons ${s}` : ''; },
  baNote: 'Les résultats varient d’une personne à l’autre.',
  credit: 'Créé avec Pagey',
  altFallback: (name) => (name.trim() ? `Photo du travail de ${name.trim().slice(0, 60)}` : 'Photo de notre travail'),
  lead: {
    kicker: 'Laissez vos coordonnées', heading: 'Nous vous recontactons rapidement', sentTitle: 'Vos coordonnées ont bien été reçues.',
    sentBody: 'Nous vous contacterons dès que possible.',
    draftNote: 'Cette page est encore un brouillon. Le formulaire ne peut pas encore être envoyé.',
    name: 'Nom complet', namePh: 'Votre nom', phone: 'Téléphone', email: 'E-mail (facultatif)', message: 'Message (facultatif)',
    messagePh: 'Dites-nous comment nous pouvons vous aider', submit: 'Envoyer', sending: 'Envoi…',
    privacy: (name) => `Vos coordonnées sont transmises à ${name || 'l’entreprise'} pour vous recontacter, et conservées dans le système Pagey qu’elle utilise. Leur transmission n’est pas obligatoire.`,
    errGeneric: 'L’envoi n’a pas abouti. Veuillez réessayer.', errInvalid: 'Veuillez vérifier vos coordonnées et réessayer.',
    errClosed: 'Cette page ne reçoit pas de demandes pour le moment.', errTooMany: 'Trop d’envois en peu de temps. Réessayez plus tard.',
  },
  legal: {
    toggle: 'Conditions d’utilisation et accessibilité',
    termsTitle: 'Conditions d’utilisation',
    terms: (n) => [
      `Cette page est exploitée par ${n} et sert à donner des informations sur l’entreprise et à la contacter. Les informations présentées sur la page, y compris les descriptions de services, les prix, les horaires et la disponibilité, sont fournies telles quelles et peuvent changer de temps à autre. Elles ne constituent pas une offre ferme, un conseil professionnel ou un engagement à fournir un service, et ne remplacent pas une vérification directe auprès de ${n}.`,
      `Prendre contact au moyen du formulaire ou des coordonnées figurant sur la page vaut accord pour que ${n} utilise les informations que vous avez transmises afin de vous recontacter et de répondre à votre demande. Ne transmettez pas dans le formulaire d’informations sensibles qui ne sont pas nécessaires à votre demande.`,
      `Les liens vers des sites ou des pages externes, s’il y en a sur la page, sont fournis uniquement pour votre commodité. ${n} n’a aucun contrôle sur leur contenu et n’en est pas responsable. Le contenu de la page, y compris les textes, images, logo et marques, est destiné à l’usage de ${n} ; il est interdit de le copier ou d’en faire un usage commercial sans autorisation. L’utilisation de la page est régie par le droit de l’État d’Israël.`,
    ],
    accTitle: 'Déclaration d’accessibilité',
    acc: (n) => [
      `${n} attache de l’importance au service de l’ensemble du public, y compris des personnes en situation de handicap, et agit pour améliorer l’accessibilité de la page conformément à la loi israélienne sur l’égalité des droits des personnes handicapées, 5758-1998, et aux règlements pris en application de celle-ci.`,
      'La page repose sur une infrastructure qui prend en charge l’accessibilité : contenu en français, lu de gauche à droite (une version en hébreu est également disponible), structure de titres sémantique, champs de formulaire avec libellés, texte alternatif pour les images, navigation au clavier et affichage adapté aux différentes tailles d’écran et au zoom du navigateur. Toutefois, la page n’a pas encore fait l’objet d’un audit d’accessibilité externe et ne déclare pas une conformité complète à la norme israélienne SI 5568 ; certains éléments peuvent ne pas être entièrement accessibles.',
    ],
    accContactLead: 'Vous rencontrez une difficulté sur cette page ? Contactez-nous et nous ferons le nécessaire pour la corriger.',
    contactPhone: 'Téléphone', contactEmail: 'E-mail', contactForm: 'au moyen du formulaire de contact de cette page', address: 'Adresse',
    responsibility: (n) => `Le contenu de la page et son accessibilité relèvent de la responsabilité de ${n}, qui exploite la page.`,
    defaultName: 'l’entreprise',
  },
};

const EN: PageStrings = {
  langNavLabel: 'Page language',
  call: 'Call',
  askOnWhatsApp: 'Ask about it on WhatsApp',
  aboutFallback: 'Our story',
  gallery: 'Gallery',
  visit: 'Visit us',
  waze: 'Navigate with Waze',
  waPreview: 'The message sent on WhatsApp',
  waFab: 'Talk to us',
  waFabLabel: 'Open a WhatsApp chat',
  headings: { services: 'What we offer', process: 'How it works', testimonials: 'What people say', faq: 'Frequently asked questions' },
  health: {
    services: 'Our treatments', team: 'The doctor and team', teamNoPeople: 'About the clinic', testimonials: 'What our patients say',
    process: 'Your first visit', faq: 'Questions before you come', visit: 'Practical information', beforeAfter: 'Before and after',
  },
  closingGeneral: (name) => `Ready to get started with ${name}?`,
  closingHealth: 'We would be glad to hear from you',
  ctaDefault: 'Contact us',
  waDefault: (name) => `Hello, I found the page of ${name} and would like more information.`,
  waService: (title) => `Hello, I would like to hear about: ${title}`,
  waChildSuffix: (page) => ` (page: ${page})`,
  license: 'License number: ',
  guide: { address: 'Address', hours: 'Opening hours', parking: 'Parking', accessibility: 'Accessibility', areas: 'Areas served' },
  reviews: {
    fromGoogle: 'Google reviews', outOf: 'out of 5', count: (n) => (n === 1 ? '1 review' : `${n.toLocaleString('en-US')} reviews`),
    seeAll: 'All reviews on Google', anonymous: 'Google user', stars: (n) => `${n} out of 5 stars`, locale: 'en-GB',
  },
  days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  attrs: {
    has_wheelchair_accessible_entrance: 'Wheelchair-accessible entrance',
    has_wheelchair_accessible_restroom: 'Wheelchair-accessible restroom',
    has_wheelchair_accessible_seating: 'Wheelchair-accessible seating',
    has_wheelchair_accessible_parking: 'Wheelchair-accessible parking',
    has_wheelchair_accessible_elevator: 'Wheelchair-accessible lift',
    has_hearing_loop: 'Hearing loop',
    has_free_parking_lot: 'Free parking lot',
    has_paid_parking_lot: 'Paid parking lot',
    has_free_street_parking: 'Free street parking',
    has_paid_street_parking: 'Paid street parking',
    has_free_parking_garage: 'Free parking garage',
    has_paid_parking_garage: 'Paid parking garage',
    has_valet_parking: 'Valet parking',
  },
  spokenLine: (l) => { const s = list(l, 'and'); return s ? `We speak ${s}` : ''; },
  baNote: 'Results vary from person to person.',
  credit: 'Made with Pagey',
  altFallback: (name) => (name.trim() ? `A photo of the work of ${name.trim().slice(0, 60)}` : 'A photo of our work'),
  lead: {
    kicker: 'Leave your details', heading: 'We will get back to you soon', sentTitle: 'Your details were received.',
    sentBody: 'We will contact you as soon as possible.',
    draftNote: 'This page is still a draft. The form cannot be sent until the page is published.',
    name: 'Full name', namePh: 'Your name', phone: 'Phone', email: 'Email (optional)', message: 'Message (optional)',
    messagePh: 'Tell us how we can help', submit: 'Send', sending: 'Sending…',
    privacy: (name) => `Your details are passed to ${name || 'the business'} so they can get back to you, and are kept in the Pagey system it uses. Giving them is not mandatory.`,
    errGeneric: 'Sending failed. Please try again.', errInvalid: 'Please check your details and try again.',
    errClosed: 'This page is not taking requests right now.', errTooMany: 'Too many submissions in a short time. Please try again later.',
  },
  legal: {
    toggle: 'Terms of use and accessibility',
    termsTitle: 'Terms of use',
    terms: (n) => [
      `This page is operated by ${n} and is meant to give information about the business and to contact it. The information shown on the page, including descriptions of services, prices, opening hours and availability, is provided as is and may change from time to time. It is not a binding offer, professional advice or a commitment to provide a service, and should not be relied on instead of checking directly with ${n}.`,
      `Contacting the business through the contact form or the contact details on the page means you agree that ${n} may use the details you gave in order to get back to you and answer your request. Do not enter sensitive information in the form that is not needed for your request.`,
      `Links to external sites or pages, where the page has any, are provided for your convenience only. ${n} has no control over their content and is not responsible for it. The content of the page, including texts, images, logo and trademarks, is for the use of ${n}; it may not be copied or used commercially without permission. The use of the page is governed by the laws of the State of Israel.`,
    ],
    accTitle: 'Accessibility statement',
    acc: (n) => [
      `${n} considers it important to serve the whole public, including people with disabilities, and works to improve the accessibility of this page in accordance with the Israeli Equal Rights for Persons with Disabilities Law, 5758-1998, and the regulations made under it.`,
      'The page is built on a framework that supports accessibility: content in English, read from left to right (a Hebrew version is also available), a semantic heading structure, labelled form fields, alternative text for images, keyboard navigation and a display adapted to different screen sizes and to browser zoom. However, the page has not yet had an external accessibility audit and does not claim full compliance with Israeli Standard SI 5568; some parts may not be fully accessible.',
    ],
    accContactLead: 'Having trouble using this page? Please contact us and we will work to fix it.',
    contactPhone: 'Phone', contactEmail: 'Email', contactForm: 'through the contact form on this page', address: 'Address',
    responsibility: (n) => `Responsibility for the content of the page and its accessibility lies with ${n}, which operates the page.`,
    defaultName: 'the business',
  },
};

export const PAGE_STRINGS: Partial<Record<LangCode, PageStrings>> = { he: HE, fr: FR, en: EN };

/** The words for a page language; Hebrew when a language has no entry yet. */
export function pageStrings(lang: string | null | undefined): PageStrings {
  return PAGE_STRINGS[(lang ?? 'he') as LangCode] ?? HE;
}
