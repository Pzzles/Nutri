// Standard response envelope — every Edge Function returns exactly this shape.
// See docs/07-edge-functions.md → Common Standards.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function preflight(): Response {
  return new Response(null, { headers: corsHeaders, status: 204 });
}

export function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
    status,
  });
}

export function fail(code: string, message: string, status = 400, data: unknown = null): Response {
  return new Response(
    JSON.stringify({ success: false, data, error: { code, message } }),
    { headers: { "Content-Type": "application/json", ...corsHeaders }, status },
  );
}
