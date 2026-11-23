import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.js";

export const notificationsRouter = new Hono();

/**
 * GET /api/v1/notifications
 * Returns notifications for authenticated user.
 */
notificationsRouter.get("/", authMiddleware, async (c) => {
  const user = c.get("user")!;
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));
  const skip = (page - 1) * limit;

  const where = { userId: user.id };

  const [total, unreadCount, notifications] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: user.id, isRead: false } }),
    prisma.notification.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return c.json({
    success: true,
    data: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      link: n.link,
      isRead: n.isRead,
      createdAt: n.createdAt.getTime(),
    })),
    unreadCount,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

const markNotificationSchema = z.object({
  id: z.string().optional(),
  all: z.boolean().optional(),
});

/**
 * PATCH /api/v1/notifications
 * Marks one or all notifications as read.
 */
notificationsRouter.patch(
  "/",
  authMiddleware,
  zValidator("json", markNotificationSchema),
  async (c) => {
    const user = c.get("user")!;
    const { id, all } = c.req.valid("json");

    if (all) {
      await prisma.notification.updateMany({
        where: { userId: user.id, isRead: false },
        data: { isRead: true },
      });
      return c.json({
        success: true,
        message: "تمامی اعلان‌ها به عنوان خوانده شده علامت‌گذاری شدند.",
      });
    }

    if (id) {
      await prisma.notification.updateMany({
        where: { id, userId: user.id },
        data: { isRead: true },
      });
      return c.json({
        success: true,
        message: "اعلان به عنوان خوانده شده علامت‌گذاری شد.",
      });
    }

    return c.json({ success: false, message: "شناسه اعلان یا پارامتر all ارسال نشده است." }, 400);
  }
);

/**
 * GET /api/v1/badges
 * Returns all platform badges with awarded counts.
 */
notificationsRouter.get("/badges", async (c) => {
  const badges = await prisma.badge.findMany({
    include: {
      _count: {
        select: { users: true },
      },
    },
  });

  return c.json({
    success: true,
    data: badges.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      awardedCount: b._count.users,
      createdAt: b.createdAt.getTime(),
    })),
  });
});

/**
 * GET /api/v1/users/:id/badges
 * Returns badges awarded to a specific user.
 */
notificationsRouter.get("/users/:id/badges", async (c) => {
  const userId = c.req.param("id");

  const userBadges = await prisma.userBadge.findMany({
    where: { userId },
    include: {
      badge: true,
    },
    orderBy: { awardedAt: "desc" },
  });

  return c.json({
    success: true,
    data: userBadges.map((ub) => ({
      id: ub.badge.id,
      name: ub.badge.name,
      description: ub.badge.description,
      awardedAt: ub.awardedAt.getTime(),
    })),
  });
});
