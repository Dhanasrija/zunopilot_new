import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { signToken } from '../utils/jwt.js';

export const signup = asyncHandler(async (req, res) => {
  const { email, password, fullName, businessName, category, contactNumber, address, website } = req.body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw ApiError.conflict('Email already registered');

  const passwordHash = await bcrypt.hash(password, 10);
  const verifyToken = crypto.randomBytes(24).toString('hex');

  const tenant = await prisma.tenant.create({
    data: {
      businessName,
      category,
      contactNumber,
      address,
      website,
      users: {
        create: {
          email,
          passwordHash,
          fullName,
          role: 'OWNER',
          verifyToken,
        },
      },
      fallback: {
        create: { response: "Sorry, I didn't catch that. Type 'Menu' to order, or 'Agent' to speak to our team." },
      },
    },
    include: { users: true },
  });

  const user = tenant.users[0];
  const token = signToken({ userId: user.id, tenantId: tenant.id });

  res.status(201).json({
    success: true,
    data: {
      token,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, emailVerified: user.emailVerified },
      tenant: { id: tenant.id, businessName: tenant.businessName, category: tenant.category },
      // In production email this link to the user; surfaced here for dev convenience.
      verifyToken,
    },
  });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({
    where: { email },
    include: { tenant: true },
  });
  if (!user || !user.isActive) throw ApiError.unauthorized('Invalid credentials');
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw ApiError.unauthorized('Invalid credentials');

  const token = signToken({ userId: user.id, tenantId: user.tenantId });
  res.json({
    success: true,
    data: {
      token,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, emailVerified: user.emailVerified },
      tenant: { id: user.tenant.id, businessName: user.tenant.businessName, category: user.tenant.category },
    },
  });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const user = await prisma.user.findFirst({ where: { verifyToken: token } });
  if (!user) throw ApiError.badRequest('Invalid verification token');
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, verifyToken: null },
  });
  res.json({ success: true, message: 'Email verified' });
});

export const me = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      user: { id: req.user.id, email: req.user.email, fullName: req.user.fullName, role: req.user.role, emailVerified: req.user.emailVerified },
      tenant: { id: req.user.tenant.id, businessName: req.user.tenant.businessName, category: req.user.tenant.category },
    },
  });
});
