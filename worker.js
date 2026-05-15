export default {
  async fetch(request, env, ctx) {
    // Cloudflare will automatically serve static assets from the "public" directory
    // as defined in wrangler.jsonc. This script acts as a fallback for routes
    // that don't match any static asset.
    return new Response("Not found", { status: 404 });
  },
};
