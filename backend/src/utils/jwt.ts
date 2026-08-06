import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AccessTokenPayload extends JwtPayload {
  userId: string;
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

export const verifyToken = (token: string): AccessTokenPayload => {
  const decoded = jwt.verify(token, env.jwt.secret, { algorithms: [ALGORITHM] });
  if (typeof decoded === 'string' || typeof decoded.userId !== 'string') {
    throw new jwt.JsonWebTokenError('Token payload is missing userId');
  }
  return decoded as AccessTokenPayload;
};
