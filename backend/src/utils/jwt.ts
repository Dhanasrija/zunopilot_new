import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AccessTokenPayload extends JwtPayload {
  userId: string;
}

export const signToken = (payload: { userId: string } & Record<string, unknown>): string =>
  jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn as SignOptions['expiresIn'] });

export const verifyToken = (token: string): AccessTokenPayload => {
  const decoded = jwt.verify(token, env.jwt.secret);
  if (typeof decoded === 'string' || typeof decoded.userId !== 'string') {
    throw new jwt.JsonWebTokenError('Token payload is missing userId');
  }
  return decoded as AccessTokenPayload;
};
