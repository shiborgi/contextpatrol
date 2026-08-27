// @ts-expect-error fixed fixture module is intentionally untyped
import { validateToken } from "./token.js";

export function authorize(token: string): boolean {
  return validateToken(token);
}
