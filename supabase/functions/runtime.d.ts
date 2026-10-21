declare module "https://esm.sh/@supabase/supabase-js@2.110.5" {
  export { createClient, type SupabaseClient } from "@supabase/supabase-js";
}
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};
