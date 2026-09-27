import { describe, expect, it } from "vitest";
import { isSupportedPageUrl, normalizeUrl } from "../src/utils/urls";
import { sourceIdForUrl } from "../src/core/sources";

describe("normalizeUrl", () => {
  it("removes tracking parameters, fragments and trailing slashes", () => {
    expect(normalizeUrl("https://Example.com/essay/?utm_source=x&utm_medium=y&fbclid=1#section-2")).toBe("https://example.com/essay");
  });
  it("keeps meaningful query parameters, sorted", () => {
    expect(normalizeUrl("https://example.com/item?z=1&id=42&utm_campaign=a")).toBe("https://example.com/item?id=42&z=1");
  });
  it("keeps hash routes", () => {
    expect(normalizeUrl("https://app.example.com/#/doc/7")).toBe("https://app.example.com/#/doc/7");
  });
  it("gives tracking variants of a page the same source id", () => {
    expect(sourceIdForUrl("https://a.com/p?utm_source=tw")).toBe(sourceIdForUrl("https://a.com/p/"));
    expect(sourceIdForUrl("https://a.com/p?id=1")).not.toBe(sourceIdForUrl("https://a.com/p?id=2"));
  });
});

describe("isSupportedPageUrl", () => {
  it("accepts web pages only", () => {
    expect(isSupportedPageUrl("https://example.com")).toBe(true);
    expect(isSupportedPageUrl("chrome://extensions")).toBe(false);
    expect(isSupportedPageUrl("https://chromewebstore.google.com/detail/x")).toBe(false);
    expect(isSupportedPageUrl(undefined)).toBe(false);
  });
});
