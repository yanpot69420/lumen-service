const enc = new TextEncoder();
const hex = (value: ArrayBuffer) => [...new Uint8Array(value)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const salt = () => hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
export async function hashPin(pin: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: 310000, hash: "SHA-256" }, key, 256));
}
export async function digest(value: string) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(value))); }
export function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0; for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
export function recoveryCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const code = [...crypto.getRandomValues(new Uint8Array(12))].map((n) => alphabet[n % alphabet.length]).join("");
  return `${code.slice(0,4)}-${code.slice(4,8)}-${code.slice(8)}`;
}
export const validPin = (value: unknown): value is string => typeof value === "string" && /^\d{4,6}$/.test(value);
export const validUsername = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9._]{3,20}$/.test(value);
