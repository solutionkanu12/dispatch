/**
 * Builds the URL for a backend API call.
 *
 * In local dev, VITE_API_URL is normally unset, so this returns the path as
 * given (e.g. "/api/orders"), which Vite's dev server proxies to the backend
 * per the server.proxy config in vite.config.js. That proxy only exists while
 * `vite dev` is running; a static production build (e.g. deployed to Vercel)
 * has no proxy at all, so VITE_API_URL must be set there to the real deployed
 * backend's URL, and every call is built as an absolute URL against it.
 */
export function apiUrl(path) {
  const base = import.meta.env.VITE_API_URL;
  if (!base) return path;
  return base.replace(/\/+$/, '') + path;
}
