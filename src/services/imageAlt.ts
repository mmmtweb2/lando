// Alt text for a customer's photo (accessibility law + how Google understands an image): one short Hebrew
// sentence written by a small vision model at upload time, stored next to the photo.
//
// Never blocks and never throws: no key, a slow call or an unusable answer all end in the plain
// contextual sentence from landingImages.fallbackAlt().
import Anthropic from '@anthropic-ai/sdk';
import { fallbackAlt, sanitizeAlt } from './landingImages';

export const ALT_MODEL = 'claude-haiku-4-5';
const ALT_TIMEOUT_MS = 9000;

const SYSTEM = [
  'אתם כותבים טקסט חלופי (alt) לתמונה בדף נחיתה של עסק בישראל.',
  'כללים: משפט אחד בעברית, עד 12 מילים. תארו רק את מה שרואים בתמונה, ואם זה מתאים ציינו את סוג העסק.',
  'בלי מילות שיווק ושבח, בלי להתחיל ב"תמונה של", בלי להמציא פרטים שלא נראים (שמות, מחירים, מספרים), בלי גרשיים.',
  'החזירו רק את המשפט.',
].join('\n');

type Client = { messages: { create: (args: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> } };

export async function generatePhotoAlt(
  jpeg: Buffer,
  ctx: { businessName: string },
  deps: { client?: Client | null; timeoutMs?: number } = {},
): Promise<string> {
  const fallback = fallbackAlt(ctx.businessName);
  let client: Client | null | undefined = deps.client;
  if (client === undefined) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    client = apiKey ? (new Anthropic({ apiKey }) as unknown as Client) : null;
  }
  if (!client) return fallback;

  try {
    const call = client.messages.create({
      model: ALT_MODEL,
      max_tokens: 60,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
          { type: 'text', text: `העסק: ${ctx.businessName || '(לא צוין)'}\nכתבו את הטקסט החלופי לתמונה.` },
        ],
      }],
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('alt timeout')), deps.timeoutMs ?? ALT_TIMEOUT_MS); });
    try {
      const r = await Promise.race([call, timeout]);
      const block = r.content.find((b) => b.type === 'text');
      return sanitizeAlt(block && block.type === 'text' ? block.text : '', fallback);
    } finally {
      if (timer) clearTimeout(timer);
      call.catch(() => undefined);   // a late failure after the timeout must not surface as an unhandled rejection
    }
  } catch (err) {
    console.warn('[IMAGE] alt text failed, using the plain sentence:', (err as Error)?.message ?? err);
    return fallback;
  }
}
