import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GENERIC_ERROR } from '../autopilotCopy';
import { ApiError, sampleApi, serverApi, type AutopilotApi } from './api';
import type { Activity, Automation, AutomationPatch, GbpStatus, GoogleNumbers, LandingState, Loadable, Phrases, Post, PublishState, Truth, TruthPatch } from './types';

// One place that loads the automatic product's data for the dashboard: the business card, the
// Google connection, the automation choices, the posts and the activity log. Each source loads and
// fails on its own, so a failing one shows its own message and the rest of the screen stays usable.
// Actions return null on success, or the sentence to show (the server's Hebrew `error` when it sent one).

const LOADING = { status: 'loading' } as const;
const msg = (e: unknown) => (e instanceof ApiError ? e.message : GENERIC_ERROR);

export interface Autopilot {
  preview: boolean;
  truth: Loadable<Truth | null>;
  /** the server said this part is not switched on yet */
  notReady: boolean;
  gbp: GbpStatus | null;
  automation: Loadable<Automation>;
  posts: Loadable<Post[]>;
  activity: Loadable<Activity[]>;
  /** grows every time the card arrives from the server: forms re-read their fields */
  truthVersion: number;
  syncing: boolean;
  reload: () => void;
  sync: () => Promise<string | null>;
  save: (patch: TruthPatch) => Promise<string | null>;
  approve: () => Promise<string | null>;
  setAutomation: (patch: AutomationPatch) => Promise<string | null>;
  editPost: (id: string, text: string) => Promise<string | null>;
  publishPost: (id: string) => Promise<string | null>;
  skipPost: (id: string) => Promise<string | null>;
  /** "צרו לי דף נחיתה". Kept here, above the screens, so a request in flight survives moving between them. */
  landing: LandingState;
  createLanding: () => void;
  /** Search-phrase pages. Loaded when "הדף והחיפושים שלכם" asks for them, not with every dashboard load. */
  phrases: Loadable<Phrases> | null;
  loadPhrases: () => void;
  /** the phrase whose page is being written right now (one at a time) */
  phraseBusy: string | null;
  /** null = created; a sentence = it failed; false = ignored, because another page is being written */
  createPhrase: (phrase: string) => Promise<string | null | false>;
  /** calls and direction requests from the Google listing, last 30 days; null when there are none to show */
  numbers: GoogleNumbers | null;
  /** "פרסמו את הדף". Kept here so a page published a moment ago stays published when moving between screens. */
  publish: PublishState;
  publishPage: (id: string) => void;
  /** Does the subscription cover publishing this draft? Throws the sentence to show when the check itself failed. */
  checkIncluded: (id: string) => Promise<boolean>;
  /** Sends the browser to Google to connect the listing. Returns the sentence to show when it could not start. */
  connectGoogle: () => Promise<string | null>;
}

// Google's numbers change once a day, and every read costs a call to Google: keep them for the visit.
const NUM_KEY = 'pagey_gnum';
const NUM_TTL = 30 * 60_000;
function cachedNumbers(): GoogleNumbers | null {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(NUM_KEY) ?? 'null') as { at?: number; n?: GoogleNumbers } | null;
    return v && typeof v.at === 'number' && Date.now() - v.at < NUM_TTL && v.n ? v.n : null;
  } catch { return null; }
}

export function useAutopilot(preview: boolean): Autopilot {
  const api: AutopilotApi = useMemo(() => (preview ? sampleApi() : serverApi), [preview]);
  const [truth, setTruth] = useState<Loadable<Truth | null>>(LOADING);
  const [notReady, setNotReady] = useState(false);
  const [gbp, setGbp] = useState<GbpStatus | null>(null);
  const [automation, setAuto] = useState<Loadable<Automation>>(LOADING);
  const [posts, setPosts] = useState<Loadable<Post[]>>(LOADING);
  const [activity, setActivity] = useState<Loadable<Activity[]>>(LOADING);
  const [truthVersion, setVersion] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [tick, setTick] = useState(0);
  const [landing, setLanding] = useState<LandingState>({ phase: 'idle' });
  const landingBusy = useRef(false);
  const [phrases, setPhrases] = useState<Loadable<Phrases> | null>(null);
  const [phraseBusy, setPhraseBusy] = useState<string | null>(null);
  const phraseLock = useRef(false);
  const [numbers, setNumbers] = useState<GoogleNumbers | null>(null);
  const [publish, setPublish] = useState<PublishState>({ phase: 'idle' });
  const publishBusy = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const gotTruth = useCallback((t: Truth | null) => { setTruth({ status: 'ok', data: t }); setVersion((v) => v + 1); }, []);

  const loadPosts = useCallback(async () => {
    try { const p = await api.posts(); if (alive.current) setPosts({ status: 'ok', data: p }); }
    catch (e) { if (alive.current) setPosts({ status: 'error', error: msg(e) }); }
  }, [api]);
  const loadActivity = useCallback(async () => {
    try { const a = await api.activity(); if (alive.current) setActivity({ status: 'ok', data: a }); }
    catch (e) { if (alive.current) setActivity({ status: 'error', error: msg(e) }); }
  }, [api]);
  const loadAutomation = useCallback(async () => {
    try { const a = await api.automation(); if (alive.current) setAuto({ status: 'ok', data: a }); }
    catch (e) { if (alive.current) setAuto({ status: 'error', error: msg(e) }); }
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [t, g] = await Promise.all([
        api.truth().then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, error: msg(e) })),
        api.gbp(),
      ]);
      if (cancelled) return;
      setGbp(g);
      if (g.enabled && g.connected && !g.needsReconnect) {
        const had = preview ? null : cachedNumbers();
        if (had) setNumbers(had);
        else void api.googleNumbers().then((n) => {
          if (cancelled) return;
          setNumbers(n);
          if (n && !preview) { try { window.sessionStorage.setItem(NUM_KEY, JSON.stringify({ at: Date.now(), n })); } catch { /* not kept */ } }
        });
      }
      if (t.ok) { setNotReady(t.v.notReady); gotTruth(t.v.truth); } else setTruth({ status: 'error', error: t.error });
    })();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- these only set state after their request settles
    void loadAutomation(); void loadPosts(); void loadActivity();
    return () => { cancelled = true; };
  }, [api, preview, tick, gotTruth, loadAutomation, loadPosts, loadActivity]);

  const reload = useCallback(() => {
    setTruth(LOADING); setAuto(LOADING); setPosts(LOADING); setActivity(LOADING); setTick((n) => n + 1);
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try { gotTruth(await api.sync()); void loadActivity(); return null; }
    catch (e) { return msg(e); }
    finally { if (alive.current) setSyncing(false); }
  }, [api, gotTruth, loadActivity]);

  const save = useCallback(async (patch: TruthPatch) => {
    try { gotTruth(await api.save(patch)); return null; } catch (e) { return msg(e); }
  }, [api, gotTruth]);

  const approve = useCallback(async () => {
    try {
      gotTruth(await api.approve());
      void loadAutomation(); void loadActivity(); void loadPosts();
      return null;
    } catch (e) { return msg(e); }
  }, [api, gotTruth, loadAutomation, loadActivity, loadPosts]);

  const setAutomation = useCallback(async (patch: AutomationPatch) => {
    try { const a = await api.setAutomation(patch); setAuto({ status: 'ok', data: a }); return null; } catch (e) { return msg(e); }
  }, [api]);

  const postAction = useCallback(async (run: () => Promise<void>) => {
    try { await run(); await Promise.all([loadPosts(), loadActivity()]); return null; }
    catch (e) { void loadPosts(); return msg(e); }
  }, [loadPosts, loadActivity]);
  const editPost = useCallback((id: string, text: string) => postAction(() => api.editPost(id, text)), [api, postAction]);
  const publishPost = useCallback((id: string) => postAction(() => api.publishPost(id)), [api, postAction]);
  const skipPost = useCallback((id: string) => postAction(() => api.skipPost(id)), [api, postAction]);

  // One request at a time: the ref closes the gap between two fast presses and the next render.
  const createLanding = useCallback(() => {
    if (landingBusy.current) return;
    landingBusy.current = true;
    setLanding({ phase: 'busy' });
    api.createLanding().then(
      (page) => { if (alive.current) { setLanding({ phase: 'done', page }); setPhrases(null); if (!page.existing) void loadActivity(); } },
      (e: unknown) => { if (alive.current) setLanding({ phase: 'error', error: msg(e) }); },
    ).finally(() => { landingBusy.current = false; });
  }, [api, loadActivity]);

  // One request at a time. A 402 never opens a payment here: the screen shows the sentence and a link to the page.
  const publishPage = useCallback((id: string) => {
    if (publishBusy.current) return;
    publishBusy.current = true;
    setPublish({ phase: 'busy', id });
    api.publishLanding(id).then(
      (r) => {
        if (!alive.current) return;
        if (!r.ok) { setPublish({ phase: 'payment', id, error: r.error }); return; }
        setPublish({ phase: 'done', id, slug: r.slug, url: r.url });
        setPhrases(null); void loadActivity();
      },
      (e: unknown) => { if (alive.current) setPublish({ phase: 'error', id, error: msg(e) }); },
    ).finally(() => { publishBusy.current = false; });
  }, [api, loadActivity]);

  const checkIncluded = useCallback((id: string) => api.included(id), [api]);

  const connectGoogle = useCallback(async () => {
    try { window.location.href = await api.connectUrl(); return null; } catch (e) { return msg(e); }
  }, [api]);

  const loadPhrases = useCallback(() => {
    setPhrases((p) => (p && p.status === 'ok' ? p : LOADING));
    api.phrases().then(
      (data) => { if (alive.current) setPhrases({ status: 'ok', data }); },
      (e: unknown) => { if (alive.current) setPhrases({ status: 'error', error: msg(e) }); },
    );
  }, [api]);

  // One page at a time, and a second press while one is being written does nothing.
  const createPhrase = useCallback(async (phrase: string) => {
    if (phraseLock.current) return false;
    phraseLock.current = true;
    setPhraseBusy(phrase);
    try {
      await api.createPhrase(phrase);
      loadPhrases(); void loadActivity();
      return null;
    } catch (e) {
      // "exists", "too similar", "limit": the list we show is stale, so read it again
      if (e instanceof ApiError && e.code && e.code !== 'no_page') loadPhrases();
      return msg(e);
    } finally {
      phraseLock.current = false;
      if (alive.current) setPhraseBusy(null);
    }
  }, [api, loadPhrases, loadActivity]);

  return { publish, publishPage, checkIncluded, connectGoogle, phrases, loadPhrases, phraseBusy, createPhrase, numbers, preview, truth, notReady, gbp, automation, posts, activity, truthVersion, syncing, reload, sync, save, approve, setAutomation, editPost, publishPost, skipPost, landing, createLanding };
}
