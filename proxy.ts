import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

// HTTP Basic auth for the whole app (any username, password = APP_PASSWORD). The deployed app spends
// API quota, so production refuses to serve when APP_PASSWORD is not configured.

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("SpecForge is not configured: set APP_PASSWORD.", { status: 503 });
    }
    return NextResponse.next();
  }
  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const supplied = decoded.slice(decoded.indexOf(":") + 1);
    if (decoded.includes(":") && safeEqual(supplied, password)) return NextResponse.next();
  }
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="SpecForge", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
