import { NextResponse } from 'next/server';

const CLIENT_ID = '34hh45FQkPfMgbgj20uoR';

const REDIRECT_URI =
  'https://binaryspot-pro.vercel.app/api/auth/deriv/callback';

const TOKEN_URL =
  'https://auth.deriv.com/oauth2/token';

const HOME_URL =
  'https://binaryspot-pro.vercel.app/';

export async function GET(request) {
  try {
    const url = new URL(request.url);

    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');

    const error = url.searchParams.get('error');
    const errorDescription =
      url.searchParams.get('error_description');

    if (error) {
      return NextResponse.redirect(
        `${HOME_URL}?deriv_error=${encodeURIComponent(
          errorDescription || error
        )}`
      );
    }

    const savedState =
      request.cookies.get('deriv_oauth_state')?.value;

    const codeVerifier =
      request.cookies.get('deriv_oauth_verifier')?.value;

    if (!code) {
      return NextResponse.redirect(
        `${HOME_URL}?deriv_error=${encodeURIComponent(
          'Authorization code missing.'
        )}`
      );
    }

    if (
      !savedState ||
      !returnedState ||
      savedState !== returnedState
    ) {
      return NextResponse.redirect(
        `${HOME_URL}?deriv_error=${encodeURIComponent(
          'OAuth state validation failed.'
        )}`
      );
    }

    if (!codeVerifier) {
      return NextResponse.redirect(
        `${HOME_URL}?deriv_error=${encodeURIComponent(
          'PKCE verifier missing. Please connect again.'
        )}`
      );
    }

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
    });

    const tokenResponse = await fetch(
      TOKEN_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded',
        },
        body: tokenBody.toString(),
        cache: 'no-store',
      }
    );

    const tokenData =
      await tokenResponse.json();

    if (
      !tokenResponse.ok ||
      !tokenData.access_token
    ) {
      console.error(
        'Deriv token exchange failed:',
        tokenData
      );

      return NextResponse.redirect(
        `${HOME_URL}?deriv_error=${encodeURIComponent(
          'Deriv token exchange failed.'
        )}`
      );
    }

    const response = NextResponse.redirect(
      `${HOME_URL}?deriv_connected=1`
    );

    response.cookies.set(
      'deriv_access_token',
      tokenData.access_token,
      {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge:
          Number(tokenData.expires_in) || 3600,
      }
    );

    response.cookies.delete(
      'deriv_oauth_state'
    );

    response.cookies.delete(
      'deriv_oauth_verifier'
    );

    return response;
  } catch (error) {
    console.error(
      'Deriv callback error:',
      error
    );

    return NextResponse.redirect(
      `${HOME_URL}?deriv_error=${encodeURIComponent(
        'Unable to complete Deriv login.'
      )}`
    );
  }
}
