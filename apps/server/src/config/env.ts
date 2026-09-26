import { z } from "zod";

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    DATABASE_URL: z.string().default("./data/subscription-converter.sqlite"),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
    ADMIN_USERNAME: z.string().min(1).default("admin"),
    ADMIN_PASSWORD: z.string().min(8).optional(),
    SESSION_SECRET: z.string().min(32).optional(),
    PUBLIC_BASE_URL: z.string().url().optional(),
    WEB_ORIGIN: z.string().url().default("http://127.0.0.1:5173"),
    STATIC_ROOT: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV !== "production") {
      return;
    }

    for (const key of [
      "ADMIN_PASSWORD",
      "SESSION_SECRET",
      "PUBLIC_BASE_URL",
    ] as const) {
      if (!environment[key]) {
        context.addIssue({
          code: "custom",
          message: `${key} is required in production`,
          path: [key],
        });
      }
    }
  });

export type AppConfig = z.infer<typeof environmentSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return result.data;
}
