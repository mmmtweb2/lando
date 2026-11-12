import { FileText, Mail, MapPin, MessageCircle, Phone, type LucideIcon } from 'lucide-react';
import type { LeadsSummary } from '../../../components/LeadsTable';
import { HOME } from '../autopilotCopy';
import type { GoogleNumbers } from './types';

// The month's numbers on the promotion home. Pure.

export interface HomeNumbers { total: number; tiles: { key: string; label: string; value: number; Icon: LucideIcon }[]; note: string }

/**
 * What came through our links this month, plus calls and direction requests from the Google
 * listing when Google gives them (its numbers cover the last 30 days; the note under the tiles
 * says so). The hero's one number is always the sum of the four tiles that are shown.
 */
export function homeNumbers(s: LeadsSummary, g: GoogleNumbers | null): HomeNumbers {
  const tiles = [
    { key: 'calls', label: HOME.numCalls, value: s.month_call + (g?.calls ?? 0), Icon: Phone },
    { key: 'wa', label: HOME.numWhatsapp, value: s.month_whatsapp, Icon: MessageCircle },
    { key: 'forms', label: HOME.numForms, value: s.month_form, Icon: FileText },
    g ? { key: 'dir', label: HOME.numDirections, value: g.directions, Icon: MapPin } : { key: 'mail', label: HOME.numEmail, value: s.month_email, Icon: Mail },
  ];
  return { total: tiles.reduce((n, t) => n + t.value, 0), tiles, note: g ? HOME.numbersNote : HOME.numbersNoteOwn };
}
