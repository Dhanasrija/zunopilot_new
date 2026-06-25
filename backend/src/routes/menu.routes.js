import { Router } from 'express';
import {
  listCategories, createCategory, updateCategory, deleteCategory,
  listItems, createItem, updateItem, deleteItem,
  listAddonGroups, createAddonGroup, updateAddonGroup, deleteAddonGroup,
} from '../controllers/menu.controller.js';
import { categoryValidator, itemValidator, addonGroupValidator } from '../validators/menu.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/categories', listCategories);
router.post('/categories', requireRole('OWNER', 'MANAGER'), categoryValidator, validate, createCategory);
router.patch('/categories/:id', requireRole('OWNER', 'MANAGER'), categoryValidator, validate, updateCategory);
router.delete('/categories/:id', requireRole('OWNER', 'MANAGER'), deleteCategory);

router.get('/items', listItems);
router.post('/items', requireRole('OWNER', 'MANAGER'), itemValidator, validate, createItem);
router.patch('/items/:id', requireRole('OWNER', 'MANAGER'), itemValidator, validate, updateItem);
router.delete('/items/:id', requireRole('OWNER', 'MANAGER'), deleteItem);

router.get('/addon-groups', listAddonGroups);
router.post('/addon-groups', requireRole('OWNER', 'MANAGER'), addonGroupValidator, validate, createAddonGroup);
router.patch('/addon-groups/:id', requireRole('OWNER', 'MANAGER'), addonGroupValidator, validate, updateAddonGroup);
router.delete('/addon-groups/:id', requireRole('OWNER', 'MANAGER'), deleteAddonGroup);

export default router;
