/**
 * Environment configuration for @decision-os/web.
 *
 * Configured via Vite environment variables (VITE_* prefix).
 * Never expose secrets or private keys in client-side bundles.
 */

export interface WebConfig {
  readonly apiUrl: string;
}

/**
 * Validates and normalizes the backend API URL.
 * Defaults to 'http://localhost:3000' if not specified.
 */
export function resolveApiUrl(rawUrl?: string): string {
  const url = (rawUrl || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || 'http://localhost:3000').trim();

  // Strip trailing slashes for consistent endpoint paths
  const cleanUrl = url.replace(/\/+$/, '');

  // Basic validation
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://') && !cleanUrl.startsWith('/')) {
    console.warn(`[Decision OS] Warning: VITE_API_URL '${cleanUrl}' does not start with http://, https://, or /. Using as configured.`);
  }

  return cleanUrl;
}

export const config: WebConfig = {
  apiUrl: resolveApiUrl(),
};
