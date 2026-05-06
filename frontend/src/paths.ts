const appBasePath = import.meta.env.BASE_URL || "/";

export function appAssetUrl(path: string) {
  const cleanPath = path.replace(/^\/+/, "");
  return `${appBasePath}${cleanPath}`;
}

export function appApiBasePath() {
  return appAssetUrl("api");
}
