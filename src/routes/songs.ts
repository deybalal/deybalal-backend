import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma.js";
import { formatSong } from "../lib/formatters.js";
import { authMiddleware, optionalAuthMiddleware, requireRoles } from "../middleware/auth.js";
import { defaultSongInclude } from "./home.js";

export const songsRouter = new Hono();

/**
 * Parses LRC synced lyrics to extract text lines
 */
function extractLrcSnippet(syncedLyrics: string, count: number = 4): string[] {
  const lines = syncedLyrics.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    // Strip timestamp [00:00.00]
    const text = line.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, "").trim();
    if (text) {
      result.push(text);
      if (result.length >= count) break;
    }
  }
  return result;
}

/**
 * GET /api/v1/songs/top
 * Paginated top songs ordered by playCount.
 */
songsRouter.get("/top", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));
  const skip = (page - 1) * limit;

  const where = { isActive: true, isDisabled: false };

  const [total, songsRaw] = await Promise.all([
    prisma.song.count({ where }),
    prisma.song.findMany({
      where,
      skip,
      take: limit,
      orderBy: { playCount: "desc" },
      include: defaultSongInclude,
    }),
  ]);

  return c.json({
    success: true,
    data: songsRaw.map(formatSong),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * GET /api/v1/songs/featured
 * Paginated featured songs.
 */
songsRouter.get("/featured", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));
  const sortBy = (c.req.query("sortBy") || "playCount") as "playCount" | "createdAt" | "title";
  const sortOrder = (c.req.query("sortOrder") || "desc") as "asc" | "desc";
  const skip = (page - 1) * limit;

  const allowedSortFields = ["playCount", "createdAt", "title"];
  const orderField = allowedSortFields.includes(sortBy) ? sortBy : "playCount";

  const where = {
    isActive: true,
    isFeatured: true,
    isDisabled: false,
  };

  const [total, songsRaw] = await Promise.all([
    prisma.song.count({ where }),
    prisma.song.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [orderField]: sortOrder === "asc" ? "asc" : "desc" },
      include: defaultSongInclude,
    }),
  ]);

  return c.json({
    success: true,
    data: songsRaw.map(formatSong),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * GET /api/v1/songs/random
 * Returns a single random active song.
 */
songsRouter.get("/random", async (c) => {
  const count = await prisma.song.count({
    where: { isActive: true, isDisabled: false },
  });

  if (count === 0) {
    return c.json({ success: false, message: "هیچ آهنگی یافت نشد." }, 404);
  }

  const randomSkip = Math.floor(Math.random() * count);
  const song = await prisma.song.findFirst({
    where: { isActive: true, isDisabled: false },
    skip: randomSkip,
    include: defaultSongInclude,
  });

  return c.json({
    success: true,
    data: formatSong(song),
  });
});

/**
 * GET /api/v1/songs/random-synced
 * Returns a random song with synced lyrics and parsed lyrics snippet.
 */
songsRouter.get("/random-synced", async (c) => {
  const count = await prisma.song.count({
    where: {
      isActive: true,
      isDisabled: false,
      syncedLyrics: { not: null },
    },
  });

  if (count === 0) {
    return c.json({ success: false, message: "آهنگی با متن همگام‌سازی شده یافت نشد." }, 404);
  }

  const randomSkip = Math.floor(Math.random() * count);
  const song = await prisma.song.findFirst({
    where: {
      isActive: true,
      isDisabled: false,
      syncedLyrics: { not: null },
    },
    skip: randomSkip,
    include: defaultSongInclude,
  });

  const snippet = song?.syncedLyrics ? extractLrcSnippet(song.syncedLyrics, 4) : [];

  return c.json({
    success: true,
    data: {
      ...formatSong(song),
      snippet,
    },
  });
});

/**
 * GET /api/v1/songs
 * Paginated list of active songs.
 */
songsRouter.get("/", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "50", 10)));
  const skip = (page - 1) * limit;

  const where = { isActive: true, isDisabled: false };

  const [total, songsRaw] = await Promise.all([
    prisma.song.count({ where }),
    prisma.song.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: defaultSongInclude,
    }),
  ]);

  return c.json({
    success: true,
    data: songsRaw.map(formatSong),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * POST /api/v1/songs/download
 * Adds song to the user's "لیست دانلود" playlist and increments download counter.
 */
const downloadSchema = z.object({
  songId: z.string().min(1),
});

songsRouter.post("/download", authMiddleware, zValidator("json", downloadSchema), async (c) => {
  const user = c.get("user")!;
  const { songId } = c.req.valid("json");

  const song = await prisma.song.findUnique({
    where: { id: songId },
  });

  if (!song || song.isDisabled) {
    return c.json({ success: false, message: "آهنگ یافت نشد یا غیرفعال است." }, 404);
  }

  // Find or create download playlist
  const DOWNLOAD_PLAYLIST_NAME = "لیست دانلود";
  let playlist = await prisma.playlist.findFirst({
    where: {
      userId: user.id,
      isDownload: true,
    },
  });

  if (!playlist) {
    playlist = await prisma.playlist.create({
      data: {
        name: DOWNLOAD_PLAYLIST_NAME,
        description: "آهنگ‌های دانلود شده برای پخش آفلاین",
        isDownload: true,
        isPrivate: true,
        userId: user.id,
        duration: 0,
      },
    });
  }

  // Check if song is already in download playlist
  const existingItem = await prisma.playlistSong.findUnique({
    where: {
      playlistId_songId: {
        playlistId: playlist.id,
        songId: song.id,
      },
    },
  });

  if (!existingItem) {
    await prisma.$transaction([
      prisma.playlistSong.create({
        data: {
          playlistId: playlist.id,
          songId: song.id,
        },
      }),
      prisma.playlist.update({
        where: { id: playlist.id },
        data: {
          duration: { increment: song.duration },
        },
      }),
      prisma.song.update({
        where: { id: song.id },
        data: {
          downloads: { increment: 1 },
        },
      }),
    ]);
  }

  return c.json({
    success: true,
    message: "آهنگ به لیست دانلود اضافه شد.",
    playlistId: playlist.id,
  });
});

/**
 * POST /api/v1/songs/check-duplicate
 * Checks candidate songs with matching titles and durations.
 */
const checkDuplicateSchema = z.object({
  title: z.string().min(1),
  titleEn: z.string().optional(),
  duration: z.number().optional(),
  artistIds: z.array(z.string()).optional(),
});

songsRouter.post("/check-duplicate", authMiddleware, zValidator("json", checkDuplicateSchema), async (c) => {
  const { title, titleEn, duration, artistIds } = c.req.valid("json");

  const duplicates = await prisma.song.findMany({
    where: {
      OR: [
        { title: { equals: title, mode: "insensitive" as const } },
        ...(titleEn ? [{ titleEn: { equals: titleEn, mode: "insensitive" as const } }] : []),
      ],
      ...(duration ? { duration: { gte: duration - 3, lte: duration + 3 } } : {}),
      ...(artistIds && artistIds.length > 0
        ? { artists: { some: { id: { in: artistIds } } } }
        : {}),
    },
    take: 5,
    include: defaultSongInclude,
  });

  return c.json({
    success: true,
    isDuplicate: duplicates.length > 0,
    matches: duplicates.map(formatSong),
  });
});

/**
 * GET /api/v1/songs/:id
 * Detailed song information with similar songs.
 */
songsRouter.get("/:id", async (c) => {
  const idOrSlug = c.req.param("id");

  const song = await prisma.song.findFirst({
    where: {
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
      isDisabled: false,
    },
    include: {
      ...defaultSongInclude,
      similarSongs: {
        where: { isActive: true, isDisabled: false },
        take: 10,
        include: defaultSongInclude,
      },
    },
  });

  if (!song) {
    return c.json({ success: false, message: "آهنگ یافت نشد." }, 404);
  }

  const formatted = formatSong(song);
  const similarSongs = (song.similarSongs || []).map(formatSong);

  return c.json({
    success: true,
    data: {
      ...formatted,
      similarSongs,
    },
  });
});

/**
 * POST /api/v1/songs/:id/play
 * Increments playCount and records history if user is authenticated.
 */
songsRouter.post("/:id/play", optionalAuthMiddleware, async (c) => {
  const idOrSlug = c.req.param("id");
  const user = c.get("user");

  const song = await prisma.song.findFirst({
    where: {
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
    },
    select: { id: true },
  });

  if (!song) {
    return c.json({ success: false, message: "آهنگ یافت نشد." }, 404);
  }

  await prisma.song.update({
    where: { id: song.id },
    data: { playCount: { increment: 1 } },
  });

  if (user) {
    await prisma.playHistory.create({
      data: {
        userId: user.id,
        songId: song.id,
      },
    }).catch(() => null);
  }

  return c.json({ success: true });
});

/**
 * POST /api/v1/songs
 * Submit/upload new song.
 */
const createSongSchema = z.object({
  title: z.string().min(1),
  titleEn: z.string().min(1),
  artist: z.string().min(1),
  artistEn: z.string().min(1),
  albumName: z.string().optional().nullable(),
  albumId: z.string().optional().nullable(),
  coverArt: z.string().optional().nullable(),
  year: z.number().int().optional().default(0),
  duration: z.number().int().optional().default(0),
  uri: z.string().min(1),
  ogg: z.string().optional().nullable(),
  filename: z.string().optional().nullable(),
  lyrics: z.string().optional().nullable(),
  syncedLyrics: z.string().optional().nullable(),
  links: z.record(z.string(), z.any()).optional().nullable(),
  artistIds: z.array(z.string()).optional(),
  genreIds: z.array(z.string()).optional(),
  crew: z.array(z.object({ role: z.string(), name: z.string() })).optional(),
});

songsRouter.post("/", authMiddleware, zValidator("json", createSongSchema), async (c) => {
  const user = c.get("user")!;
  const body = c.req.valid("json");

  // If user is verified artist, ensure artist relation is valid
  if (user.isUserAnArtist && user.artistId) {
    if (body.artistIds && !body.artistIds.includes(user.artistId)) {
      body.artistIds.push(user.artistId);
    }
  }

  const baseSlug = `${body.artistEn.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${body.titleEn.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  let slug = baseSlug;
  const existingSlug = await prisma.song.findUnique({ where: { slug } });
  if (existingSlug) {
    slug = `${baseSlug}-${Date.now().toString(36)}`;
  }

  const highestIndex = await prisma.song.findFirst({
    orderBy: { index: "desc" },
    select: { index: true },
  });
  const nextIndex = (highestIndex?.index ?? 0) + 1;

  const newSong = await prisma.song.create({
    data: {
      slug,
      title: body.title,
      titleEn: body.titleEn,
      artist: body.artist,
      artistEn: body.artistEn,
      albumName: body.albumName || null,
      albumId: body.albumId || null,
      coverArt: body.coverArt || null,
      year: body.year || 0,
      duration: body.duration || 0,
      uri: body.uri,
      ogg: body.ogg || null,
      filename: body.filename || null,
      lyrics: body.lyrics || null,
      syncedLyrics: body.syncedLyrics || null,
      links: (body.links as any) || undefined,
      index: nextIndex,
      userId: user.id,
      isActive: user.role === "administrator" || user.role === "moderator",
      artists: body.artistIds ? { connect: body.artistIds.map((id) => ({ id })) } : undefined,
      genres: body.genreIds ? { connect: body.genreIds.map((id) => ({ id })) } : undefined,
      crew: body.crew
        ? {
            create: body.crew.map((cr) => ({
              role: cr.role,
              name: cr.name,
            })),
          }
        : undefined,
    },
    include: defaultSongInclude,
  });

  return c.json(
    {
      success: true,
      data: formatSong(newSong),
    },
    201
  );
});

/**
 * PUT /api/v1/songs/:id
 * Edit song metadata (admin/moderator).
 */
const updateSongSchema = z.object({
  title: z.string().optional(),
  titleEn: z.string().optional(),
  artist: z.string().optional(),
  artistEn: z.string().optional(),
  albumName: z.string().optional().nullable(),
  albumId: z.string().optional().nullable(),
  coverArt: z.string().optional().nullable(),
  year: z.number().int().optional(),
  duration: z.number().int().optional(),
  uri: z.string().optional(),
  ogg: z.string().optional().nullable(),
  filename: z.string().optional().nullable(),
  lyrics: z.string().optional().nullable(),
  syncedLyrics: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  links: z.record(z.string(), z.any()).optional().nullable(),
  artistIds: z.array(z.string()).optional(),
  genreIds: z.array(z.string()).optional(),
});

songsRouter.put(
  "/:id",
  authMiddleware,
  requireRoles(["administrator", "moderator"]),
  zValidator("json", updateSongSchema),
  async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const existing = await prisma.song.findUnique({ where: { id } });
    if (!existing) {
      return c.json({ success: false, message: "آهنگ یافت نشد." }, 404);
    }

    const updated = await prisma.song.update({
      where: { id },
      data: {
        ...(body.title ? { title: body.title } : {}),
        ...(body.titleEn ? { titleEn: body.titleEn } : {}),
        ...(body.artist ? { artist: body.artist } : {}),
        ...(body.artistEn ? { artistEn: body.artistEn } : {}),
        ...(body.albumName !== undefined ? { albumName: body.albumName } : {}),
        ...(body.albumId !== undefined ? { albumId: body.albumId } : {}),
        ...(body.coverArt !== undefined ? { coverArt: body.coverArt } : {}),
        ...(body.year !== undefined ? { year: body.year } : {}),
        ...(body.duration !== undefined ? { duration: body.duration } : {}),
        ...(body.uri ? { uri: body.uri } : {}),
        ...(body.ogg !== undefined ? { ogg: body.ogg } : {}),
        ...(body.filename !== undefined ? { filename: body.filename } : {}),
        ...(body.lyrics !== undefined ? { lyrics: body.lyrics } : {}),
        ...(body.syncedLyrics !== undefined ? { syncedLyrics: body.syncedLyrics } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.isFeatured !== undefined ? { isFeatured: body.isFeatured } : {}),
        ...(body.links !== undefined ? { links: (body.links as any) || undefined } : {}),
        ...(body.artistIds ? { artists: { set: body.artistIds.map((aid) => ({ id: aid })) } } : {}),
        ...(body.genreIds ? { genres: { set: body.genreIds.map((gid) => ({ id: gid })) } } : {}),
      },
      include: defaultSongInclude,
    });

    return c.json({
      success: true,
      data: formatSong(updated),
    });
  }
);

/**
 * DELETE /api/v1/songs/:id
 * Deletes record if admin, or sets isDisabled: true if moderator.
 */
songsRouter.delete(
  "/:id",
  authMiddleware,
  requireRoles(["administrator", "moderator"]),
  async (c) => {
    const id = c.req.param("id");
    const user = c.get("user")!;

    const song = await prisma.song.findUnique({ where: { id } });
    if (!song) {
      return c.json({ success: false, message: "آهنگ یافت نشد." }, 404);
    }

    if (user.role === "administrator") {
      await prisma.song.delete({ where: { id } });
      return c.json({ success: true, message: "آهنگ برای همیشه حذف شد." });
    } else {
      await prisma.song.update({
        where: { id },
        data: { isDisabled: true },
      });
      return c.json({ success: true, message: "آهنگ غیرفعال شد." });
    }
  }
);
