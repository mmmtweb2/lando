import { textDir } from '../lib/pageText';

/**
 * An owner-typed text (business name, customer name, file name) isolated from the sentence around it,
 * in the direction its own letters ask for (README part 150): "QA מאפיית בדיקה" stays in the typed order
 * inside a Hebrew sentence, and "Joe's Pizza" stays left-to-right.
 */
export function Bidi({ text, className }: { text: string; className?: string }) {
  return <bdi dir={textDir(text)} className={className}>{text}</bdi>;
}
