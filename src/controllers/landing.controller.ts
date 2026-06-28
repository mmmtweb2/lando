import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { generateAiContent, regenerateSectionText, type AiContent } from '../services/ai.service';
import { processAndSave, generateFalImage } from '../services/image.service';
import { processMockPayment } from '../services/payment.service';
import { checkAndDeductCredits } from '../services/credits.service';

export async function getAllLandingPages(_req: Request, res: Response): Promise<void> {
  const { data, error } = await supabase
    .from('landing_pages')
    .select('id, slug, business_name, created_at, image_source, logo_url, enable_form, status')
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json(data);
}

export async function getMyPages(req: Request, res: Response): Promise<void> {
  const { email } = req.query as { email?: string };

  if (!email) {
    res.status(400).json({ error: 'email query param required' });
    return;
  }

  const { data, error } = await supabase
    .from('landing_pages')
    .select('id, slug, business_name, created_at, logo_url, image_source, status')
    .eq('owner_email', email.trim().toLowerCase())
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json(data ?? []);
}

export async function updateLandingPage(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { ai_content } = req.body as { ai_content?: unknown };

  if (!ai_content) {
    res.status(400).json({ error: 'ai_content is required' });
    return;
  }

  const { data, error } = await supabase
    .from('landing_pages')
    .update({ ai_content })
    .eq('id', id)
    .select('id, slug, business_name, ai_content')
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json(data);
}

export async function deleteLandingPage(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const { error } = await supabase
    .from('landing_pages')
    .delete()
    .eq('id', id);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(204).send();
}

export async function getLandingPage(req: Request, res: Response): Promise<void> {
  const { slug } = req.params;

  const { data, error } = await supabase
    .from('landing_pages')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error || !data) {
    res.status(404).json({ error: 'Landing page not found' });
    return;
  }

  res.json(data);
}

const VALID_IMAGE_SOURCES = ['none', 'upload', 'stock', 'ai'] as const;
type ImageSource = (typeof VALID_IMAGE_SOURCES)[number];

function generateSlug(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(randomBytes(7))
    .map((b) => chars[b % 36])
    .join('');
}

export async function createLandingPage(req: Request, res: Response): Promise<void> {
  console.log('=== NEW REQUEST TO /api/landing ===');
  console.log('req.body:', req.body);
  console.log('req.files:', req.files);

  try {
    const files = req.files as {
      logo?: Express.Multer.File[];
      user_images?: Express.Multer.File[];
    };

    const {
      business_name,
      phone_number,
      vibe,
      image_source = 'none',
      email,
      address,
      about_business,
      user_provided_text,
      design_style,
      facebook_url,
      instagram_url,
      enable_form,
      owner_email,
      page_goal,
      external_link,
      primary_color,
      secondary_color,
      auto_extract_colors,
      include_testimonials,
    } = req.body as {
      business_name?: string;
      phone_number?: string;
      vibe?: string;
      image_source?: ImageSource;
      email?: string;
      address?: string;
      about_business?: string;
      user_provided_text?: string;
      design_style?: string;
      facebook_url?: string;
      instagram_url?: string;
      enable_form?: string;
      owner_email?: string;
      page_goal?: string;
      external_link?: string;
      primary_color?: string;
      secondary_color?: string;
      auto_extract_colors?: string;
      include_testimonials?: string;
    };

    if (!business_name || !phone_number || !vibe) {
      res.status(400).json({ error: 'business_name, phone_number, and vibe are required' });
      return;
    }

    console.log('[LANDING] image_source received:', image_source);
    console.log('[LANDING] owner_email received:', owner_email ?? '(none)');

    if (!VALID_IMAGE_SOURCES.includes(image_source as ImageSource)) {
      res.status(400).json({ error: `image_source must be one of: ${VALID_IMAGE_SOURCES.join(', ')}` });
      return;
    }

    // Safe null coercion — undefined is rejected by pg; explicit null is required
    const safeEmail = email || null;
    const safeAddress = address || null;
    const safeAbout = about_business || null;
    const safeUserText = user_provided_text || null;
    const safeDesignStyle   = design_style   || null;
    const safeFacebookUrl   = facebook_url   || null;
    const safeInstagramUrl  = instagram_url  || null;
    const safeEnableForm    = enable_form === 'true';
    const safeOwnerEmail     = owner_email ? owner_email.trim().toLowerCase() : null;
    const safeExternalLink   = external_link?.trim() || null;
    const safePageGoal       = page_goal || null;
    const safeAutoExtract         = auto_extract_colors === 'true';
    const safeIncludeTestimonials = include_testimonials === 'true';
    const safePrimaryColor   = /^#[0-9a-fA-F]{6}$/.test(primary_color ?? '') ? primary_color : undefined;
    const safeSecondaryColor = /^#[0-9a-fA-F]{6}$/.test(secondary_color ?? '') ? secondary_color : undefined;

    // ── AI image credit gate ───────────────────────────────────────────────
    let aiUserProfile: { ai_image_credits: number; is_admin: boolean } | null = null;

    if (image_source === 'ai') {
      console.log('[LANDING] AI image requested — checking credit gate for:', safeOwnerEmail);

      if (!safeOwnerEmail) {
        console.log('[LANDING] Credit gate BLOCKED — no owner_email');
        res.status(403).json({ error: 'Must be logged in to use AI image generation' });
        return;
      }

      const { data: profile, error: profileErr } = await supabase
        .from('user_profiles')
        .select('ai_image_credits, is_admin')
        .eq('email', safeOwnerEmail)
        .single();

      console.log('[LANDING] Profile lookup result:', profile, '| error:', profileErr?.message ?? null);

      if (!profile) {
        console.log('[LANDING] Credit gate BLOCKED — profile not found');
        res.status(403).json({ error: 'User profile not found' });
        return;
      }

      if (!profile.is_admin && (profile.ai_image_credits ?? 0) <= 0) {
        console.log('[LANDING] Credit gate BLOCKED — insufficient credits:', profile.ai_image_credits);
        res.status(403).json({ error: 'Insufficient AI credits' });
        return;
      }

      console.log('[LANDING] Credit gate PASSED — is_admin:', profile.is_admin, '| credits:', profile.ai_image_credits);
      aiUserProfile = profile;
    }

    try {
      // 1. Logo — always processed immediately, independent of image_source
      const logo_url = files?.logo?.[0]
        ? await processAndSave(files.logo[0].buffer, 300, 'logo')
        : null;

      // 2. Uploaded user images via sharp — resolved before the AI call
      let uploadedImageUrls: string[] = [];
      if (image_source === 'upload' && files?.user_images?.length) {
        uploadedImageUrls = await Promise.all(
          files.user_images.map((f) => processAndSave(f.buffer, 1200, 'image')),
        );
      }

      const slug = generateSlug();

      // 3. AI content — 2-step prompt chain (copywriter → mapping)
      const aiInput: Parameters<typeof generateAiContent>[0] = {
        business_name,
        phone_number,
        email: safeEmail ?? undefined,
        address: safeAddress ?? undefined,
        vibe,
        design_style: safeDesignStyle ?? undefined,
        image_source,
        about_business: safeAbout ?? undefined,
        user_provided_text: safeUserText ?? undefined,
        page_goal: page_goal || undefined,
        primary_color: safePrimaryColor,
        secondary_color: safeSecondaryColor,
        auto_extract_colors: safeAutoExtract,
        include_testimonials: safeIncludeTestimonials,
      };
      // Pass raw logo buffer for vision-based color extraction when requested
      if (safeAutoExtract && files?.logo?.[0]) {
        aiInput.logo_base64 = files.logo[0].buffer.toString('base64');
        aiInput.logo_media_type = files.logo[0].mimetype;
      }
      const ai_content = await generateAiContent(aiInput);

      // serializedImages holds the final JSON written to user_images column.
      // AI format: { hero_image_url, icon_urls } — decoded by LandingViewer as object.
      // Upload/Stock format: string[]              — decoded by LandingViewer as array.
      let serializedImages: string | null = null;

      // 4a. AI images — targeted parallel generation using prompts from ai_content
      if (image_source === 'ai') {
        const heroPrompt = ai_content.hero?.hero_image_prompt;
        const serviceItems = ai_content.services_or_benefits ?? [];
        const primaryColorHex = ai_content.design_system?.primary_color ?? '#4f46e5';
        const serviceImagePrompts = serviceItems
          .slice(0, Math.min(serviceItems.length, 3))
          .map((s) => {
            const keyword = s.service_icon_keyword ?? s.title;
            return `A sleek, modern 3D icon of ${keyword}, glassmorphism style, minimalist UI asset, vibrant lighting, solid clean background matching hex ${primaryColorHex}. No text.`;
          });

        console.log('[LANDING] Fal.ai batch — hero prompt:', !!heroPrompt, '| service prompts:', serviceImagePrompts.length);

        // Run all in parallel; individual failures don't abort the batch
        const settled = await Promise.allSettled([
          heroPrompt ? generateFalImage(heroPrompt, 'landscape_4_3') : Promise.resolve(null),
          ...serviceImagePrompts.map((p) => generateFalImage(p, 'landscape_4_3')),
        ]);

        const heroResult = settled[0];
        const iconResults = settled.slice(1);

        const hero_image_url =
          heroResult.status === 'fulfilled' ? heroResult.value : null;
        const icon_urls = iconResults
          .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
          .map((r) => r.value);

        // Log any failures for debugging
        settled.forEach((r, i) => {
          if (r.status === 'rejected') {
            console.error(`[LANDING] Fal.ai slot ${i} failed:`, r.reason);
          }
        });

        console.log('[LANDING] Fal.ai done — hero:', !!hero_image_url, '| service images:', icon_urls.length);

        if (hero_image_url || icon_urls.length > 0) {
          serializedImages = JSON.stringify({ hero_image_url, icon_urls });
        }

        // Deduct 1 credit per batch (regardless of how many images were generated)
        if (aiUserProfile && !aiUserProfile.is_admin && safeOwnerEmail) {
          await supabase
            .from('user_profiles')
            .update({ ai_image_credits: Math.max(0, aiUserProfile.ai_image_credits - 1) })
            .eq('email', safeOwnerEmail);
        }
      }

      // 4b. Stock images from Unsplash (supports both v1 image_keywords and v2 field)
      if (image_source === 'stock') {
        const stockUrls: string[] = [];
        const imageKeywords =
          ai_content.design_system?.image_keywords ??
          ai_content.design_hints?.image_keywords ??
          [vibe, 'business', 'professional'];

        console.log('[LANDING] Unsplash keywords:', imageKeywords);

        for (const keyword of imageKeywords.slice(0, 3)) {
          try {
            const response = await fetch(
              `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&client_id=${process.env.UNSPLASH_API_KEY}&per_page=1&orientation=landscape`,
            );
            if (!response.ok) {
              console.error(`Unsplash error for "${keyword}":`, response.status, await response.text());
            } else {
              const data = await response.json() as { results?: { urls: { regular: string } }[] };
              if (data.results?.[0]) stockUrls.push(data.results[0].urls.regular);
            }
          } catch (fetchErr) {
            console.error(`Unsplash network error for "${keyword}":`, fetchErr);
          }
        }

        if (stockUrls.length > 0) serializedImages = JSON.stringify(stockUrls);
      }

      // 4c. User-uploaded images
      if (image_source === 'upload' && uploadedImageUrls.length > 0) {
        serializedImages = JSON.stringify(uploadedImageUrls);
      }

      console.log('[LANDING] serializedImages length:', serializedImages?.length ?? 0);

      const { data, error } = await supabase
        .from('landing_pages')
        .insert({
          slug,
          business_name,
          phone_number,
          email: safeEmail,
          address: safeAddress,
          about_business: safeAbout,
          image_source,
          ai_content,
          logo_url: logo_url ?? null,
          user_images: serializedImages,
          user_provided_text: safeUserText,
          design_style: safeDesignStyle,
          facebook_url: safeFacebookUrl,
          instagram_url: safeInstagramUrl,
          enable_form: safeEnableForm,
          owner_email: safeOwnerEmail,
          page_goal: safePageGoal,
          external_link: safeExternalLink,
          status: 'draft',
        })
        .select()
        .single();

      if (error) {
        console.error('=== SUPABASE INSERT ERROR ===', error);
        res.status(500).json({ error: error.message });
        return;
      }

      res.status(201).json(data);
    } catch (error) {
      console.error('=== CRITICAL ERROR ===', error);
      res.status(500).json({
        error: 'Internal Server Error',
        details: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  } catch (error) {
    // Catches any failure in body parsing / validation above the inner try
    console.error('=== CRITICAL ERROR ===', error);
    res.status(500).json({
      error: 'Internal Server Error',
      details: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

export async function publishLandingPage(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  let result;
  try {
    result = await processMockPayment(id, 249);
  } catch (err) {
    console.error('[PUBLISH] Payment processor threw:', err);
    res.status(402).json({ error: 'Payment failed' });
    return;
  }

  if (!result.success) {
    res.status(402).json({ error: 'Payment declined' });
    return;
  }

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  const { data, error } = await supabase
    .from('landing_pages')
    .update({
      status: 'published',
      published_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .eq('id', id)
    .select('id, slug, status, published_at, expires_at')
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ ...data, transactionId: result.transactionId });
}

// ─── Inline image editing helpers ────────────────────────────────────────────

type AiStore = { hero_image_url: string | null; icon_urls: string[] };
type ImageStore = AiStore | string[];

function applyImageSlot(current: ImageStore | null, slot: string, url: string): ImageStore {
  if (!current) {
    const store: AiStore = { hero_image_url: null, icon_urls: [] };
    if (slot === 'hero') {
      store.hero_image_url = url;
    } else if (slot.startsWith('service_')) {
      const idx = parseInt(slot.slice(8), 10);
      while (store.icon_urls.length <= idx) store.icon_urls.push('');
      store.icon_urls[idx] = url;
    }
    return store;
  }
  if (Array.isArray(current)) {
    const arr = [...current] as string[];
    if (slot === 'hero') arr[0] = url;
    else if (slot.startsWith('service_')) arr[parseInt(slot.slice(8), 10) + 2] = url;
    return arr;
  }
  const store: AiStore = {
    hero_image_url: (current as AiStore).hero_image_url ?? null,
    icon_urls: [...((current as AiStore).icon_urls ?? [])],
  };
  if (slot === 'hero') {
    store.hero_image_url = url;
  } else if (slot.startsWith('service_')) {
    const idx = parseInt(slot.slice(8), 10);
    while (store.icon_urls.length <= idx) store.icon_urls.push('');
    store.icon_urls[idx] = url;
  }
  return store;
}

export async function updateImageUpload(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { slot } = req.body as { slot?: string };
  const file = (req as Request & { file?: Express.Multer.File }).file;

  if (!file || !slot?.trim()) {
    res.status(400).json({ error: 'image file and slot are required' });
    return;
  }

  const url = await processAndSave(file.buffer, 1200, 'image');

  const { data: page, error: fetchErr } = await supabase
    .from('landing_pages')
    .select('user_images')
    .eq('id', id)
    .single();

  if (fetchErr || !page) {
    res.status(404).json({ error: 'Page not found' });
    return;
  }

  const current: ImageStore | null = (() => {
    try { return JSON.parse(page.user_images ?? 'null') as ImageStore; }
    catch { return null; }
  })();

  const updated = applyImageSlot(current, slot.trim(), url);
  const serialized = JSON.stringify(updated);

  const { error } = await supabase
    .from('landing_pages')
    .update({ user_images: serialized })
    .eq('id', id);

  if (error) { res.status(500).json({ error: error.message }); return; }

  res.json({ url, user_images: serialized });
}

export async function regenerateImageAi(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { slot, prompt, isFullSet } = req.body as {
    slot?: string;
    prompt?: string;
    isFullSet?: boolean;
  };

  const fullSet = isFullSet === true;
  const cost = fullSet ? 4 : 1;

  if (!fullSet && (!slot?.trim() || !prompt?.trim())) {
    res.status(400).json({ error: 'slot and prompt are required for single-image regeneration' });
    return;
  }

  const { data: page, error: fetchErr } = await supabase
    .from('landing_pages')
    .select('owner_email, user_images, ai_content')
    .eq('id', id)
    .single();

  if (fetchErr || !page) { res.status(404).json({ error: 'Page not found' }); return; }

  const ownerEmail = (page as { owner_email?: string | null }).owner_email;
  if (!ownerEmail) {
    res.status(403).json({ error: 'Page has no owner — cannot deduct credits' });
    return;
  }

  let newCredits: number;
  try {
    newCredits = await checkAndDeductCredits(ownerEmail, cost);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Credit check failed';
    res.status(402).json({ error: msg });
    return;
  }

  const current: ImageStore | null = (() => {
    try { return JSON.parse((page as { user_images?: string | null }).user_images ?? 'null') as ImageStore; }
    catch { return null; }
  })();

  try {
    let serialized: string;
    let firstUrl: string | null = null;

    if (fullSet) {
      // Regenerate every image using prompts stored in ai_content
      const content = (page as { ai_content?: AiContent }).ai_content ?? {};
      const heroPrompt = content.hero?.hero_image_prompt;
      const serviceItems = content.services_or_benefits ?? content.services ?? [];
      const primaryColorHex = content.design_system?.primary_color ?? '#4f46e5';

      const servicePrompts = serviceItems.slice(0, 3).map((s) => {
        const keyword = s.service_icon_keyword ?? s.title;
        return `A sleek, modern 3D icon of ${keyword}, glassmorphism style, minimalist UI asset, vibrant lighting, solid clean background matching hex ${primaryColorHex}. No text.`;
      });

      console.log(`[regenerateImageAi] Full set — hero: ${!!heroPrompt}, services: ${servicePrompts.length}`);

      const settled = await Promise.allSettled([
        heroPrompt ? generateFalImage(heroPrompt, 'landscape_4_3') : Promise.resolve(null),
        ...servicePrompts.map((p) => generateFalImage(p, 'landscape_4_3')),
      ]);

      settled.forEach((r, i) => {
        if (r.status === 'rejected') console.error(`[regenerateImageAi] Slot ${i} failed:`, r.reason);
      });

      const heroResult = settled[0];
      firstUrl = heroResult.status === 'fulfilled' ? heroResult.value : null;
      const iconUrls = settled.slice(1)
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map((r) => r.value);

      serialized = JSON.stringify({ hero_image_url: firstUrl, icon_urls: iconUrls } satisfies AiStore);
    } else {
      // Single slot regeneration
      const url = await generateFalImage(prompt!.trim(), 'landscape_4_3');
      firstUrl = url;
      const updatedStore = applyImageSlot(current, slot!.trim(), url);
      serialized = JSON.stringify(updatedStore);
    }

    const { error: saveErr } = await supabase
      .from('landing_pages')
      .update({ user_images: serialized })
      .eq('id', id);

    if (saveErr) { res.status(500).json({ error: saveErr.message }); return; }

    res.json({ url: firstUrl, user_images: serialized, credits: newCredits });
  } catch (err) {
    console.error('[regenerateImageAi] Image generation failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Image generation failed' });
  }
}

// ─── Text regeneration (single section or full page) ─────────────────────────

export async function regenerateText(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { email, sectionName, userPrompt, cost } = req.body as {
    email?: string;
    sectionName?: string;
    userPrompt?: string;
    cost?: number;
  };

  if (!email?.trim() || !sectionName?.trim() || typeof cost !== 'number') {
    res.status(400).json({ error: 'email, sectionName, and cost are required' });
    return;
  }

  const parsedCost = Math.round(cost);
  if (parsedCost !== 1 && parsedCost !== 3) {
    res.status(400).json({ error: 'cost must be 1 (section) or 3 (full page)' });
    return;
  }

  const { data: page, error: fetchErr } = await supabase
    .from('landing_pages')
    .select('id, owner_email, business_name, about_business, user_provided_text, design_style, page_goal, phone_number, ai_content')
    .eq('id', id)
    .single();

  if (fetchErr || !page) {
    res.status(404).json({ error: 'Page not found' });
    return;
  }

  if (page.owner_email?.toLowerCase() !== email.trim().toLowerCase()) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  let newCredits: number;
  try {
    newCredits = await checkAndDeductCredits(email.trim().toLowerCase(), parsedCost);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Credit check failed';
    res.status(402).json({ error: msg });
    return;
  }

  const currentContent = page.ai_content as AiContent;

  try {
    let updatedContent: AiContent;

    if (parsedCost === 3) {
      // Full page rewrite — reconstruct GenerateInput from stored fields
      const vibeProxy = [page.about_business, page.design_style, page.business_name]
        .filter(Boolean)
        .join(', ');

      updatedContent = await generateAiContent({
        business_name: page.business_name as string,
        phone_number: (page.phone_number as string | undefined) ?? '',
        vibe: vibeProxy,
        design_style: page.design_style ?? undefined,
        about_business: page.about_business ?? undefined,
        user_provided_text: page.user_provided_text ?? undefined,
        page_goal: page.page_goal ?? undefined,
        image_source: 'none',
      });
    } else {
      // Single section rewrite
      const businessContext = {
        business_name: page.business_name as string,
        vibe: page.about_business ?? page.design_style ?? undefined,
        page_goal: page.page_goal ?? undefined,
      };

      const rewritten = await regenerateSectionText(
        sectionName,
        getSectionData(currentContent, sectionName),
        businessContext,
        userPrompt,
      );

      updatedContent = mergeSectionIntoContent(currentContent, sectionName, rewritten);
    }

    const { data: saved, error: saveErr } = await supabase
      .from('landing_pages')
      .update({ ai_content: updatedContent })
      .eq('id', id)
      .select('id, ai_content')
      .single();

    if (saveErr || !saved) {
      res.status(500).json({ error: saveErr?.message ?? 'Failed to save' });
      return;
    }

    res.json({ ai_content: (saved as { ai_content: AiContent }).ai_content, credits: newCredits });
  } catch (err) {
    console.error('[regenerateText] AI call failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'AI rewrite failed' });
  }
}

// Extracts the relevant slice of ai_content for the given sectionName
function getSectionData(content: AiContent, sectionName: string): unknown {
  if (sectionName === 'hero') return content.hero ?? {};
  if (sectionName === 'about') return content.about ?? {};
  if (sectionName.startsWith('services.')) {
    const idx = parseInt(sectionName.split('.')[1], 10);
    return (content.services_or_benefits ?? content.services ?? [])[idx] ?? {};
  }
  return {};
}

// Deep-merges the rewritten section back into a copy of ai_content
function mergeSectionIntoContent(content: AiContent, sectionName: string, rewritten: unknown): AiContent {
  const next = { ...content } as AiContent;
  if (sectionName === 'hero') {
    next.hero = { ...content.hero, ...(rewritten as AiContent['hero']) };
    return next;
  }
  if (sectionName === 'about') {
    next.about = { ...content.about, ...(rewritten as AiContent['about']) };
    return next;
  }
  if (sectionName.startsWith('services.')) {
    const idx = parseInt(sectionName.split('.')[1], 10);
    const arr = [...(content.services_or_benefits ?? content.services ?? [])];
    if (arr[idx]) {
      arr[idx] = { ...arr[idx], ...(rewritten as typeof arr[0]) };
    }
    next.services_or_benefits = arr;
    return next;
  }
  return next;
}

// ─── Legacy credit endpoint (deprecated — column dropped) ────────────────────

export async function useAiEdit(_req: Request, res: Response): Promise<void> {
  res.status(410).json({ error: 'This endpoint is deprecated. Use the unified credits system.' });
}
