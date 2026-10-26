// Marketing events for GTM / Pixel (task #1). Pushes to window.dataLayer; harmless when no
// tag manager is installed. Never put personal data (name, phone) in an event.

declare global { interface Window { dataLayer?: Array<Record<string, unknown>> } }

export function trackEvent(event: string, data: Record<string, unknown> = {}): void {
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event, ...data });
  } catch { /* tracking must never break the page */ }
}
