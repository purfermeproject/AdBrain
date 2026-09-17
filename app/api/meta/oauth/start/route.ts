import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAuthorizeUrl } from "@/lib/meta/client";

// Redirects to Meta's OAuth dialog. The CSRF state is round-tripped through
// an httpOnly cookie rather than a server-side table, since it only needs
// to survive one redirect.
export async function GET() {
  const state = randomBytes(16).toString("hex");
  let authorizeUrl: string;
  try {
    authorizeUrl = getAuthorizeUrl(state);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set("meta_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
