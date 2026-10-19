import { Request, Response, NextFunction } from 'express';
import { hasProduct, ProductKey } from '../services/entitlements.service';

/**
 * Gate a route behind a paid product (user_products, migration 027).
 * Must run after requireAuth. Not applied to any existing route — Pagey's own
 * routes ('pagey_pages') are open to every account, exactly as before.
 *
 *   router.get('/x', requireAuth, requireProduct('seo_autopilot'), handler);
 */
export function requireProduct(product: ProductKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.authEmail) {
      res.status(401).json({ error: 'נדרשת התחברות.' });
      return;
    }
    if (!(await hasProduct(req.authEmail, product))) {
      res.status(403).json({ error: 'המוצר הזה אינו פעיל בחשבון שלך.', code: 'product_required', product });
      return;
    }
    next();
  };
}
