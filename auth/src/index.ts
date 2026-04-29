import express, { Application, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.routes";
import organizationRoutes from "./routes/organization.routes";
import testRoutes from "./routes/test.routes";
import passport from "./config/passport";
import documentRoutes from "./routes/document.routes";
import knowledgeBaseRoutes from "./routes/knowledgebase.routes";
import webUrlRoutes from "./routes/weburl.routes";
import userAdminRoutes from "./routes/user-admin.routes";
import orgUsersRoutes from "./routes/org-users.routes";
import roleManagementRoutes from "./routes/role-management.routes";
import { authenticateToken } from "./middleware/auth.middleware";
import { requireOrgAdmin } from "./middleware/permission.middleware";
// Reference catalog for future use (not used by org custom-role forms today)
import { listPermissions } from "./controllers/role-management.controller";

// Load environment variables
dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 4000;

// Middleware
// CORS configuration
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET));

// Passport initialization
app.use(passport.initialize());

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Auth service is running",
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/organizations/:orgId/users", orgUsersRoutes);
app.use("/api/organizations/:orgId/roles", roleManagementRoutes);
app.use("/api/admin", userAdminRoutes);
app.get(
  "/api/permissions",
  authenticateToken,
  requireOrgAdmin,
  listPermissions,
);
app.use("/api/test", testRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/knowledge-base", knowledgeBaseRoutes);
app.use("/api/web-urls", webUrlRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error("Error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Auth service running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV}`);
  console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL}`);
});

export default app;