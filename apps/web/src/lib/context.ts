/**
 * 提交反馈时附带的环境上下文。
 *
 * 反馈中心需要知道「这条反馈来自什么样的环境」：浏览器、系统、语言、时区、视口、
 * 是否触屏、网络类型等。这些信息在分配者那边用来判断复现条件，在 AI 诊断时
 * 用来缩小范围。全部字段都可能缺失（浏览器权限、旧版本），下游按可选处理。
 */
export function browserContext(): Record<string, unknown> {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string; downlink?: number; rtt?: number };
    userAgentData?: { platform?: string; mobile?: boolean };
  };
  const screenInfo = window.screen;
  return {
    source: "web",
    url: location.href,
    referrer: document.referrer || undefined,
    user_agent: nav.userAgent,
    platform: nav.userAgentData?.platform ?? nav.platform,
    mobile: nav.userAgentData?.mobile ?? /Mobi|Android/i.test(nav.userAgent),
    language: nav.language,
    languages: nav.languages,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${screenInfo.width}x${screenInfo.height}@${window.devicePixelRatio}`,
    color_scheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    dark_mode: matchMedia("(prefers-color-scheme: dark)").matches,
    touch: navigator.maxTouchPoints > 0,
    cores: nav.hardwareConcurrency,
    memory_gb: nav.deviceMemory,
    network: nav.connection?.effectiveType,
    downlink_mbps: nav.connection?.downlink,
    rtt_ms: nav.connection?.rtt,
    captured_at: new Date().toISOString(),
  };
}
