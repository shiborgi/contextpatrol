// @ts-expect-error fixed fixture module is intentionally untyped
import { validateToken } from "./token.js";

export function tokenFixtureCheck(): boolean {
  return validateToken("token_fixture");
}
