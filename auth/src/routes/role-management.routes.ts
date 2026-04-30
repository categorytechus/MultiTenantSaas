import { Router } from "express";
import { body } from "express-validator";
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
} from "../controllers/role-management.controller";
import { authenticateToken } from "../middleware/auth.middleware";
import { requireOrgAdmin } from "../middleware/permission.middleware";
import { validateRequest } from "../middleware/validation.middleware";

const router = Router({ mergeParams: true });

router.use(authenticateToken);

router.get("/", listRoles);

router.post(
  "/",
  [
    body("name").trim().notEmpty().withMessage("Role name is required"),
    body("description").optional().trim(),
  ],
  requireOrgAdmin,
  validateRequest,
  createRole,
);

router.put(
  "/:id",
  [
    body("name").optional().trim().notEmpty(),
    body("description").optional().trim(),
  ],
  requireOrgAdmin,
  validateRequest,
  updateRole,
);

router.delete("/:id", requireOrgAdmin, deleteRole);

export default router;