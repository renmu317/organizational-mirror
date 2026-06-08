import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: cases, error } = await supabase
      .from('cases')
      .select('completeness, insight_confidence');

    if (error) throw error;

    const stats = {
      total: cases.length,
      skeleton: cases.filter(c => c.completeness === 'skeleton').length,
      gap: cases.filter(c => c.completeness === 'gap').length,
      enriched: cases.filter(c => c.completeness === 'enriched').length,
      active: cases.filter(c => c.completeness !== 'skeleton').length,
      highConfidence: cases.filter(c => c.insight_confidence === 'high').length
    };

    return new Response(JSON.stringify(stats), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
