import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, requireRoles } from "../middleware/auth.js";
import { getAssetUrl } from "../lib/cdn.js";

export const lyricsRouter = new Hono();

const suggestSchema = z.object({
  songId: z.string().min(1),
  lyrics: z.string().optional().nullable(),
  syncedLyrics: z.string().optional().nullable(),
  type: z.enum(["LYRICS", "SYNCED"]).optional().default("LYRICS"),
  lyricsSource: z.string().optional().nullable(),
  lyricsSourceUrl: z.string().optional().nullable(),
});

/**
 * POST /api/v1/lyrics/suggest
 * Submits lyrics or synced LRC text for a song.
 */
lyricsRouter.post("/", authMiddleware, zValidator("json", suggestSchema), async (c) => {
  const user = c.get("user")!;
  const body = c.req.valid("json");

  if (!body.lyrics && !body.syncedLyrics) {
    return c.json({ success: false, message: "ارسال متن یا لیریکس همگام‌سازی شده الزامی است." }, 400);
  }

  const song = await prisma.song.findUnique({
    where: { id: body.songId },
    select: { id: true, title: true, artist: true },
  });

  if (!song) {
    return c.json({ success: false, message: "آهنگ یافت نشد." }, 404);
  }

  const suggestion = await prisma.lyricsSuggestion.create({
    data: {
      songId: song.id,
      userId: user.id,
      lyrics: body.lyrics || null,
      syncedLyrics: body.syncedLyrics || null,
      type: body.type || (body.syncedLyrics ? "SYNCED" : "LYRICS"),
      lyricsSource: body.lyricsSource || null,
      lyricsSourceUrl: body.lyricsSourceUrl || null,
      status: "PENDING",
    },
  });

  // Create notification for user
  await prisma.notification.create({
    data: {
      userId: user.id,
      type: "LYRICS_SUGGESTION",
      title: "ثبت متن آهنگ",
      message: `پیشنهاد متن شما برای آهنگ "${song.title}" با موفقیت ثبت شد و پس از بررسی اعمال خواهد شد.`,
      link: `/song/${song.id}`,
    },
  }).catch(() => null);

  return c.json(
    {
      success: true,
      message: "متن آهنگ با موفقیت ارسال شد و در انتظار تایید است.",
      data: {
        id: suggestion.id,
        status: suggestion.status,
      },
    },
    201
  );
});

/**
 * GET /api/v1/lyrics/suggestions
 * List lyrics suggestions (Admin / Moderator).
 */
lyricsRouter.get(
  "/suggestions",
  authMiddleware,
  requireRoles(["administrator", "moderator"]),
  async (c) => {
    const statusParam = c.req.query("status") as "PENDING" | "APPROVED" | "REJECTED" | undefined;
    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));
    const skip = (page - 1) * limit;

    const where = statusParam ? { status: statusParam } : { status: "PENDING" as const };

    const [total, suggestions] = await Promise.all([
      prisma.lyricsSuggestion.count({ where }),
      prisma.lyricsSuggestion.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          song: {
            select: { id: true, title: true, artist: true, coverArt: true },
          },
          user: {
            select: { id: true, name: true, userSlug: true, image: true },
          },
        },
      }),
    ]);

    return c.json({
      success: true,
      data: suggestions.map((s) => ({
        id: s.id,
        songId: s.songId,
        songTitle: s.song.title,
        artist: s.song.artist,
        coverArt: getAssetUrl(s.song.coverArt),
        user: {
          id: s.user.id,
          name: s.user.name,
          userSlug: s.user.userSlug,
          image: getAssetUrl(s.user.image),
        },
        lyrics: s.lyrics,
        syncedLyrics: s.syncedLyrics,
        type: s.type,
        status: s.status,
        lyricsSource: s.lyricsSource,
        lyricsSourceUrl: s.lyricsSourceUrl,
        createdAt: s.createdAt.getTime(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }
);

const reviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});

/**
 * PUT /api/v1/lyrics/suggestions/:id
 * Approves or rejects lyrics suggestion.
 */
lyricsRouter.put(
  "/suggestions/:id",
  authMiddleware,
  requireRoles(["administrator", "moderator"]),
  zValidator("json", reviewSchema),
  async (c) => {
    const id = c.req.param("id");
    const { status } = c.req.valid("json");

    const suggestion = await prisma.lyricsSuggestion.findUnique({
      where: { id },
      include: { song: true },
    });

    if (!suggestion) {
      return c.json({ success: false, message: "پیشنهاد مورد نظر یافت نشد." }, 404);
    }

    if (status === "APPROVED") {
      await prisma.$transaction(async (tx) => {
        // Update song lyrics
        await tx.song.update({
          where: { id: suggestion.songId },
          data: {
            ...(suggestion.lyrics ? { lyrics: suggestion.lyrics } : {}),
            ...(suggestion.syncedLyrics ? { syncedLyrics: suggestion.syncedLyrics } : {}),
            ...(suggestion.lyricsSource ? { lyricsSource: suggestion.lyricsSource } : {}),
            ...(suggestion.lyricsSourceUrl ? { lyricsSourceUrl: suggestion.lyricsSourceUrl } : {}),
          },
        });

        // Update suggestion status
        await tx.lyricsSuggestion.update({
          where: { id },
          data: { status: "APPROVED" },
        });

        // Upsert Contributor record
        const contributorType = suggestion.type === "SYNCED" ? "synced_lyrics" : "lyrics";
        const existingContributor = await tx.contributor.findUnique({
          where: {
            songId_userId_type: {
              songId: suggestion.songId,
              userId: suggestion.userId,
              type: contributorType,
            },
          },
        });

        if (!existingContributor) {
          await tx.contributor.create({
            data: {
              songId: suggestion.songId,
              userId: suggestion.userId,
              type: contributorType,
              percentage: 100,
            },
          });
        }

        // Send approval notification
        await tx.notification.create({
          data: {
            userId: suggestion.userId,
            type: "LYRICS_APPROVED",
            title: "تایید متن آهنگ",
            message: `پیشنهاد متن شما برای آهنگ "${suggestion.song.title}" تایید و اعمال شد. با تشکر از مشارکت شما!`,
            link: `/song/${suggestion.songId}`,
          },
        });
      });

      return c.json({
        success: true,
        message: "پیشنهاد متن با موفقیت تایید و روی آهنگ اعمال شد.",
      });
    } else {
      await prisma.lyricsSuggestion.update({
        where: { id },
        data: { status: "REJECTED" },
      });

      return c.json({
        success: true,
        message: "پیشنهاد متن رد شد.",
      });
    }
  }
);
