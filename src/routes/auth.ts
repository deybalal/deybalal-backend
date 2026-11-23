import { Hono } from "hono";
import crypto from "crypto";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { authMiddleware } from "../middleware/auth.js";
import { getAssetUrl } from "../lib/cdn.js";

export const authRouter = new Hono();

// Helper to safely format User object without BigInt issues
function formatSafeUser(user: any) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    userSlug: user.userSlug,
    userIndex: user.userIndex,
    image: getAssetUrl(user.image),
    bio: user.bio,
    role: user.role,
    isVerified: user.isVerified,
    isUserAnArtist: user.isUserAnArtist,
    artistId: user.artistId,
    instagramHandle: user.instagramHandle,
    telegramId: user.telegramId ? user.telegramId.toString() : null,
    telegramUsername: user.telegramUsername,
    telegramFirstName: user.telegramFirstName,
    telegramLastName: user.telegramLastName,
    downloadPreference: user.downloadPreference,
    createdAt: user.createdAt ? new Date(user.createdAt).getTime() : 0,
  };
}

/**
 * POST /api/v1/auth/telegram/create
 * Generates a one-time verification token valid for 5 minutes.
 */
authRouter.post("/telegram/create", async (c) => {
  const token = crypto.randomBytes(24).toString("hex"); // 48-character hex
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  await prisma.verification.create({
    data: {
      id: crypto.randomUUID(),
      identifier: token,
      value: JSON.stringify({ status: "PENDING" }),
      expiresAt,
    },
  });

  const botUsername = env.TELEGRAM_BOT_USERNAME;
  const startParam = `login_${token}`;
  const botUrl = `https://t.me/${botUsername}?start=${startParam}`;
  const deepLink = `tg://resolve?domain=${botUsername}&start=${startParam}`;

  return c.json({
    success: true,
    token,
    botUsername,
    botUrl,
    deepLink,
    expiresAt: expiresAt.toISOString(),
  });
});

/**
 * GET /api/v1/auth/telegram/status?token=...
 * Polled by the mobile app until the user authorizes via the bot.
 */
authRouter.get("/telegram/status", async (c) => {
  const token = c.req.query("token");
  if (!token) {
    return c.json({ success: false, message: "پارامتر token ارسال نشده است." }, 400);
  }

  const verification = await prisma.verification.findFirst({
    where: { identifier: token },
  });

  if (!verification) {
    return c.json({ success: false, status: "NOT_FOUND", message: "توکن یافت نشد." }, 404);
  }

  if (new Date() > verification.expiresAt) {
    return c.json({ success: false, status: "EXPIRED", message: "توکن منقضی شده است." }, 410);
  }

  try {
    const data = JSON.parse(verification.value);
    if (data.status === "APPROVED" && data.sessionToken) {
      const user = await prisma.user.findUnique({
        where: { id: data.userId },
      });

      if (!user || user.isBanned) {
        return c.json({ success: false, message: "کاربر مسدود است یا یافت نشد." }, 403);
      }

      return c.json({
        success: true,
        status: "APPROVED",
        sessionToken: data.sessionToken,
        user: {
          id: user.id,
          name: user.name,
          userSlug: user.userSlug,
          image: getAssetUrl(user.image),
        },
        downloadPreference: user.downloadPreference,
      });
    }

    return c.json({
      success: true,
      status: "PENDING",
    });
  } catch {
    return c.json({ success: false, status: "ERROR", message: "داده‌های نشست نامعتبر است." }, 500);
  }
});

const telegramVerifySchema = z.object({
  token: z.string().min(1),
  telegramUser: z.object({
    id: z.union([z.number(), z.string()]),
    first_name: z.string().optional().nullable(),
    last_name: z.string().optional().nullable(),
    username: z.string().optional().nullable(),
    photo_url: z.string().optional().nullable(),
  }),
});

/**
 * POST /api/v1/auth/telegram/verify
 * Called by the Telegram Bot webhook to verify login.
 */
authRouter.post(
  "/telegram/verify",
  zValidator("json", telegramVerifySchema),
  async (c) => {
    if (env.TELEGRAM_BOT_SECRET) {
      const secret = c.req.header("x-telegram-bot-secret");
      if (secret !== env.TELEGRAM_BOT_SECRET) {
        return c.json({ success: false, message: "کلید امنیتی ربات نامعتبر است." }, 403);
      }
    }

    const { token, telegramUser } = c.req.valid("json");
    const verification = await prisma.verification.findFirst({
      where: { identifier: token },
    });

    if (!verification) {
      return c.json({ success: false, message: "توکن یافت نشد." }, 404);
    }

    if (new Date() > verification.expiresAt) {
      return c.json({ success: false, message: "توکن منقضی شده است." }, 410);
    }

    const tgId = BigInt(telegramUser.id);
    let user = await prisma.user.findUnique({
      where: { telegramId: tgId },
    });

    const displayName =
      [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(" ").trim() ||
      telegramUser.username ||
      `کاربر ${telegramUser.id}`;

    if (!user) {
      const randomId = crypto.randomUUID();
      const generatedSlug = `tg_${telegramUser.username || telegramUser.id}_${crypto.randomBytes(3).toString("hex")}`;
      user = await prisma.user.create({
        data: {
          id: randomId,
          name: displayName,
          email: `${telegramUser.id}@telegram.deybalal.ir`,
          emailVerified: true,
          image: telegramUser.photo_url || null,
          telegramId: tgId,
          telegramUsername: telegramUser.username || null,
          telegramFirstName: telegramUser.first_name || null,
          telegramLastName: telegramUser.last_name || null,
          userSlug: generatedSlug,
        },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          telegramUsername: telegramUser.username || user.telegramUsername,
          telegramFirstName: telegramUser.first_name || user.telegramFirstName,
          telegramLastName: telegramUser.last_name || user.telegramLastName,
          ...(telegramUser.photo_url ? { image: telegramUser.photo_url } : {}),
        },
      });
    }

    if (user.isBanned) {
      return c.json({ success: false, message: "این حساب کاربری مسدود شده است." }, 403);
    }

    // Create session (valid for 90 days)
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const sessionExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    await prisma.session.create({
      data: {
        id: crypto.randomUUID(),
        token: sessionToken,
        userId: user.id,
        expiresAt: sessionExpiresAt,
        userAgent: c.req.header("user-agent") || null,
        ipAddress: c.req.header("x-forwarded-for") || null,
      },
    });

    // Update verification record to APPROVED
    await prisma.verification.update({
      where: { id: verification.id },
      data: {
        value: JSON.stringify({
          status: "APPROVED",
          sessionToken,
          userId: user.id,
        }),
      },
    });

    return c.json({
      success: true,
      message: "احراز هویت با موفقیت انجام شد.",
      sessionToken,
    });
  }
);

/**
 * GET /api/v1/auth/me
 * Returns authenticated user profile.
 */
authRouter.get("/me", authMiddleware, async (c) => {
  const user = c.get("user");
  return c.json({
    success: true,
    user: formatSafeUser(user),
    downloadPreference: user.downloadPreference,
  });
});

/**
 * POST /api/v1/auth/logout
 * Deletes current user session.
 */
authRouter.post("/logout", authMiddleware, async (c) => {
  const session = c.get("session");
  if (session) {
    await prisma.session.delete({
      where: { id: session.id },
    }).catch(() => null);
  }

  return c.json({
    success: true,
    message: "با موفقیت از حساب کاربری خارج شدید.",
  });
});
