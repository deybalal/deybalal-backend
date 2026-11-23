import { env } from "../config/env.js";

const DEFAULT_DOWNLOAD_HOST = env.DOWNLOAD_HOST || "https://dl.deybalal.ir";

export function getAssetUrl(path: string | null | undefined, fallback: string = ""): string {
  if (!path) return fallback;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    if (path.includes("/assets/")) {
      const assetsIndex = path.indexOf("/assets/");
      return `${DEFAULT_DOWNLOAD_HOST}${path.substring(assetsIndex)}`;
    }
    return path;
  }
  if (path.startsWith("/assets/") || path.startsWith("assets/")) {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${DEFAULT_DOWNLOAD_HOST}${cleanPath}`;
  }
  return path;
}

export function resolveSongLinks(
  links: Record<string | number, { url: string; size?: string; bytes?: number }> | any
) {
  if (!links || typeof links !== "object") return links;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(links)) {
    if (val && typeof val === "object" && "url" in val) {
      result[key] = {
        ...val,
        url: getAssetUrl((val as any).url),
      };
    } else {
      result[key] = val;
    }
  }
  return result;
}
