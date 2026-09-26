import { z } from "zod";
export const nodeFilterSchema = z.object({
  includeKeywords: z
    .array(z.string().trim().min(1).max(80))
    .max(40)
    .default([]),
  excludeKeywords: z
    .array(z.string().trim().min(1).max(80))
    .max(40)
    .default([]),
  protocols: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9-]{1,32}$/),
    )
    .max(40)
    .nullable()
    .default(null),
});
export type NodeFilter = z.infer<typeof nodeFilterSchema>;
