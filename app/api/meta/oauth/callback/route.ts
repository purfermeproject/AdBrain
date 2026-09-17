import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, fetchAdAccounts, getLongLivedToken } from "@/lib/meta/client";
import { encryptToken } from "@/lib/crypto";
import { query } from "@/lib/db";
import { getWorkspaceId } from "@/lib/workspace-id";

// Exchanges the OAuth code for a long-lived token, lists the accessible ad
// accounts, and creates/updates one ad_connections row per account (docs/03
// §3.3). ads_read only — this app never requests ads_management in V1
// (docs/06 §6.2: no autonomous writes to Meta).
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.cookies.get("meta_oauth_state")?.value;
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.json({ error: url.searchParams.get("error_description") || error }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: "Missing OAuth code." }, { status: 400 });
  }
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.json({ error: "OAuth state mismatch. Start the connection flow again from /settings/connections." }, { status: 400 });
  }

  try {
    const shortLived = await exchangeCodeForToken(code);
    const longLived = await getLongLivedToken(shortLived.accessToken);
    const accounts = await fetchAdAccounts(longLived.accessToken);

    if (accounts.length === 0) {
      return NextResponse.json({ error: "This Meta user has no accessible ad accounts." }, { status: 400 });
    }

    const workspaceId = getWorkspaceId();
    const encryptedToken = encryptToken(longLived.accessToken);
    const expiresAt = longLived.expiresIn ? new Date(Date.now() + longLived.expiresIn * 1000) : null;

    for (const account of accounts) {
      // eslint-disable-next-line no-await-in-loop
      await query(
        `insert into ad_connections (workspace_id, platform, external_account_id, display_name, access_token_encrypted, token_expires_at, status)
         values ($1,'meta',$2,$3,$4,$5,'active')
         on conflict (workspace_id, platform, external_account_id) do update set
           display_name=excluded.display_name, access_token_encrypted=excluded.access_token_encrypted,
           token_expires_at=excluded.token_expires_at, status='active'`,
        [workspaceId, account.accountId, account.name, encryptedToken, expiresAt]
      );
    }

    const response = NextResponse.redirect(new URL("/settings/connections?connected=1", request.url));
    response.cookies.delete("meta_oauth_state");
    return response;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
