import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";
import { createAuthHandler } from "./handler.ts";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
Deno.serve(createAuthHandler(admin, Deno.env.get("LUMEN_SETUP_TOKEN") ?? ""));
