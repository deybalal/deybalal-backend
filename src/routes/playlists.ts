import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma.ts";
import { formatPlaylist, formatSong } from "../lib/formatters.ts";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth.ts";
import { defaultSongInclude } from "./home.ts";

export const playlistsRouter = new Hono();

/**
 * Standard include for playlists
 */
const defaultPlaylistInclude = {
  user: true,
  _count: {
    select: { songs: true },
  },
};

/**
 * GET /api/v1/playlists
 * Returns authenticated user's created playlists.
 */
playlistsRouter.get("/", authMiddleware, async (c) => {
  const user = c.get("user")!;
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(c.req.query("limit") || "50", 10))
  );
  const skip = (page - 1) * limit;

  const where = { userId: user.id };

  const [total, playlistsRaw] = await Promise.all([
    prisma.playlist.count({ where }),
    prisma.playlist.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: defaultPlaylistInclude,
    }),
  ]);

  return c.json({
    success: true,
    data: playlistsRaw.map(formatPlaylist),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

const createPlaylistSchema = z.object({
  name: z.string().min(1, "نام پلی‌لیست الزامی است."),
  description: z.string().optional().nullable(),
  isPrivate: z.boolean().optional().default(true),
});

/**
 * POST /api/v1/playlists
 * Creates a new playlist.
 */
playlistsRouter.post(
  "/",
  authMiddleware,
  zValidator("json", createPlaylistSchema),
  async (c) => {
    const user = c.get("user")!;
    const { name, description, isPrivate } = c.req.valid("json");

    const playlist = await prisma.playlist.create({
      data: {
        name,
        description: description || null,
        isPrivate: isPrivate ?? true,
        userId: user.id,
        duration: 0,
      },
      include: defaultPlaylistInclude,
    });

    return c.json(
      {
        success: true,
        data: formatPlaylist(playlist),
      },
      201
    );
  }
);

/**
 * GET /api/v1/playlists/:id
 * Fetches playlist details with privacy check.
 */
playlistsRouter.get("/:id", optionalAuthMiddleware, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  const playlist = await prisma.playlist.findUnique({
    where: { id },
    include: {
      ...defaultPlaylistInclude,
      songs: {
        include: {
          song: {
            include: defaultSongInclude,
          },
        },
        orderBy: { addedAt: "desc" },
      },
    },
  });

  if (!playlist) {
    return c.json({ success: false, message: "پلی‌لیست یافت نشد." }, 404);
  }

  // Privacy check
  if (playlist.isPrivate && (!user || user.id !== playlist.userId)) {
    return c.json({ success: false, message: "این پلی‌لیست خصوصی است." }, 403);
  }

  return c.json({
    success: true,
    data: formatPlaylist(playlist),
  });
});

/**
 * GET /api/v1/playlists/:id/songs
 * Returns all active songs for the playlist (unpaginated).
 */
playlistsRouter.get("/:id/songs", optionalAuthMiddleware, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  const playlist = await prisma.playlist.findUnique({
    where: { id },
    select: { id: true, isPrivate: true, userId: true },
  });

  if (!playlist) {
    return c.json({ success: false, message: "پلی‌لیست یافت نشد." }, 404);
  }

  if (playlist.isPrivate && (!user || user.id !== playlist.userId)) {
    return c.json({ success: false, message: "این پلی‌لیست خصوصی است." }, 403);
  }

  const items = await prisma.playlistSong.findMany({
    where: {
      playlistId: id,
      song: {
        isActive: true,
        isDisabled: false,
      },
    },
    orderBy: { addedAt: "desc" },
    include: {
      song: {
        include: defaultSongInclude,
      },
    },
  });

  const songs = items.map((item) => formatSong(item.song));

  return c.json({
    success: true,
    data: songs,
    total: songs.length,
  });
});

const songActionSchema = z.object({
  songId: z.string().min(1),
});

/**
 * POST /api/v1/playlists/:id/songs
 * Adds a song to playlist and updates total duration.
 */
playlistsRouter.post(
  "/:id/songs",
  authMiddleware,
  zValidator("json", songActionSchema),
  async (c) => {
    const playlistId = c.req.param("id");
    const user = c.get("user")!;
    const { songId } = c.req.valid("json");

    const playlist = await prisma.playlist.findUnique({
      where: { id: playlistId },
    });

    if (!playlist) {
      return c.json({ success: false, message: "پلی‌لیست یافت نشد." }, 404);
    }

    if (playlist.userId !== user.id) {
      return c.json(
        { success: false, message: "شما مجاز به ویرایش این پلی‌لیست نیستید." },
        403
      );
    }

    const song = await prisma.song.findUnique({
      where: { id: songId },
    });

    if (!song || song.isDisabled) {
      return c.json(
        { success: false, message: "آهنگ یافت نشد یا غیرفعال است." },
        404
      );
    }

    const existing = await prisma.playlistSong.findUnique({
      where: {
        playlistId_songId: {
          playlistId,
          songId,
        },
      },
    });

    if (existing) {
      return c.json(
        {
          success: false,
          message: "این آهنگ قبلاً در این پلی‌لیست وجود دارد.",
        },
        409
      );
    }

    await prisma.$transaction([
      prisma.playlistSong.create({
        data: {
          playlistId,
          songId,
        },
      }),
      prisma.playlist.update({
        where: { id: playlistId },
        data: {
          duration: { increment: song.duration },
          // If playlist doesn't have a cover art yet, use this song's coverArt
          ...(playlist.coverArt ? {} : { coverArt: song.coverArt }),
        },
      }),
    ]);

    return c.json({
      success: true,
      message: "آهنگ به پلی‌لیست اضافه شد.",
    });
  }
);

/**
 * DELETE /api/v1/playlists/:id/songs
 * Removes song from playlist.
 */
playlistsRouter.delete(
  "/:id/songs",
  authMiddleware,
  zValidator("json", songActionSchema),
  async (c) => {
    const playlistId = c.req.param("id");
    const user = c.get("user")!;
    const { songId } = c.req.valid("json");

    const playlist = await prisma.playlist.findUnique({
      where: { id: playlistId },
    });

    if (!playlist) {
      return c.json({ success: false, message: "پلی‌لیست یافت نشد." }, 404);
    }

    if (playlist.userId !== user.id) {
      return c.json(
        { success: false, message: "شما مجاز به ویرایش این پلی‌لیست نیستید." },
        403
      );
    }

    const item = await prisma.playlistSong.findUnique({
      where: {
        playlistId_songId: {
          playlistId,
          songId,
        },
      },
      include: { song: true },
    });

    if (!item) {
      return c.json(
        { success: false, message: "آهنگ در این پلی‌لیست وجود ندارد." },
        404
      );
    }

    const songDuration = item.song.duration || 0;
    const newDuration = Math.max(0, playlist.duration - songDuration);

    await prisma.$transaction([
      prisma.playlistSong.delete({
        where: {
          playlistId_songId: {
            playlistId,
            songId,
          },
        },
      }),
      prisma.playlist.update({
        where: { id: playlistId },
        data: { duration: newDuration },
      }),
    ]);

    return c.json({
      success: true,
      message: "آهنگ از پلی‌لیست حذف شد.",
    });
  }
);

const updatePlaylistSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional().nullable(),
  isPrivate: z.boolean().optional(),
});

/**
 * PATCH /api/v1/playlists/:id
 * Updates playlist metadata.
 */
playlistsRouter.patch(
  "/:id",
  authMiddleware,
  zValidator("json", updatePlaylistSchema),
  async (c) => {
    const id = c.req.param("id");
    const user = c.get("user")!;
    const body = c.req.valid("json");

    const playlist = await prisma.playlist.findUnique({
      where: { id },
    });

    if (!playlist) {
      return c.json({ success: false, message: "پلی‌لیست یافت نشد." }, 404);
    }

    if (playlist.userId !== user.id) {
      return c.json(
        { success: false, message: "شما مجاز به تغییر این پلی‌لیست نیستید." },
        403
      );
    }

    const updated = await prisma.playlist.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.isPrivate !== undefined ? { isPrivate: body.isPrivate } : {}),
      },
      include: defaultPlaylistInclude,
    });

    return c.json({
      success: true,
      data: formatPlaylist(updated),
    });
  }
);

/**
 * DELETE /api/v1/playlists/:id
 * Deletes playlist.
 */
playlistsRouter.delete("/:id", authMiddleware, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user")!;

  const playlist = await prisma.playlist.findUnique({
    where: { id },
  });

  if (!playlist) {
    return c.json({ success: false, message: "پلی‌لیست یافت نشد." }, 404);
  }

  if (playlist.userId !== user.id) {
    return c.json(
      { success: false, message: "شما مجاز به حذف این پلی‌لیست نیستید." },
      403
    );
  }

  await prisma.playlist.delete({
    where: { id },
  });

  return c.json({
    success: true,
    message: "پلی‌لیست با موفقیت حذف شد.",
  });
});
