import { expect, test } from "bun:test";
import { publicCloudEnv } from "../scripts/public-cloud-env";

test("Vercel Supabase integration supplies public values without exposing server credentials", () => {
  const values = publicCloudEnv({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "public-anon", SUPABASE_SERVICE_ROLE_KEY: "private-service", SUPABASE_JWT_SECRET: "private-jwt", POSTGRES_PASSWORD: "private-db" });
  expect(values).toEqual({ url: "https://example.supabase.co", key: "public-anon" });
  expect(JSON.stringify(values)).not.toContain("private");
});
test("explicit Vite configuration takes priority and empty local mode stays supported", () => {
  expect(publicCloudEnv({ VITE_SUPABASE_URL: "https://vite.supabase.co", VITE_SUPABASE_ANON_KEY: "vite-key", SUPABASE_URL: "https://other.supabase.co", SUPABASE_ANON_KEY: "other-key" })).toEqual({ url: "https://vite.supabase.co", key: "vite-key" });
  expect(publicCloudEnv({})).toEqual({ url: "", key: "" });
});
test("publishable integration keys are supported but partial or secret frontend configuration fails", () => {
  expect(publicCloudEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" }).key).toBe("sb_publishable_test");
  expect(() => publicCloudEnv({ SUPABASE_URL: "https://example.supabase.co" })).toThrow("belum lengkap");
  expect(() => publicCloudEnv({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "sb_secret_private" })).toThrow("rahasia");
  const serviceJwt = `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
  expect(() => publicCloudEnv({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: serviceJwt })).toThrow("rahasia");
});
