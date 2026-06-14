// Life.OS API gateway — Cloudflare Worker.
// Scaffold entrypoint; the real Hono app + routes land in commit #2 onward.
export default {
  async fetch(): Promise<Response> {
    return new Response("Life.OS API — scaffold", { status: 200 });
  },
};
