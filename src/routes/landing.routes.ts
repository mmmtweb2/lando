import { Router } from 'express';
import { createLandingPage, getLandingPage, deleteLandingPage, getMyPages, updateLandingPage, publishLandingPage, useAiEdit, updateImageUpload, regenerateImageAi, regenerateText } from '../controllers/landing.controller';
import { submitLead } from '../controllers/lead.controller';
import { handleUpload, handleSingleImageUpload } from '../middleware/upload.middleware';

const router = Router();

router.post('/', handleUpload, createLandingPage);
router.get('/my-pages', getMyPages);   // must be before /:slug
router.get('/:slug', getLandingPage);
router.post('/:id/publish', publishLandingPage);
router.post('/:id/regenerate-text', regenerateText);
router.post('/:id/use-ai-edit', useAiEdit);
router.post('/:id/update-image-upload', handleSingleImageUpload, updateImageUpload);
router.post('/:id/regenerate-image-ai', regenerateImageAi);
router.post('/:id/lead', submitLead);
router.patch('/:id', updateLandingPage);
router.delete('/:id', deleteLandingPage);

export default router;
