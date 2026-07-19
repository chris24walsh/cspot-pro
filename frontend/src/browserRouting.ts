interface BrowserLocation {
  href: string;
  hostname: string;
  pathname: string;
  protocol: string;
  search: string;
}

function isPrivateIpv4(hostname: string) {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function isLocalHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized.endsWith(".local") ||
    !normalized.includes(".") ||
    isPrivateIpv4(normalized)
  );
}

export function httpsUpgradeUrl(location: BrowserLocation) {
  if (location.protocol !== "http:" || isLocalHostname(location.hostname)) {
    return null;
  }

  const upgraded = new URL(location.href);
  upgraded.protocol = "https:";
  return upgraded.toString();
}

export function isNetworkDisplayLocation(location: Pick<BrowserLocation, "pathname" | "search">) {
  const params = new URLSearchParams(location.search);
  const normalizedPath = location.pathname.replace(/\/+$/, "");
  return params.get("presentation") === "tv" || normalizedPath.endsWith("/tv");
}
