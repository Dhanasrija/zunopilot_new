import type { Request, Response } from 'express';
import { prisma } from '../../config/prisma.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/*
 * Who tried to sign up, and how far they got.
 *
 * ── Three stages, and only two of them are durable ──────────────────────────
 *
 * 1. **Asked for a code and never entered it.** Read from `OtpChallenge`, which
 *    `sweepOtpChallenges` deletes 24 hours after a code expires — so this stage is knowable for
 *    about a day and no longer. That is stated in the payload (`abandonedWindowHours`) and on the
 *    page, because a list that quietly covers one day while looking like all time is worse than no
 *    list at all: it would read as "nobody abandoned signup last month".
 *
 * 2. **Verified a code and never filled in the profile.** Durable, and the most useful of the three:
 *    verifying creates the `User` and the workspace, so these are real rows with a phone number
 *    against them — and they are why the console's workspace list has entries with no name.
 *
 * 3. **Verified and finished.** Durable. The denominator.
 *
 * ── Why stage 1 is not simply retained for longer ───────────────────────────
 *
 * It could be — the sweep could redact the hash and keep the row. That is a decision about holding
 * the phone numbers of people who typed one and walked away, i.e. unconsented personal data with no
 * customer relationship behind it, and it is not a decision to make quietly inside a reporting
 * endpoint. So this reports what the current retention already allows, and the question is left
 * where it belongs.
 */

/** How long an unverified challenge survives: the sweep's own window. */
const ABANDONED_WINDOW_HOURS = 24;

/**
 * The signup funnel.
 *
 * Every list is capped. An operator page is for reading, and an unbounded query against a table that
 * grows with every login attempt is the kind of endpoint that is fine until the day it is not.
 */
export const listSignups = asyncHandler(async (_req: Request, res: Response) => {
  const now = new Date();

  const [expiredUnused, verifiedPhones, unfinished, finished, finishedCount] = await Promise.all([
    /*
     * Codes that expired without being entered.
     *
     * `consumedAt: null` and past expiry. A row still live is not an abandonment — that person may be
     * reading the SMS right now, and counting them would make the number depend on when you looked.
     */
    prisma.otpChallenge.findMany({
      where: {
        consumedAt: null,
        expiresAt: { lt: now },
        /*
         * Bounded here as well as by the sweep.
         *
         * The sweep is a scheduled job: if it has not run, or is behind, the table holds more than a
         * day of history and this list would silently cover a longer period than the page says it
         * does. Asserting the window in the query makes the sentence on the page true either way.
         */
        createdAt: { gte: new Date(now.getTime() - ABANDONED_WINDOW_HOURS * 3_600_000) },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { phone: true, createdAt: true, attempts: true, ip: true },
    }),

    /*
     * Phones that verified *something* inside the same window.
     *
     * Somebody who mistyped a code, let it expire, asked for another and got in has not abandoned
     * anything — but their first challenge is still sitting there unconsumed. Without this they would
     * appear in the abandoned list while being a live customer.
     */
    prisma.otpChallenge.findMany({
      where: {
        consumedAt: { not: null },
        createdAt: { gte: new Date(now.getTime() - ABANDONED_WINDOW_HOURS * 3_600_000) },
      },
      select: { phone: true },
    }),

    /*
     * Verified, and never completed the profile form.
     *
     * `onboardingCompletedAt` is what the app itself routes on — a session with it null is sent to
     * the form rather than the dashboard — so this list is exactly the set of people the product
     * considers half-signed-up, not a heuristic about missing names.
     */
    prisma.tenant.findMany({
      where: { onboardingCompletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        businessName: true,
        createdAt: true,
        isActive: true,
        // The owner's own number, which is the only way to follow one of these up. There is no
        // customer data in a workspace that never got past the form, so nothing here is masked.
        users: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { phone: true, email: true, fullName: true, country: true, createdAt: true },
        },
      },
    }),

    prisma.tenant.findMany({
      where: { onboardingCompletedAt: { not: null } },
      orderBy: { onboardingCompletedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        businessName: true,
        createdAt: true,
        onboardingCompletedAt: true,
        businessCategory: { select: { label: true } },
      },
    }),
    prisma.tenant.count({ where: { onboardingCompletedAt: { not: null } } }),
  ]);

  const verified = new Set(verifiedPhones.map((row) => row.phone));

  /*
   * One entry per phone, not per code requested.
   *
   * Somebody who asked three times and gave up is one person who did not sign up. Counting the rows
   * would report three, and the resend cooldown means a determined person generates several.
   */
  const abandoned = new Map<string, {
    phone: string; lastRequestedAt: Date; requests: number; wrongCodeAttempts: number; ip: string | null;
  }>();
  for (const row of expiredUnused) {
    if (verified.has(row.phone)) continue;
    const seen = abandoned.get(row.phone);
    if (seen) {
      seen.requests += 1;
      seen.wrongCodeAttempts += row.attempts;
      continue;
    }
    abandoned.set(row.phone, {
      phone: row.phone,
      // Rows arrive newest first, so the first one seen for a phone is its latest.
      lastRequestedAt: row.createdAt,
      requests: 1,
      wrongCodeAttempts: row.attempts,
      ip: row.ip,
    });
  }

  res.json({
    success: true,
    data: {
      /** Codes that expired unentered, within the retention window below. */
      abandonedAtCode: [...abandoned.values()],
      /**
       * How far back the list above can see.
       *
       * Sent rather than assumed by the page, so that changing the sweep changes the sentence the
       * operator reads without anybody remembering to edit it.
       */
      abandonedWindowHours: ABANDONED_WINDOW_HOURS,
      abandonedAtProfile: unfinished.map((tenant) => ({
        tenantId: tenant.id,
        businessName: tenant.businessName,
        isActive: tenant.isActive,
        verifiedAt: tenant.createdAt,
        owner: tenant.users[0] ?? null,
      })),
      completed: finished.map((tenant) => ({
        tenantId: tenant.id,
        businessName: tenant.businessName,
        category: tenant.businessCategory?.label ?? null,
        verifiedAt: tenant.createdAt,
        completedAt: tenant.onboardingCompletedAt,
      })),
      counts: {
        abandonedAtCode: abandoned.size,
        abandonedAtProfile: unfinished.length,
        completed: finishedCount,
      },
    },
  });
});
