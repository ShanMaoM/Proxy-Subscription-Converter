import { parseClashYaml, type ClashConfig } from "./parse-clash-yaml";
import {
  looksLikeNodeSubscription,
  parseNodeSubscription,
} from "./parse-node-subscription";

export function parseSubscriptionContent(content: string): ClashConfig {
  if (looksLikeNodeSubscription(content)) {
    return parseNodeSubscription(content);
  }

  try {
    return parseClashYaml(content);
  } catch (error) {
    if (looksLikeNodeSubscription(content)) {
      return parseNodeSubscription(content);
    }
    throw error;
  }
}
