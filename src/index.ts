// env.ts must be the first import so dotenv.config() runs before any other
// module reads process.env at initialization time.
import './env';

import app from './app';
import { supabase } from './config/supabase';
import { startRenewalSweep } from './services/renewal.service';

const PORT = process.env.PORT ?? 3000;

async function start() {
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
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
