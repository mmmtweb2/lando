import { Request, Response } from 'express';
import { Resend } from 'resend';
import { supabase } from '../config/supabase';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Email template ───────────────────────────────────────────────────────────

function waLink(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  const intl = digits.startsWith('972') ? digits : `972${digits.replace(/^0/, '')}`;
  return `https://wa.me/${intl}`;
}

function buildEmailHtml(p: {
  businessName: string;
  name: string;
  phone: string;
  email: string | null;
  message: string | null;
}): string {
  const row = (label: string, value: string, ltr = false) => `
    <tr>
      <td style="padding:0 0 10px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:#f8fafc;border-radius:10px;padding:13px 16px;">
              <p style="margin:0;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">${label}</p>
              <p style="margin:5px 0 0;color:#1e293b;font-size:15px;font-weight:600;${ltr ? 'direction:ltr;text-align:right;' : ''}">${value}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;direction:rtl;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;background:#f1f5f9;">
  <tr><td align="center">
    <table width="540" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">

      <tr>
        <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:28px 32px;">
          <p style="margin:0;color:rgba(255,255,255,0.65);font-size:11px;letter-spacing:2px;text-transform:uppercase;">Pagey</p>
          <h1 style="margin:8px 0 4px;color:#fff;font-size:22px;font-weight:800;">🎉 ליד חדש!</h1>
          <p style="margin:0;color:rgba(255,255,255,0.85);font-size:14px;">פנייה חדשה התקבלה מדף הנחיתה של <strong>${escapeHtml(p.businessName)}</strong></p>
        </td>
      </tr>

      <tr>
        <td style="padding:28px 32px 8px;">
          <p style="margin:0 0 18px;color:#64748b;font-size:14px;">להלן פרטי הפונה — חזרו אליהם בהקדם:</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${row('שם מלא', escapeHtml(p.name))}
            ${row('טלפון', escapeHtml(p.phone), true)}
            ${p.email ? row('אימייל', escapeHtml(p.email), true) : ''}
            ${p.message ? row('הודעה', escapeHtml(p.message)) : ''}
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:0 32px 28px;text-align:center;">
          <a href="${waLink(p.phone)}"
             style="display:inline-block;background:#25D366;color:#fff;font-size:14px;font-weight:700;padding:13px 28px;border-radius:12px;text-decoration:none;">
            💬 פתחו שיחת WhatsApp
          </a>
        </td>
      </tr>

      <tr>
        <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 32px;">
          <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
            מופעל על ידי Pagey · דף הנחיתה של ${escapeHtml(p.businessName)}
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function submitLead(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { name, phone, email, message } = req.body as {
    name?: string;
    phone?: string;
    email?: string;
    message?: string;
  };

  if (!name?.trim() || !phone?.trim()) {
    res.status(400).json({ error: 'name and phone are required' });
    return;
  }

  const safeName    = name.trim();
  const safePhone   = phone.trim();
  const safeEmail   = email?.trim() || null;
  const safeMessage = message?.trim() || null;

  // 1. Persist lead
  const { data: lead, error: insertErr } = await supabase
    .from('leads')
    .insert({
      landing_page_id: id,
      name: safeName,
      phone: safePhone,
      email: safeEmail,
      message: safeMessage,
    })
    .select('id')
    .single();

  if (insertErr) {
    console.error('[LEAD] insert error:', insertErr.message);
    res.status(500).json({ error: 'שליחת הפנייה נכשלה. נסו שוב מאוחר יותר.' });
    return;
  }

  // 2. Fetch page metadata for the email
  const { data: page } = await supabase
    .from('landing_pages')
    .select('owner_email, business_name, page_goal')
    .eq('id', id)
    .single();

  // 3. Send email notification (fire-and-forget — never fail the response)
  if (page?.owner_email) {
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      try {
        const resend = new Resend(apiKey);
        await resend.emails.send({
          from: `Pagey <${process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'}>`,
          to: [page.owner_email],
          subject: `ליד חדש התקבל מדף הנחיתה של ${page.business_name}!`,
          html: buildEmailHtml({
            businessName: page.business_name as string,
            name: safeName,
            phone: safePhone,
            email: safeEmail,
            message: safeMessage,
          }),
        });
        console.log('[LEAD] Email sent to', page.owner_email);
      } catch (emailErr) {
        console.error('[LEAD] Email send failed (lead still saved):', emailErr);
      }
    } else {
      console.warn('[LEAD] RESEND_API_KEY not set — skipping email');
    }
  }

  res.status(201).json({ success: true, lead_id: (lead as { id: string }).id });
}
