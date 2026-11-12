// Shapes of the automatic product's API (server: src/controllers/autopilot.controller.ts).

export type Day = 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY';
export interface TruthService { name: string; description: string; source?: 'google' | 'customer' }
export interface TruthHours { day: Day; open: string; close: string }
export interface TruthCard {
  name: string; phone: string; website: string; address: string; city: string;
  category: string; categories: string[];
  description: string;
  services: TruthService[];
  areas: string[];
  hours: TruthHours[];
  open: boolean;
  notes: string;
  /** Google's own link for writing a review of the listing; empty until the listing was read */
  reviewUrl?: string;
}
export type CheckState = 'ok' | 'weak' | 'missing';
export interface ReadinessCheck { key: string; state: CheckState; required: boolean; title: string; why: string }
export interface Readiness { checks: ReadinessCheck[]; ready: boolean; done: number; total: number }
export interface Truth { card: TruthCard; readiness: Readiness; fetchedAt: string | null; approvedAt: string | null }

/** The fields the customer may change here. A save sends only the ones that changed. */
export type TruthPatch = Partial<Pick<TruthCard, 'phone' | 'website' | 'description' | 'notes' | 'areas'>> & { services?: { name: string; description: string }[] };

export type PostsMode = 'auto' | 'approve' | 'off';
export type RepliesMode = 'auto_positive' | 'approve' | 'off';
export interface Automation { postsMode: PostsMode; repliesMode: RepliesMode; consentAt: string | null; live: boolean; editWindowHours: number }
export type AutomationPatch = { postsMode?: PostsMode; repliesMode?: RepliesMode };

export interface Post {
  id: string; topic: string; body: string;
  status: 'scheduled' | 'published' | 'skipped' | 'failed';
  edited: boolean; publishAfter: string; publishedAt: string | null; createdAt: string;
  /** when it will really go out by itself (never on Shabbat or at night); absent on an older server, null once it is not waiting */
  expectedAt?: string | null;
  problem: null | 'quota_pending' | 'failed';
}

export type ActivityKind = 'card_synced' | 'card_approved' | 'post_planned' | 'post_published' | 'post_skipped' | 'reply_published' | 'reply_drafted' | 'page_created';
export interface Activity { id: string; kind: ActivityKind | (string & {}); title: string; detail: string | null; createdAt: string }

export interface GbpStatus { enabled: boolean; connected: boolean; needsReconnect: boolean }

/** One fetch: still loading, failed (with the sentence to show), or here. */
export type Loadable<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ok'; data: T };

export type AutoScreen = 'card' | 'automation';

/** GET /api/seo/truth/phrases: the search-phrase pages that exist, what we offer next, and how many are left. */
export interface PhrasePage { id: string; phrase: string | null; title: string | null; url: string }
export interface PhraseIdea { phrase: string; service: string; area: string }
export interface Phrases { hasPage: boolean; parentPublished: boolean; pages: PhrasePage[]; ideas: PhraseIdea[]; cap: number; left: number }

/** Clicks from the Google listing in the last 30 days (GET /api/seo/gbp/stats); null when Google has nothing to give. */
export interface GoogleNumbers { calls: number; directions: number }

/** "צרו לי דף נחיתה" (POST /api/seo/truth/landing): the new draft, or the page the account already has. */
export type PageStatus = 'draft' | 'published' | 'frozen';
export interface LandingResult { existing: boolean; id: string; slug: string; status: PageStatus | (string & {}) }
/** POST /api/landing/:id/publish from "הדף והחיפושים שלכם": never starts a payment. */
export type PublishState =
  | { phase: 'idle' }
  | { phase: 'busy'; id: string }
  | { phase: 'done'; id: string; slug: string; url: string }
  /** 402: the server's sentence, and the purchase lives on the page itself */
  | { phase: 'payment'; id: string; error: string }
  | { phase: 'error'; id: string; error: string };
export type PublishResult = { ok: true; slug: string; url: string } | { ok: false; needsPayment: true; error: string };
export type LandingState = { phase: 'idle' } | { phase: 'busy' } | { phase: 'done'; page: LandingResult } | { phase: 'error'; error: string };
