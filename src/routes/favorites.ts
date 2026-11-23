import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma.js";
import { formatSong } from "../lib/formatters.js";
import { authMiddleware } from "../middleware/auth.js";
import { defaultSongInclude } from "./home.js";

export const favoritesRouter = new Hono();

/**
 * Helper to get or create the user's favorites playlist
 */
async function getOrCreateFavoritesPlaylist(userId: string) {
  let playlist = await prisma.playlist.findFirst({
    where: {
      userId,
      isFavorite: true,
    },
  });

  if (!playlist) {
    playlist = await prisma.playlist.create({
      data: {
        name: "علاقه‌مندی‌ها",
        description: "آهنگ‌های برگزیده و مورد علاقه شما",
        isFavorite: true,
        isPrivate: true,
        userId,
        duration: 0,
      },
    });
  }

  return playlist;
}

const favoriteSongSchema = z.object({
  songId: z.string().min(1),
});

/**
 * GET /api/v1/favorites
 * Returns user's favorite songs from their isFavorite playlist.
 */
favoritesRouter.get("/", authMiddleware, async (c) => {
  const user = c.get("user")!;
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));
  const sortOrder = (c.req.query("sortOrder") || "desc") as "asc" | "desc";
  const skip = (page - 1) * limit;

  const playlist = await getOrCreateFavoritesPlaylist(user.id);

  const where = {
    playlistId: playlist.id,
    song: {
      isActive: true,
      isDisabled: false,
    },
  };

  const [total, items] = await Promise.all([
    prisma.playlistSong.count({ where }),
    prisma.playlistSong.findMany({
      where,
      skip,
      take: limit,
      orderBy: { addedAt: sortOrder === "asc" ? "asc" : "desc" },
      include: {
        song: {
          include: defaultSongInclude,
        },
      },
    }),
  ]);

  const songs = items.map((item) => formatSong(item.song));

  return c.json({
    success: true,
    data: songs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * POST /api/v1/favorites/is-favorite
 * Checks if a song is in the user's favorites.
 */
favoritesRouter.post(
  "/is-favorite",
  authMiddleware,
  zValidator("json", favoriteSongSchema),
  async (c) => {
    const user = c.get("user")!;
    const { songId } = c.req.valid("json");

    const playlist = await prisma.playlist.findFirst({
      where: {
        userId: user.id,
        isFavorite: true,
      },
      select: { id: true },
    });

    if (!playlist) {
      return c.json({ success: true, isFavorite: false });
    }

    const item = await prisma.playlistSong.findUnique({
      where: {
        playlistId_songId: {
          playlistId: playlist.id,
          songId,
        },
      },
    });

    return c.json({
      success: true,
      isFavorite: Boolean(item),
    });
  }
);

/**
 * POST /api/v1/favorites/add-song
 * Adds song to the user's favorites playlist.
 */
favoritesRouter.post(
  "/add-song",
  authMiddleware,
  zValidator("json", favoriteSongSchema),
  async (c) => {
    const user = c.get("user")!;
    const { songId } = c.req.valid("json");

    const song = await prisma.song.findUnique({
      where: { id: songId },
    });

    if (!song || song.isDisabled) {
      return c.json({ success: false, message: "آهنگ یافت نشد یا غیرفعال است." }, 404);
    }

    const playlist = await getOrCreateFavoritesPlaylist(user.id);

    const existing = await prisma.playlistSong.findUnique({
      where: {
        playlistId_songId: {
          playlistId: playlist.id,
          songId,
        },
      },
    });

    if (!existing) {
      await prisma.$transaction([
        prisma.playlistSong.create({
          data: {
            playlistId: playlist.id,
            songId,
          },
        }),
        prisma.playlist.update({
          where: { id: playlist.id },
          data: {
            duration: { increment: song.duration },
            ...(playlist.coverArt ? {} : { coverArt: song.coverArt }),
          },
        }),
      ]);
    }

    return c.json({
      success: true,
      isFavorite: true,
      message: "آهنگ به علاقه‌مندی‌ها اضافه شد.",
    });
  }
);

/**
 * POST /api/v1/favorites/remove-song
 * Removes song from the user's favorites playlist.
 */
favoritesRouter.post(
  "/remove-song",
  authMiddleware,
  zValidator("json", favoriteSongSchema),
  async (c) => {
    const user = c.get("user")!;
    const { songId } = c.req.valid("json");

    const playlist = await prisma.playlist.findFirst({
      where: {
        userId: user.id,
        isFavorite: true,
      },
    });

    if (!playlist) {
      return c.json({ success: true, isFavorite: false });
    }

    const item = await prisma.playlistSong.findUnique({
      where: {
        playlistId_songId: {
          playlistId: playlist.id,
          songId,
        },
      },
      include: { song: true },
    });

    if (item) {
      const songDuration = item.song?.duration || 0;
      await prisma.$transaction([
        prisma.playlistSong.delete({
          where: {
            playlistId_songId: {
              playlistId: playlist.id,
              songId,
            },
          },
        }),
        prisma.playlist.update({
          where: { id: playlist.id },
          data: {
            duration: Math.max(0, playlist.duration - songDuration),
          },
        }),
      ]);
    }

    return c.json({
      success: true,
      isFavorite: false,
      message: "آهنگ از لیست علاقه‌مندی‌ها حذف شد.",
    });
  }
);
