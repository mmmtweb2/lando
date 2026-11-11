// env.ts must be the first import so dotenv.config() runs before any other
// module reads process.env at initialization time.
import './env';

import app from './app';
import { supabase } from './config/supabase';
import { startRenewalSweep } from './services/renewal.service';
import { startSubscriptionSweep } from './services/seoSubscription.service';
import { startDigestSweep } from './services/digest.service';
import { startSetupReminderSweep } from './services/setupReminder.service';
import { startReviewAlertSweep } from './services/reviewAlerts.service';
import { startPostsSweep } from './services/gbpPosts.service';
import { startReplySweep } from './services/autoReplies.service';
import { startHealthAlertSweep } from './services/adminHealth.service';
import { warnIfAuditSaltMissing } from './services/auditLeads.service';

const PORT = process.env.PORT ?? 3000;

async function start() {
  warnIfAuditSaltMissing();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const { error } = await supabase.from('landing_pages').select('*', { count: 'exact', head: true });
  if (error) {
    console.warn('DB warning:', error.message);
  } else {
    console.log('Database connection established');
  }

  // Annual page-renewal lifecycle: reminder emails, freeze after the grace
  // period, hard delete after the frozen-retention window. There is no cron in
  // this deployment, so the sweep is an interval owned by the web process —
  // see src/services/renewal.service.ts for why 6h and why that is safe.
  startRenewalSweep();
  // Monthly SEO subscription housekeeping (period ends, grace window). No-op without migration 030.
  startSubscriptionSweep();
  // Monthly summary email to customers. No-op unless MONTHLY_DIGEST_ENABLED=true (+ DIGEST_SECRET).
  startDigestSweep();
  // One reminder email to a customer who stopped mid-setup. No-op unless SETUP_REMINDER_ENABLED=true (+ DIGEST_SECRET).
  startSetupReminderSweep();
  startReviewAlertSweep();
  // The automatic product: weekly Google posts and replies to reviews. No-op unless AUTOPILOT_ENABLED=true.
  startPostsSweep();
  startReplySweep();
  startHealthAlertSweep();
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
