import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import { formatAlbum, formatSong } from "../lib/formatters.js";
import { defaultSongInclude } from "./home.js";

export const albumsRouter = new Hono();

/**
 * Standard include for album queries
 */
const defaultAlbumInclude = {
  artist: true,
  genres: true,
  _count: {
    select: { songs: true },
  },
};

/**
 * Helper to resolve album by ID or name
 */
async function findAlbumByIdOrName(idOrName: string) {
  const decoded = decodeURIComponent(idOrName);
  return prisma.album.findFirst({
    where: {
      OR: [
        { id: decoded },
        { name: { equals: decoded, mode: "insensitive" as const } },
      ],
      isActive: true,
    },
    include: defaultAlbumInclude,
  });
}

/**
 * GET /api/v1/albums
 * Paginated list of active albums.
 */
albumsRouter.get("/", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));
  const skip = (page - 1) * limit;

  const where = { isActive: true };

  const [total, albumsRaw] = await Promise.all([
    prisma.album.count({ where }),
    prisma.album.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        ...defaultAlbumInclude,
        songs: {
          where: { isActive: true, isDisabled: false },
          orderBy: { index: "asc" },
          include: defaultSongInclude,
        },
      },
    }),
  ]);

  return c.json({
    success: true,
    data: albumsRaw.map(formatAlbum),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * GET /api/v1/albums/:id
 * Album details with artist relation and tracks ordered by index asc.
 */
albumsRouter.get("/:id", async (c) => {
  const idOrName = c.req.param("id");
  const album = await findAlbumByIdOrName(idOrName);

  if (!album) {
    return c.json({ success: false, message: "آلبوم یافت نشد." }, 404);
  }

  const songs = await prisma.song.findMany({
    where: {
      albumId: album.id,
      isActive: true,
      isDisabled: false,
    },
    orderBy: { index: "asc" },
    include: defaultSongInclude,
  });

  return c.json({
    success: true,
    data: {
      ...formatAlbum(album),
      songs: songs.map(formatSong),
    },
  });
});

/**
 * GET /api/v1/albums/:id/songs
 * Returns ALL active tracks of the album (unpaginated) for instant queue playback.
 */
albumsRouter.get("/:id/songs", async (c) => {
  const idOrName = c.req.param("id");
  const album = await findAlbumByIdOrName(idOrName);

  if (!album) {
    return c.json({ success: false, message: "آلبوم یافت نشد." }, 404);
  }

  const songs = await prisma.song.findMany({
    where: {
      albumId: album.id,
      isActive: true,
      isDisabled: false,
    },
    orderBy: { index: "asc" },
    include: defaultSongInclude,
  });

  return c.json({
    success: true,
    data: songs.map(formatSong),
    total: songs.length,
  });
});
