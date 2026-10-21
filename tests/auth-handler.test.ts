import { expect, test } from "bun:test";
import { createAuthHandler } from "../supabase/functions/auth/handler";
import { hashPin as serverHash } from "../supabase/functions/_shared/pin";
import { hashPin } from "@/auth/pin";
const request = (body: unknown) => new Request("https://example.invalid/auth", {method:"POST",body:JSON.stringify(body)});
test("failed cloud status query returns unavailable, never empty shop", async () => {
  const admin = { rpc: async () => ({data:true,error:null}), from: () => ({select: async () => ({count:null,error:{message:"database unavailable"}})}) };
  const response = await createAuthHandler(admin as never,"secret")(request({action:"status"}));
  expect(response.status).toBe(503); expect((await response.json()).ok).toBe(false);
});
test("rate limited request cannot proceed to PIN verification", async () => {
  let reads=0;
  const admin = {rpc:async () => ({data:false,error:null}),from:()=>{reads++;throw new Error("must not run");}};
  const response = await createAuthHandler(admin as never,"secret")(request({action:"login",username:"owner",pin:"1234"}));
  expect(response.status).toBe(429); expect(reads).toBe(0);
});
test("setup needs its one-time administrator token", async () => {
  const admin = {rpc:async () => ({data:true,error:null})};
  const response = await createAuthHandler(admin as never,"secret")(request({action:"setup",setupToken:"wrong"}));
  expect(response.status).toBe(403);
});
test("server and local PBKDF2 use the same format", async () => {
  expect(await serverHash("123456","fixed-test-salt")).toBe(await hashPin("123456","fixed-test-salt"));
});
