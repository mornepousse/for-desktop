import { session } from "electron";

import { DEFAULT_SERVER, getActiveServer } from "./config";
import { getBuildUrl } from "./window";

// The upstream Stoat web client looks for GIF search endpoints at two
// possible locations depending on how it was built:
//
//   1. `https://api.gifbox.me/*` — the baked-in default when VITE_GIFBOX_URL
//      was not set. Only works if you are on stoat.chat (auth-gated).
//   2. `https://<api-origin>/{categories,trending,search}` — when
//      VITE_GIFBOX_URL was set to an empty / same-origin-relative value.
//      That's what pugin.ovh ships today: nginx has no such routes at the
//      root, so Caddy falls through to the SPA catch-all and returns
//      `index.html` (content-type: text/html) instead of JSON. The client
//      silently fails to parse it and the picker stays empty.
//
// Self-hosted deployments DO run a gifbox service, but Caddy exposes it
// under `/gifbox/*` (see stoatchat/self-hosted compose.yml + Caddyfile's
// `route /gifbox* { strip_prefix /gifbox; reverse_proxy gifbox:14706 }`).
// We redirect both request shapes to that `/gifbox/*` prefix on the active
// server so the search just works without any client-side changes.

// Host the stoat.chat-era client was hardcoded to call.
const GIFBOX_UPSTREAM_HOST = "api.gifbox.me";

// Known gifbox endpoints at the service root — see stoatchat/stoatchat
// crates/services/gifbox/src/main.rs (`routes::categories`, `routes::root`,
// `routes::search`, `routes::trending`). `/` is intentionally excluded to
// avoid rewriting navigation to the SPA itself.
const GIFBOX_BARE_PATHS = new Set(["/categories", "/trending", "/search"]);

/**
 * Install a `webRequest.onBeforeRequest` handler that redirects GIF
 * search calls to the active server's `/gifbox/*` path.
 *
 * Two rewrite rules, both gated on the active server NOT being the built-in
 * stoat.chat default (there the original client config is correct and any
 * rewrite would break things):
 *
 *   - `https://api.gifbox.me/<p>`         → `<activeOrigin>/gifbox/<p>`
 *   - `<activeOrigin>/{categories,trending,search}` → `<activeOrigin>/gifbox/<same>`
 *
 * Must be called after `app.ready` (session.defaultSession becomes valid
 * then). Uses the default session which the main BrowserWindow also uses.
 */
export function wireGifboxRewrite(): void {
  session.defaultSession.webRequest.onBeforeRequest(
    {
      urls: [
        `*://${GIFBOX_UPSTREAM_HOST}/*`,
        // Cover any host; we filter in the handler to the active server.
        "https://*/categories*",
        "https://*/trending*",
        "https://*/search*",
        "http://*/categories*",
        "http://*/trending*",
        "http://*/search*",
      ],
    },
    (details, callback) => {
      // Skip entirely on the stoat.chat default: the baked-in client
      // config is correct there.
      if (getActiveServer().url === DEFAULT_SERVER.url) {
        callback({});
        return;
      }

      try {
        const src = new URL(details.url);
        const buildOrigin = getBuildUrl().origin;

        // Case 1: the old hardcoded host.
        if (src.hostname === GIFBOX_UPSTREAM_HOST) {
          callback({
            redirectURL: `${buildOrigin}/gifbox${src.pathname}${src.search}`,
          });
          return;
        }

        // Case 2: a bare gifbox path on the active server's origin.
        const activeOrigin = new URL(getActiveServer().url).origin;
        if (
          src.origin === activeOrigin &&
          GIFBOX_BARE_PATHS.has(src.pathname)
        ) {
          callback({
            redirectURL: `${activeOrigin}/gifbox${src.pathname}${src.search}`,
          });
          return;
        }

        callback({});
      } catch {
        // Unparseable URL — pass through.
        callback({});
      }
    },
  );
}
