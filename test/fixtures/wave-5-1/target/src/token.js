export function validateToken(token) {
  return token.startsWith("token_") && token.length > 6;
}
