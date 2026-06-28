// env.ts must be the first import so dotenv.config() runs before any other
// module reads process.env at initialization time.
import './env';

import app from './app';
import { supabase } from './config/supabase';

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
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
