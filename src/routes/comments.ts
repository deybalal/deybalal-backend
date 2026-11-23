import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma.ts";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth.ts";
import { getAssetUrl } from "../lib/cdn.ts";

export const commentsRouter = new Hono();

function formatComment(c: any) {
  return {
    id: c.id,
    content: c.content,
    userId: c.userId,
    userSlug: c.userSlug,
    songId: c.songId,
    albumId: c.albumId,
    postTitle: c.postTitle,
    isActive: c.isActive,
    parentId: c.parentId,
    createdAt: c.createdAt ? new Date(c.createdAt).getTime() : 0,
    user: c.user
      ? {
          id: c.user.id,
          name: c.user.name,
          userSlug: c.user.userSlug,
          image: getAssetUrl(c.user.image),
        }
      : null,
    replies: Array.isArray(c.replies) ? c.replies.map(formatComment) : [],
  };
}

/**
 * GET /api/v1/comments
 * Returns comments and nested replies.
 * Shows approved comments (isActive: true, isDeleted: false) plus the user's pending comments.
 */
commentsRouter.get("/", optionalAuthMiddleware, async (c) => {
  const user = c.get("user");
  const songId = c.req.query("songId");
  const albumId = c.req.query("albumId");

  if (!songId && !albumId) {
    return c.json(
      { success: false, message: "ارسال songId یا albumId الزامی است." },
      400
    );
  }

  const baseFilter = {
    isDeleted: false,
    ...(songId ? { songId } : {}),
    ...(albumId ? { albumId } : {}),
    parentId: null, // Only top-level comments
  };

  const visibilityCondition = user
    ? {
        OR: [{ isActive: true }, { userId: user.id }],
      }
    : { isActive: true };

  const comments = await prisma.comment.findMany({
    where: {
      ...baseFilter,
      ...visibilityCondition,
    },
    orderBy: { createdAt: "desc" },
    include: {
      user: true,
      replies: {
        where: {
          isDeleted: false,
          ...(user
            ? {
                OR: [{ isActive: true }, { userId: user.id }],
              }
            : { isActive: true }),
        },
        orderBy: { createdAt: "asc" },
        include: {
          user: true,
        },
      },
    },
  });

  return c.json({
    success: true,
    data: comments.map(formatComment),
  });
});

const createCommentSchema = z.object({
  content: z.string().min(1, "متن نظر نمی‌تواند خالی باشد.").max(1000),
  songId: z.string().optional().nullable(),
  albumId: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
});

/**
 * POST /api/v1/comments
 * Posts a new comment or reply (default isActive: false pending moderation).
 */
commentsRouter.post(
  "/",
  authMiddleware,
  zValidator("json", createCommentSchema),
  async (c) => {
    const user = c.get("user")!;
    const { content, songId, albumId, parentId } = c.req.valid("json");

    if (!songId && !albumId) {
      return c.json(
        { success: false, message: "ارسال songId یا albumId الزامی است." },
        400
      );
    }

    let postTitle = "";

    if (songId) {
      const song = await prisma.song.findUnique({
        where: { id: songId },
        select: { title: true, artist: true },
      });
      if (song) {
        postTitle = `${song.title} - ${song.artist}`;
      }
    } else if (albumId) {
      const album = await prisma.album.findUnique({
        where: { id: albumId },
        select: { name: true, artistName: true },
      });
      if (album) {
        postTitle = `${album.name} - ${album.artistName}`;
      }
    }

    // Auto-approve comments if admin or moderator
    const isAutoActive =
      user.role === "administrator" || user.role === "moderator";

    const comment = await prisma.comment.create({
      data: {
        content,
        userId: user.id,
        userSlug: user.userSlug,
        songId: songId || null,
        albumId: albumId || null,
        parentId: parentId || null,
        postTitle: postTitle || "نظر",
        isActive: isAutoActive,
      },
      include: {
        user: true,
      },
    });

    return c.json(
      {
        success: true,
        message: isAutoActive
          ? "نظر شما با موفقیت ثبت شد."
          : "نظر شما پس از بررسی و تایید مدیران نمایش داده خواهد شد.",
        data: formatComment(comment),
      },
      201
    );
  }
);
