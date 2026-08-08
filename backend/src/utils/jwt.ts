import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AccessTokenPayload extends JwtPayload {
  userId: string;
  /**
   * The workspace this session is scoped to.
   *
   * **The same claim name and meaning impersonation already uses.** A support token has carried
   * `tenantId` since that feature shipped; giving the ordinary one a second spelling would mean
   * two claims that almost agree, and eventually the impersonation check applied to the wrong one.
   *
   * Optional because tokens minted before it existed do not have it — see the legacy branch in
   * `requireAuth`, which is dated for removal. It is **selected by**, never trusted: a token naming
   * a workspace its user is not an active member of resolves to nothing and is refused.
   */
  tenantId?: string;
}

/**
 * Pinned rather than inferred from the token.
 *
 * `jwt.verify` without this accepts whatever the token's own header asks for, which is the
 * shape of the classic algorithm-confusion attack: a forged token naming a different family
 * gets verified against key material that was never meant to validate it. Nothing here uses
 * an asymmetric key today, so there is no exploit path — the point is that adding one later
 * must not silently create one.
 */
const ALGORITHM = 'HS256' as const;

export const signToken = (payload: { userId: string } & Record<string, unknown>): string =>
  jwt.sign(payload, env.jwt.secret, {
    algorithm: ALGORITHM,
    expiresIn: env.jwt.expiresIn as SignOptions['expiresIn'],
  });

/**
 * A token that expires when an existing one would, rather than starting a fresh lifetime.
 *
 * **Switching workspace must not extend a session.** Minted through `signToken` it would get a full
 * `JWT_EXPIRES_IN` every time, so somebody with two workspaces could hold an indefinite session by
 * moving between them — a renewal endpoint nobody designed. This mirrors `mintImpersonationToken`,
 * which for the same reason never issues a token outliving its approved window.
 *
 * `seconds` is what remains, and the caller is expected to have refused already if that is not
 * positive.
 */
export const signTokenFor = (
  payload: { userId: string } & Record<string, unknown>,
  seconds: number,
): string => jwt.sign(payload, env.jwt.secret, { algorithm: ALGORITHM, expiresIn: seconds });

export const verifyToken = (token: string): AccessTokenPayload => {
  const decoded = jwt.verify(token, env.jwt.secret, { algorithms: [ALGORITHM] });
  if (typeof decoded === 'string' || typeof decoded.userId !== 'string') {
    throw new jwt.JsonWebTokenError('Token payload is missing userId');
  }
  return decoded as AccessTokenPayload;
};
