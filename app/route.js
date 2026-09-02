import { NextResponse } from 'next/server';
import crypto from 'crypto';

const CLIENT_ID = '34hh45FQkPfMgbgj20uoR';

const REDIRECT_URI =
  'https://binaryspot-pro.vercel.app/api/auth/deriv/callback';

function base64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function GET() {
  const codeVerifier = base64Url(crypto.randomBytes(64));

  const codeChallenge = base64Url(
    crypto.createHash('sha256').update(codeVerifier).digest()
  );

  const state = crypto.randomBytes(32).toString('hex');

  const authorizationUrl = new URL(
    'https://auth.deriv.com/oauth2/auth'
  );

  authorizationUrl.searchParams.set(
    'response_type',
    'code'
  );

  authorizationUrl.searchParams.set(
    'client_id',
    CLIENT_ID
  );

  authorizationUrl.searchParams.set(
    'redirect_uri',
    REDIRECT_URI
  );

  authorizationUrl.searchParams.set(
    'scope',
    'trade account_manage'
  );

  authorizationUrl.searchParams.set(
    'state',
    state
  );

  authorizationUrl.searchParams.set(
    'code_challenge',
    codeChallenge
  );

  authorizationUrl.searchParams.set(
    'code_challenge_method',
    'S256'
  );

  const response = NextResponse.redirect(
    authorizationUrl.toString()
  );

  response.cookies.set(
    'deriv_oauth_verifier',
    codeVerifier,
    {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    }
  );

  response.cookies.set(
    'deriv_oauth_state',
    state,
    {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    }
  );

  return response;
}
