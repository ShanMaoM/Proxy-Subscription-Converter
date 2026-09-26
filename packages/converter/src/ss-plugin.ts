import type { ClashProxy } from "./parse-clash-yaml";

// SIP002 uses backslash escaping inside the URL-encoded plugin argument.
function splitEscaped(value: string, delimiter: string) {
  const parts: string[] = [];
  let part = "";
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === "\\" && index + 1 < value.length) {
      part += char + value[++index];
    } else if (char === delimiter) {
      parts.push(part);
      part = "";
    } else part += char;
  }
  parts.push(part);
  return parts;
}

const unescape = (value: string) => value.replace(/\\(.)/g, "$1");
const escape = (value: string) => value.replace(/[\\;=:]/g, "\\$&");

export function parseSsPlugin(value: string): Partial<ClashProxy> | undefined {
  const [name, ...parts] = splitEscaped(value, ";");
  const options: Record<string, string | boolean> = Object.create(null);
  for (const part of parts) {
    const [key, ...rest] = splitEscaped(part, "=");
    options[unescape(key)] = rest.length ? unescape(rest.join("=")) : true;
  }
  if (["obfs-local", "simple-obfs", "obfs"].includes(name)) {
    if (!["http", "tls"].includes(String(options.obfs))) return undefined;
    if (
      Object.keys(options).some((key) => !["obfs", "obfs-host"].includes(key))
    )
      return undefined;
    return {
      plugin: "obfs",
      "plugin-opts": {
        mode: options.obfs,
        ...(options["obfs-host"] ? { host: options["obfs-host"] } : {}),
      },
    };
  }
  if (name === "v2ray-plugin") {
    if (
      Object.keys(options).some(
        (key) => !["tls", "host", "path", "mux"].includes(key),
      )
    )
      return undefined;
    if (
      ["tls", "mux"].some(
        (key) => options[key] !== undefined && options[key] !== true,
      )
    )
      return undefined;
    return { plugin: name, "plugin-opts": { mode: "websocket", ...options } };
  }
  return undefined;
}

export function generateSsPlugin(proxy: ClashProxy): string | undefined {
  const opts = proxy["plugin-opts"];
  if (!opts || typeof opts !== "object" || Array.isArray(opts))
    return undefined;
  const options = opts as Record<string, unknown>;
  const args: string[] = [];
  if (proxy.plugin === "obfs") {
    if (!["http", "tls"].includes(String(options.mode))) return undefined;
    if (Object.keys(options).some((key) => !["mode", "host"].includes(key)))
      return undefined;
    args.push("obfs-local", `obfs=${escape(String(options.mode))}`);
    if (typeof options.host === "string")
      args.push(`obfs-host=${escape(options.host)}`);
  } else if (proxy.plugin === "v2ray-plugin") {
    if (options.mode && options.mode !== "websocket") return undefined;
    if (
      Object.keys(options).some(
        (key) => !["mode", "tls", "host", "path", "mux"].includes(key),
      )
    )
      return undefined;
    args.push("v2ray-plugin");
    if (options.mux === false) return undefined;
    for (const key of ["tls", "mux"]) {
      if (options[key] === true) args.push(key);
      if (options[key] !== undefined && typeof options[key] !== "boolean")
        return undefined;
    }
    for (const key of ["host", "path"]) {
      if (typeof options[key] === "string")
        args.push(`${key}=${escape(options[key])}`);
    }
  } else return undefined;
  return args.join(";");
}
