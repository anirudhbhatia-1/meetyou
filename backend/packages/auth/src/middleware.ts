import { AuthError } from './errors.ts';
import type { AccessClaims, TokenService } from './tokens.ts';

/**
 * Request authentication for the API (S2-08 wires it into Fastify): reads `Authorization: Bearer
 * <access token>` and returns who is calling and in which workspace. Queries then run through
 * `Db.inWorkspace(context.workspaceId, …)`, so a request can only reach its own workspace.
 */
export async function authenticate(
  authorization: string | undefined,
  tokens: TokenService,
): Promise<AccessClaims> {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
    authorization?.trim() ?? '',
  );
  const token = match?.[1];
  if (token === undefined) throw new AuthError('missing_token');
  return tokens.verifyAccessToken(token);
}
