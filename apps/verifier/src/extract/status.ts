export type PageStatus = "ok" | "not_found" | "blocked" | "error";
export function statusFromHttp(status: number, html = ""): PageStatus {
  if (status === 404 || status === 410) return "not_found";
  if (status === 401 || status === 403) return "blocked";
  if (/captcha|are you a robot|verify you are human|challenge-platform/i.test(html.slice(0, 20000))) return "blocked";
  if (status >= 200 && status < 300) return "ok";
  if (status >= 300 && status < 400) return "error"; // redirects handled by fetcher
  return "error";
}
