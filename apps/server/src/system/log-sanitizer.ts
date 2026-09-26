const sensitiveKeyPattern =
  /authorization|cookie|password|secret|token|url|rawcontent|content/i;

function redactUrls(value: string) {
  return value.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (candidate) => {
    try {
      const url = new URL(candidate);
      return `${url.protocol}//${url.host}/***`;
    } catch {
      return "[REDACTED_URL]";
    }
  });
}

export function sanitizeLogMessage(value: string) {
  return redactUrls(value)
    .replace(/\/sub\/[^\s/?#]+/gi, "/sub/[REDACTED]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(password|secret|token)=([^&\s]+)/gi,
      (_match, key: string) => `${key}=[REDACTED]`,
    );
}

export function sanitizeLogMetadata(value: unknown, key = ""): unknown {
  if (sensitiveKeyPattern.test(key)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return sanitizeLogMessage(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogMetadata(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeLogMetadata(childValue, childKey),
      ]),
    );
  }
  return value;
}
