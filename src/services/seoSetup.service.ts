import { supabase } from '../config/supabase';

// Setup checklist ticks (migration 032). Only steps the customer does outside Pagey are stored
// here; the rest of the checklist is derived on the client from data we already have.

export const SETUP_KEYS = [
  'first_check', 'profile_details', 'profile_verified', 'review_link_shared', 'tracking_ready', 'phase2_ack',
] as const;
export type SetupKey = (typeof SETUP_KEYS)[number];

export function isSetupKey(v: unknown): v is SetupKey {
  return typeof v === 'string' && (SETUP_KEYS as readonly string[]).includes(v);
}

export class SetupError extends Error {
  constructor(public readonly code: 'not_migrated' | 'db', message: string) { super(message); }
}

function wrap(e: { code?: string; message: string }): SetupError {
  return e.code === '42P01' ? new SetupError('not_migrated', 'seo_setup_steps does not exist') : new SetupError('db', e.message);
}

export async function listSetup(email: string): Promise<SetupKey[]> {
  const { data, error } = await supabase.from('seo_setup_steps').select('step_key').eq('email', email);
  if (error) throw wrap(error);
  return ((data ?? []) as { step_key: string }[]).map((r) => r.step_key).filter(isSetupKey);
}

export async function setSetup(email: string, key: SetupKey, done: boolean): Promise<void> {
  if (done) {
    const { error } = await supabase.from('seo_setup_steps')
      .upsert({ email, step_key: key, done_at: new Date().toISOString() }, { onConflict: 'email,step_key' });
    if (error) throw wrap(error);
  } else {
    const { error } = await supabase.from('seo_setup_steps').delete().eq('email', email).eq('step_key', key);
    if (error) throw wrap(error);
  }
}
