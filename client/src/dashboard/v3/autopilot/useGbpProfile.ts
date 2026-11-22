// Loads "הכרטיס שלכם בגוגל" and its photos, and runs the actions. The profile and the photos load
// and fail on their own, like the rest of the dashboard.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GENERIC_ERROR } from '../autopilotCopy';
import { ProfileError, sampleProfileApi, serverProfileApi, type ProfileApi } from './profileApi';
import type { FieldKey, FieldValues, GbpPhoto, GbpProfile, PhotoCategory, PolishField, PolishRequest, PolishResult, SaveResult } from './profileTypes';
import type { Loadable } from './types';

const msg = (e: unknown) => (e instanceof ProfileError ? e.message : GENERIC_ERROR);

export interface GbpProfileState {
  /** the preview's sample data (no server) */
  preview: boolean;
  profile: Loadable<GbpProfile>;
  photos: Loadable<GbpPhoto[]>;
  reload: () => void;
  save: <K extends FieldKey>(field: K, value: FieldValues[K]) => Promise<SaveResult>;
  resolve: (field: FieldKey, keep: 'google' | 'ours') => Promise<SaveResult>;
  /** null on success, or the sentence to show */
  acceptWebsite: () => Promise<string | null>;
  /** an error sentence, or { small } after a successful upload */
  upload: (file: File, category: PhotoCategory, onProgress: (p: number) => void) => Promise<{ error: string } | { small: boolean }>;
  addFromPage: (url: string, category: PhotoCategory) => Promise<{ error: string } | { small: boolean }>;
  removePhoto: (id: string) => Promise<string | null>;
  /** "שיפור הניסוח": one suggestion; nothing is saved until the owner accepts (then `save`). */
  polish: <F extends PolishField>(field: F, req: PolishRequest<F>) => Promise<PolishResult>;
}

const apiFor = (preview: boolean): ProfileApi => (preview ? sampleProfileApi() : serverProfileApi);

export function useGbpProfile(preview: boolean, enabled = true): GbpProfileState {
  const api = useMemo(() => apiFor(preview), [preview]);
  const [profile, setProfile] = useState<Loadable<GbpProfile>>({ status: 'loading' });
  const [photos, setPhotos] = useState<Loadable<GbpPhoto[]>>({ status: 'loading' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setProfile({ status: 'loading' }); setPhotos({ status: 'loading' });
    api.profile().then((d) => alive && setProfile({ status: 'ok', data: d }), (e) => alive && setProfile({ status: 'error', error: msg(e) }));
    api.photos().then((d) => alive && setPhotos({ status: 'ok', data: d }), (e) => alive && setPhotos({ status: 'error', error: msg(e) }));
    return () => { alive = false; };
  }, [api, enabled, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const refreshPhotos = useCallback(() => {
    api.photos().then((d) => setPhotos({ status: 'ok', data: d }), () => undefined);
  }, [api]);

  const apply = useCallback((field: FieldKey, r: SaveResult) => {
    if (r.ok) setProfile((p) => (p.status === 'ok' ? { status: 'ok', data: { ...p.data, fields: { ...p.data.fields, [field]: r.field } } } : p));
    return r;
  }, []);

  const save = useCallback(async <K extends FieldKey>(field: K, value: FieldValues[K]): Promise<SaveResult> => {
    try { return apply(field, await api.save(field, value)); } catch (e) { return { ok: false, code: 'error', message: msg(e) }; }
  }, [api, apply]);
  const resolve = useCallback(async (field: FieldKey, keep: 'google' | 'ours'): Promise<SaveResult> => {
    try { return apply(field, await api.resolve(field, keep)); } catch (e) { return { ok: false, code: 'error', message: msg(e) }; }
  }, [api, apply]);
  const acceptWebsite = useCallback(async () => {
    try { await api.acceptWebsite(); reload(); return null; } catch (e) { return msg(e); }
  }, [api, reload]);
  const upload = useCallback(async (file: File, category: PhotoCategory, onProgress: (p: number) => void) => {
    try { const r = await api.upload(file, category, onProgress); refreshPhotos(); return r; } catch (e) { return { error: msg(e) }; }
  }, [api, refreshPhotos]);
  const addFromPage = useCallback(async (url: string, category: PhotoCategory) => {
    try { const r = await api.addFromPage(url, category); refreshPhotos(); return r; } catch (e) { return { error: msg(e) }; }
  }, [api, refreshPhotos]);
  const removePhoto = useCallback(async (id: string) => {
    try {
      await api.remove(id);
      setPhotos((p) => (p.status === 'ok' ? { status: 'ok', data: p.data.filter((x) => x.id !== id) } : p));
      return null;
    } catch (e) { return msg(e); }
  }, [api]);

  const polish = useCallback(<F extends PolishField>(field: F, req: PolishRequest<F>): Promise<PolishResult> => (
    api.polish(field, req).catch((e: unknown): PolishResult => ({ ok: false, code: 'error', message: msg(e) }))
  ), [api]);

  return { preview, profile, photos, reload, save, resolve, acceptWebsite, upload, addFromPage, removePhoto, polish };
}

/**
 * For the home: only the website suggestion. One read when the business details are approved;
 * a failure simply shows nothing.
 */
export function useWebsiteSuggestion(preview: boolean, enabled: boolean): { suggestion: GbpProfile['websiteSuggestion']; accept: () => Promise<string | null> } {
  const api = useMemo(() => apiFor(preview), [preview]);
  const [suggestion, setSuggestion] = useState<GbpProfile['websiteSuggestion']>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api.profile().then((p) => alive && setSuggestion(p.websiteSuggestion), () => undefined);
    return () => { alive = false; };
  }, [api, enabled]);
  const accept = useCallback(async () => {
    try { await api.acceptWebsite(); setSuggestion(null); return null; } catch (e) { return msg(e); }
  }, [api]);
  return { suggestion, accept };
}
