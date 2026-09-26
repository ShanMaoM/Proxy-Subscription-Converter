import { z } from "zod";

export const ruleDefinitions = [
  ["DOMAIN", "完整域名", "域名", "example.com"],
  ["DOMAIN-SUFFIX", "域名后缀", "域名", "example.com"],
  ["DOMAIN-KEYWORD", "域名关键词", "域名", "google"],
  ["DOMAIN-WILDCARD", "域名通配符", "域名", "*.example.com"],
  ["DOMAIN-REGEX", "域名正则", "域名", "^example\\.com$"],
  ["GEOSITE", "域名分类", "域名", "cn"],
  ["IP-CIDR", "目标 IP / 网段", "IP 地址", "192.168.1.10 或 192.168.1.0/24"],
  ["IP-CIDR6", "目标 IPv6 / 网段", "IP 地址", "2001:db8::1 或 2001:db8::/32"],
  [
    "SRC-IP-CIDR",
    "来源 IP / 网段",
    "IP 地址",
    "192.168.1.10 或 192.168.1.0/24",
  ],
  ["IP-SUFFIX", "目标 IP 后缀", "IP 地址", "192.168.1.1/8"],
  ["SRC-IP-SUFFIX", "来源 IP 后缀", "IP 地址", "192.168.1.1/8"],
  ["GEOIP", "目标 IP 地区", "IP 地址", "CN 或 LAN"],
  ["SRC-GEOIP", "来源 IP 地区", "IP 地址", "CN"],
  ["IP-ASN", "目标 IP 所属 ASN", "IP 地址", "13335"],
  ["SRC-IP-ASN", "来源 IP 所属 ASN", "IP 地址", "13335"],
  ["DST-PORT", "目标端口", "连接与入站", "80/443/8000-9000"],
  ["SRC-PORT", "来源端口", "连接与入站", "1024-65535"],
  ["IN-PORT", "入站端口", "连接与入站", "7890"],
  ["NETWORK", "传输协议", "连接与入站", "tcp"],
  ["IN-TYPE", "入站类型", "连接与入站", "HTTP/SOCKS"],
  ["IN-USER", "入站用户", "连接与入站", "user"],
  ["IN-NAME", "入站名称", "连接与入站", "mixed-in"],
  ["REMATCH-NAME", "重新匹配名称", "连接与入站", "rematch1"],
  ["DSCP", "DSCP 标记", "连接与入站", "4"],
  ["PROCESS-NAME", "进程名称", "进程", "chrome.exe"],
  ["PROCESS-PATH", "进程完整路径", "进程", "C:\\Program Files\\App\\app.exe"],
  ["PROCESS-NAME-WILDCARD", "进程名称通配符", "进程", "*telegram*"],
  ["PROCESS-PATH-WILDCARD", "进程路径通配符", "进程", "/usr/*/curl"],
  ["PROCESS-NAME-REGEX", "进程名称正则", "进程", "(?i)telegram"],
  ["PROCESS-PATH-REGEX", "进程路径正则", "进程", ".*/bin/curl$"],
  ["UID", "Linux 用户 ID", "进程", "1000"],
  ["RULE-SET", "已配置规则集", "规则集与兜底", "选择规则集"],
  ["MATCH", "所有剩余流量", "规则集与兜底", ""],
] as const;
export const clashRuleTypeSchema = z.enum(
  ruleDefinitions.map((item) => item[0]),
);
export type ClashRuleType = z.infer<typeof clashRuleTypeSchema>;
export const noResolveRuleTypes: readonly string[] = [
  "IP-CIDR",
  "IP-CIDR6",
  "IP-SUFFIX",
  "IP-ASN",
  "GEOIP",
];
const addressTypes = [
  "IP-CIDR",
  "IP-CIDR6",
  "SRC-IP-CIDR",
  "IP-SUFFIX",
  "SRC-IP-SUFFIX",
];
export function normalizeRuleValue(type: string, input: string) {
  const value = input.trim();
  if (addressTypes.includes(type)) {
    if (z.ipv4().safeParse(value).success) return `${value}/32`;
    if (z.ipv6().safeParse(value).success) return `${value}/128`;
  }
  return type === "NETWORK" ? value.toLowerCase() : value;
}
export function ruleValueError(
  type: string,
  value: string | null,
  noResolve = false,
): string | undefined {
  if (noResolve && !noResolveRuleTypes.includes(type))
    return "只有目标 IP 规则支持不触发 DNS 解析。";
  if (type === "MATCH")
    return value ? "MATCH rules must not include a match value" : undefined;
  if (!value) return "请填写匹配值。";
  if (/[\r\n,]/.test(value)) return "匹配值不能包含逗号或换行。";
  if (addressTypes.includes(type)) {
    const valid =
      type === "IP-CIDR6"
        ? z.cidrv6().safeParse(value).success
        : z.cidrv4().safeParse(value).success ||
          z.cidrv6().safeParse(value).success;
    if (!valid)
      return "请输入有效的 IP 地址或 CIDR 网段，例如 192.168.1.10 或 192.168.1.0/24。";
  }
  if (
    ["DST-PORT", "SRC-PORT", "IN-PORT"].includes(type) &&
    !value.split("/").every((part) => {
      if (!/^\d{1,5}(?:-\d{1,5})?$/.test(part)) return false;
      const [start, end = start] = part.split("-").map(Number);
      return start >= 1 && end <= 65535 && start <= end;
    })
  )
    return "端口范围为 1–65535；用 / 分隔多项，用 - 表示范围。";
  if (["IP-ASN", "SRC-IP-ASN", "UID", "DSCP"].includes(type)) {
    const max = type === "DSCP" ? 63 : 4294967295;
    if (
      !/^\d+$/.test(value) ||
      Number(value) > max ||
      (type.includes("ASN") && Number(value) === 0)
    )
      return `请输入 ${type.includes("ASN") ? 1 : 0}–${max} 的整数。`;
  }
  if (type === "NETWORK" && !["tcp", "udp"].includes(value))
    return "协议只能选择 TCP 或 UDP。";
  if (
    ["GEOIP", "SRC-GEOIP"].includes(type) &&
    !/^(?:[a-z]{2}|LAN)$/i.test(value)
  )
    return "请输入两位国家代码（如 CN）或 LAN。";
  if (type.endsWith("-REGEX")) {
    // Mihomo uses RE2. Validate the shared subset without executing the expression.
    if (/\(\?[=!<]|\\[1-9]/.test(value))
      return "Mihomo 正则不支持前后查找或反向引用。";
    try {
      new RegExp(value.replace(/^\(\?[ims]+\)/, ""));
    } catch {
      return "正则表达式格式不正确。";
    }
  }
  return undefined;
}
export function validateRuleValue(
  rule: { ruleType: ClashRuleType; value: string | null; noResolve?: boolean },
  context: z.RefinementCtx,
) {
  const error = ruleValueError(rule.ruleType, rule.value, rule.noResolve);
  if (error)
    context.addIssue({ code: "custom", message: error, path: ["value"] });
}
export const rulePolicySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => !/[,\r\n]/.test(value), "策略名称不能包含逗号或换行。");
