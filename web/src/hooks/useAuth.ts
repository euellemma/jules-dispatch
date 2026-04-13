import { useState, useEffect } from 'react';

const TOKEN_KEY = 'jules_dispatch_token';

export type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; token: string }
  | { status: 'error'; message: string };

function loadToken(): string | null {
  const urlParams = new URLSearchParams(window.location.search);
  const urlToken = urlParams.get('token');

  if (urlToken) {
    localStorage.setItem(TOKEN_KEY, urlToken);
    window.history.replaceState({}, '', window.location.pathname);
    return urlToken;
  }

  return localStorage.getItem(TOKEN_KEY);
}

export function useAuth(): AuthState {
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    const token = loadToken();

    if (token) {
      setAuthState({ status: 'authenticated', token });
    } else if (window.location.hostname === 'localhost') {
      setAuthState({ status: 'authenticated', token: 'dev' });
    } else {
      setAuthState({
        status: 'error',
        message: 'No token provided. Please open the settings link from Telegram using /connect command.',
      });
    }
  }, []);

  return authState;
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
}
