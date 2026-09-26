import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

function deriveKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export function encryptSensitiveValue(value: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decryptSensitiveValue(value: string, secret: string) {
  const [ivValue, tagValue, encryptedValue] = value.split(".");

  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Encrypted value has an invalid format");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskSensitiveUrl(value: string) {
  const url = new URL(value);

  for (const key of [...url.searchParams.keys()]) {
    url.searchParams.set(key, "***");
  }

  const segments = url.pathname.split("/");
  if (segments.length > 2) {
    segments[segments.length - 1] = "***";
    url.pathname = segments.join("/");
  }

  url.username = url.username ? "***" : "";
  url.password = url.password ? "***" : "";
  return url.toString();
}
