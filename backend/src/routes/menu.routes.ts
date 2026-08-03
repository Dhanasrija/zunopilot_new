import { Router } from 'express';
import {
  listCategories, createCategory, updateCategory, deleteCategory,
  listItems, createItem, updateItem, deleteItem,
  listAddonGroups, createAddonGroup, updateAddonGroup, deleteAddonGroup,
} from '../controllers/menu.controller.js';
import { categoryValidator, itemValidator, addonGroupValidator } from '../validators/menu.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

// Reads are gated too.
//
// Every GET here used to be open to any authenticated member. That was invisible
// while three fixed roles all happened to include the read, and wrong the moment a
// workspace can build a role that deliberately excludes it — a role with no
// catalogue access could still list the whole catalogue.
const router = Router();
router.use(requireAuth);

router.get('/categories', requirePermission('catalogue:read'), listCategories);
router.post('/categories', requirePermission('catalogue:write'), categoryValidator, validate, createCategory);
router.patch('/categories/:id', requirePermission('catalogue:write'), categoryValidator, validate, updateCategory);
router.delete('/categories/:id', requirePermission('catalogue:write'), deleteCategory);

router.get('/items', requirePermission('catalogue:read'), listItems);
router.post('/items', requirePermission('catalogue:write'), itemValidator, validate, createItem);
router.patch('/items/:id', requirePermission('catalogue:write'), itemValidator, validate, updateItem);
router.delete('/items/:id', requirePermission('catalogue:write'), deleteItem);

router.get('/addon-groups', requirePermission('catalogue:read'), listAddonGroups);
router.post('/addon-groups', requirePermission('catalogue:write'), addonGroupValidator, validate, createAddonGroup);
router.patch('/addon-groups/:id', requirePermission('catalogue:write'), addonGroupValidator, validate, updateAddonGroup);
router.delete('/addon-groups/:id', requirePermission('catalogue:write'), deleteAddonGroup);

export default router;
