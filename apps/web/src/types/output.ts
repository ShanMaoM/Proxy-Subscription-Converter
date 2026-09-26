import type { OutputProfileOptions } from "@subscription-converter/shared";

export type ManagedOutputProfile = {
  id: string;
  name: string;
  targetClient: "clash" | "shadowrocket";
  enabled: boolean;
  options: OutputProfileOptions;
  subscriptionUrl: string;
  createdAt: string;
  updatedAt: string;
};
