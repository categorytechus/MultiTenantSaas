import { Router } from "express";
import { authenticateToken } from "../middleware/auth.middleware";
import { requireSuperAdmin, requireOrgAdmin } from "../middleware/permission.middleware";
import {
  getModuleCatalog,
  getOrgModules,
  updateOrgModules,
  getOrgModulesForAdmin,
  getRolePermissions,
  updateRolePermissions,
  getMyPermissions,
} from "../controllers/permissions.controller";

const router = Router();

// Super admin: view all modules in catalog
router.get("/admin/permissions/modules", authenticateToken, requireSuperAdmin, getModuleCatalog);

// Super admin: manage org modules
router.get("/admin/organizations/:orgId/modules", authenticateToken, requireSuperAdmin, getOrgModules);
router.put("/admin/organizations/:orgId/modules", authenticateToken, requireSuperAdmin, updateOrgModules);

// Org admin: view available modules for their org
router.get("/organizations/:orgId/modules", authenticateToken, requireOrgAdmin, getOrgModulesForAdmin);

// Any authenticated user: own permissions (modules they have access to in this org)
router.get("/organizations/:orgId/my-permissions", authenticateToken, getMyPermissions);

// Org admin: manage role permissions
router.get("/organizations/:orgId/roles/:roleId/permissions", authenticateToken, requireOrgAdmin, getRolePermissions);
router.put("/organizations/:orgId/roles/:roleId/permissions", authenticateToken, requireOrgAdmin, updateRolePermissions);

export default router;