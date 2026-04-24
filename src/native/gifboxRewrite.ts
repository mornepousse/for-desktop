import { session } from "electron";

import { DEFAULT_SERVER, getActiveServer } from "./config";
import { getBuildUrl } from "./window";

// upstream for-web bakes `https://api.gifbox.me` as the default GIF search
// endpoint at build time. Self-hosted Stoat deployments ship their own
// `/gifbox` service (in stoatchat/self-hosted compose.yml) but the client
// never looks there unless VITE_GIFBOX_URL was set when the image was built
// — which most self-hosters forget. We paper over that by redirecting the
// hardcoded requests from the main-process session to the active server's
// `/gifbox` path. Works for every renderer without any client changes.
const GIFBOX_UPSTREAM_HOST = "api.gifbox.me";

/**
 * Install a `webRequest.onBeforeRequest` handler that rewrites any request
 * to `api.gifbox.me` so it hits `${activeServer.origin}/gifbox` instead.
 *
 * No-op when the active server is the built-in `stoat.chat` default —
 * stoat.chat is the authoritative operator of `api.gifbox.me`, so letting
 * that request through is the correct behavior there.
 *
 * Must be called after `app.ready` (session.defaultSession becomes valid
 * then). Uses the default session which the main BrowserWindow also uses.
 */
export function wireGifboxRewrite(): void {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: [`*://${GIFBOX_UPSTREAM_HOST}/*`] },
    (details, callback) => {
      // Skip when the user is on stoat.chat — api.gifbox.me is the
      // legitimate upstream there.
      if (getActiveServer().url === DEFAULT_SERVER.url) {
        callback({});
        return;
      }

      try {
        const src = new URL(details.url);
        if (src.hostname !== GIFBOX_UPSTREAM_HOST) {
          callback({});
          return;
        }
        const buildOrigin = getBuildUrl().origin;
        const redirectURL = `${buildOrigin}/gifbox${src.pathname}${src.search}`;
        callback({ redirectURL });
      } catch {
        // Unparseable URL — do not intercept, let the network stack surface
        // whatever error it wants.
        callback({});
      }
    },
  );
}
