import { describe, expect, it } from "vitest";

import { httpsUpgradeUrl, isNetworkDisplayLocation } from "./browserRouting";

describe("browser routing", () => {
  it("recognizes both the short TV path and legacy query route", () => {
    expect(isNetworkDisplayLocation({ pathname: "/app/tv", search: "" })).toBe(true);
    expect(isNetworkDisplayLocation({ pathname: "/app/", search: "?presentation=tv" })).toBe(true);
    expect(isNetworkDisplayLocation({ pathname: "/app/", search: "" })).toBe(false);
  });

  it("upgrades public HTTP URLs without losing the path or query", () => {
    expect(
      httpsUpgradeUrl({
        href: "http://lcf.walsh.qzz.io/app/tv?display=church",
        hostname: "lcf.walsh.qzz.io",
        pathname: "/app/tv",
        protocol: "http:",
        search: "?display=church",
      }),
    ).toBe("https://lcf.walsh.qzz.io/app/tv?display=church");
  });

  it("leaves HTTPS and local HTTP deployments unchanged", () => {
    expect(
      httpsUpgradeUrl({
        href: "https://example.com/app/tv",
        hostname: "example.com",
        pathname: "/app/tv",
        protocol: "https:",
        search: "",
      }),
    ).toBeNull();
    expect(
      httpsUpgradeUrl({
        href: "http://192.168.2.50/app/tv",
        hostname: "192.168.2.50",
        pathname: "/app/tv",
        protocol: "http:",
        search: "",
      }),
    ).toBeNull();
  });
});
