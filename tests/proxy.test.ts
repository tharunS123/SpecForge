import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const req = (auth?: string) => new NextRequest("http://localhost/", { headers: auth ? { authorization: auth } : {} });
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

afterEach(() => vi.unstubAllEnvs());

describe("password gate", () => {
  it("challenges requests without the right password", () => {
    vi.stubEnv("APP_PASSWORD", "s3cret");
    expect(proxy(req()).status).toBe(401);
    expect(proxy(req()).headers.get("www-authenticate")).toMatch(/Basic/);
    expect(proxy(req(basic("me", "wrong"))).status).toBe(401);
  });
  it("lets the right password through, with any username", () => {
    vi.stubEnv("APP_PASSWORD", "s3cret");
    expect(proxy(req(basic("anyone", "s3cret"))).headers.get("x-middleware-next")).toBe("1");
  });
  it("refuses to serve in production when APP_PASSWORD is unset", () => {
    vi.stubEnv("APP_PASSWORD", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(proxy(req()).status).toBe(503);
  });
});
