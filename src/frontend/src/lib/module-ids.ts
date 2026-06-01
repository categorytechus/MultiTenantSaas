/** Canonical module ID constants — matches master_modules.id in the database.
 *  Use these everywhere instead of inline string literals so a rename only
 *  needs to touch this file and the migration. */
export const MODULE = {
  AI_ASSISTANT:      "ai_assistant",
  AI_IMAGES:         "ai_images",
  AI_LINKS:          "ai_links",
  REPORT_GENERATION: "report_generation",
  COST_SEG:          "cost_seg",
  DOCUMENTS:         "documents",
  WEB_URLS:          "web_urls",
  API_CALLING:       "api_calling",
} as const;

export type ModuleId = (typeof MODULE)[keyof typeof MODULE];
