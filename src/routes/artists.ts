import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import { formatArtist, formatSong, formatAlbum } from "../lib/formatters.js";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth.js";
import { defaultSongInclude } from "./home.js";

export const artistsRouter = new Hono();

/**
 * GET /api/v1/artists
 * Returns all artists. If the authenticated user is an artist, returns their own artist record.
 */
artistsRouter.get("/", optionalAuthMiddleware, async (c) => {
  const user = c.get("user");
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "50", 10)));
  const skip = (page - 1) * limit;

  // If user is an artist and requests their own artist profile
  if (user?.isUserAnArtist && user.artistId) {
    const artist = await prisma.artist.findUnique({
      where: { id: user.artistId },
      include: {
        _count: { select: { followers: true, songs: true, albums: true } },
      },
    });

    if (artist) {
      return c.json({
        success: true,
        data: [formatArtist(artist)],
        isMyArtistProfile: true,
        pagination: { page: 1, limit: 1, total: 1, totalPages: 1 },
      });
    }
  }

  const [total, artistsRaw] = await Promise.all([
    prisma.artist.count(),
    prisma.artist.findMany({
      skip,
      take: limit,
      orderBy: { name: "asc" },
      include: {
        _count: { select: { followers: true, songs: true, albums: true } },
      },
    }),
  ]);

  return c.json({
    success: true,
    data: artistsRaw.map(formatArtist),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * Helper to find artist by ID or Name
 */
async function findArtistByIdOrName(idOrName: string) {
  const decoded = decodeURIComponent(idOrName);
  return prisma.artist.findFirst({
    where: {
      OR: [
        { id: decoded },
        { name: { equals: decoded, mode: "insensitive" as const } },
        { nameEn: { equals: decoded, mode: "insensitive" as const } },
      ],
    },
    include: {
      _count: { select: { followers: true, songs: true, albums: true } },
      albums: {
        where: { isActive: true },
        include: {
          _count: { select: { songs: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

/**
 * GET /api/v1/artists/:id
 * Fetches artist profile, follower count, list of albums, and paginated songs.
 */
artistsRouter.get("/:id", async (c) => {
  const idOrName = c.req.param("id");
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));
  const skip = (page - 1) * limit;

  const artist = await findArtistByIdOrName(idOrName);

  if (!artist) {
    return c.json({ success: false, message: "هنرمند یافت نشد." }, 404);
  }

  const songWhere = {
    isActive: true,
    isDisabled: false,
    artists: { some: { id: artist.id } },
  };

  const [totalSongs, songsRaw] = await Promise.all([
    prisma.song.count({ where: songWhere }),
    prisma.song.findMany({
      where: songWhere,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: defaultSongInclude,
    }),
  ]);

  return c.json({
    success: true,
    data: {
      artist: formatArtist(artist),
      albums: artist.albums.map(formatAlbum),
      songs: songsRaw.map(formatSong),
      pagination: {
        page,
        limit,
        total: totalSongs,
        totalPages: Math.ceil(totalSongs / limit),
      },
    },
  });
});

/**
 * GET /api/v1/artists/:id/songs
 * Returns ALL active songs for an artist (unpaginated) for instant queue playback.
 */
artistsRouter.get("/:id/songs", async (c) => {
  const idOrName = c.req.param("id");
  const artist = await findArtistByIdOrName(idOrName);

  if (!artist) {
    return c.json({ success: false, message: "هنرمند یافت نشد." }, 404);
  }

  const songs = await prisma.song.findMany({
    where: {
      isActive: true,
      isDisabled: false,
      artists: { some: { id: artist.id } },
    },
    orderBy: { createdAt: "desc" },
    include: defaultSongInclude,
  });

  return c.json({
    success: true,
    data: songs.map(formatSong),
    total: songs.length,
  });
});

/**
 * GET /api/v1/artists/:id/follow
 * Checks if current user follows this artist.
 */
artistsRouter.get("/:id/follow", authMiddleware, async (c) => {
  const user = c.get("user")!;
  const idOrName = c.req.param("id");
  const artist = await findArtistByIdOrName(idOrName);

  if (!artist) {
    return c.json({ success: false, message: "هنرمند یافت نشد." }, 404);
  }

  const follow = await prisma.follow.findUnique({
    where: {
      userId_artistId: {
        userId: user.id,
        artistId: artist.id,
      },
    },
  });

  return c.json({
    success: true,
    isFollowing: Boolean(follow),
  });
});

/**
 * POST /api/v1/artists/:id/follow
 * Toggles follow status.
 */
artistsRouter.post("/:id/follow", authMiddleware, async (c) => {
  const user = c.get("user")!;
  const idOrName = c.req.param("id");
  const artist = await findArtistByIdOrName(idOrName);

  if (!artist) {
    return c.json({ success: false, message: "هنرمند یافت نشد." }, 404);
  }

  const existingFollow = await prisma.follow.findUnique({
    where: {
      userId_artistId: {
        userId: user.id,
        artistId: artist.id,
      },
    },
  });

  if (existingFollow) {
    await prisma.follow.delete({
      where: { id: existingFollow.id },
    });
    return c.json({
      success: true,
      isFollowing: false,
      message: `دنبال کردن ${artist.name} لغو شد.`,
    });
  } else {
    await prisma.follow.create({
      data: {
        userId: user.id,
        artistId: artist.id,
      },
    });
    return c.json({
      success: true,
      isFollowing: true,
      message: `هنرمند ${artist.name} با موفقیت دنبال شد.`,
    });
  }
});
