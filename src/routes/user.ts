import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma.ts";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth.ts";
import { formatPlaylist } from "../lib/formatters.ts";
import { getAssetUrl } from "../lib/cdn.ts";

export const userRouter = new Hono();

function formatUserProfile(user: any) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    userSlug: user.userSlug,
    userIndex: user.userIndex,
    image: getAssetUrl(user.image),
    bio: user.bio,
    role: user.role,
    isPrivate: user.isPrivate,
    isVerified: user.isVerified,
    isUserAnArtist: user.isUserAnArtist,
    artistId: user.artistId,
    instagramHandle: user.instagramHandle,
    sendDailyFeatured: user.sendDailyFeatured,
    downloadPreference: user.downloadPreference,
    telegramUsername: user.telegramUsername,
    createdAt: user.createdAt ? new Date(user.createdAt).getTime() : 0,
  };
}

/**
 * GET /api/v1/user/profile
 * Gets private user profile details and settings.
 */
userRouter.get("/profile", authMiddleware, async (c) => {
  const currentUser = c.get("user")!;

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    include: {
      badges: {
        include: { badge: true },
      },
      _count: {
        select: {
          playlists: true,
          follows: true,
          comments: true,
          playHistory: true,
        },
      },
    },
  });

  if (!user) {
    return c.json({ success: false, message: "کاربر یافت نشد." }, 404);
  }

  return c.json({
    success: true,
    data: {
      ...formatUserProfile(user),
      stats: {
        playlistsCount: user._count.playlists,
        followsCount: user._count.follows,
        commentsCount: user._count.comments,
        playsCount: user._count.playHistory,
      },
      badges: user.badges.map((b) => ({
        id: b.badge.id,
        name: b.badge.name,
        description: b.badge.description,
        awardedAt: b.awardedAt.getTime(),
      })),
    },
  });
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  bio: z.string().max(300).optional(),
  isPrivate: z.boolean().optional(),
  downloadPreference: z.number().int().optional(),
  instagramHandle: z.string().optional().nullable(),
  sendDailyFeatured: z.boolean().optional(),
});

/**
 * PATCH /api/v1/user/profile
 * Updates user settings.
 */
userRouter.patch(
  "/profile",
  authMiddleware,
  zValidator("json", updateProfileSchema),
  async (c) => {
    const user = c.get("user")!;
    const body = c.req.valid("json");

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.bio !== undefined ? { bio: body.bio } : {}),
        ...(body.isPrivate !== undefined ? { isPrivate: body.isPrivate } : {}),
        ...(body.downloadPreference !== undefined
          ? { downloadPreference: body.downloadPreference }
          : {}),
        ...(body.instagramHandle !== undefined
          ? { instagramHandle: body.instagramHandle }
          : {}),
        ...(body.sendDailyFeatured !== undefined
          ? { sendDailyFeatured: body.sendDailyFeatured }
          : {}),
      },
    });

    return c.json({
      success: true,
      message: "پروفایل با موفقیت بروزرسانی شد.",
      data: formatUserProfile(updated),
    });
  }
);

/**
 * GET /api/v1/users/:userSlug
 * Public user profile with public playlists and badges.
 */
userRouter.get("/:userSlug", optionalAuthMiddleware, async (c) => {
  const userSlugParam = decodeURIComponent(c.req.param("userSlug"));
  const currentUser = c.get("user");

  // Lookup by userSlug, id, or instagramHandle
  const cleanParam = userSlugParam.startsWith("@")
    ? userSlugParam.substring(1)
    : userSlugParam;

  const targetUser = await prisma.user.findFirst({
    where: {
      OR: [
        { userSlug: userSlugParam },
        { id: userSlugParam },
        { instagramHandle: cleanParam },
      ],
    },
    include: {
      badges: {
        include: { badge: true },
      },
      playlists: {
        where: {
          isPrivate: false,
        },
        include: {
          _count: { select: { songs: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      _count: {
        select: {
          playlists: { where: { isPrivate: false } },
          follows: true,
        },
      },
    },
  });

  if (!targetUser || targetUser.isBanned) {
    return c.json({ success: false, message: "کاربر یافت نشد." }, 404);
  }

  // Check privacy
  const isOwner = currentUser?.id === targetUser.id;
  if (targetUser.isPrivate && !isOwner) {
    return c.json({
      success: true,
      data: {
        id: targetUser.id,
        name: targetUser.name,
        userSlug: targetUser.userSlug,
        image: getAssetUrl(targetUser.image),
        isPrivate: true,
        isVerified: targetUser.isVerified,
        message: "این حساب کاربری خصوصی است.",
      },
    });
  }

  return c.json({
    success: true,
    data: {
      id: targetUser.id,
      name: targetUser.name,
      userSlug: targetUser.userSlug,
      userIndex: targetUser.userIndex,
      image: getAssetUrl(targetUser.image),
      bio: targetUser.bio,
      isVerified: targetUser.isVerified,
      isUserAnArtist: targetUser.isUserAnArtist,
      artistId: targetUser.artistId,
      instagramHandle: targetUser.instagramHandle,
      createdAt: targetUser.createdAt.getTime(),
      playlists: targetUser.playlists.map(formatPlaylist),
      badges: targetUser.badges.map((b) => ({
        id: b.badge.id,
        name: b.badge.name,
        description: b.badge.description,
        awardedAt: b.awardedAt.getTime(),
      })),
      stats: {
        publicPlaylistsCount: targetUser._count.playlists,
        followsCount: targetUser._count.follows,
      },
    },
  });
});
