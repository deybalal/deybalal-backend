import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import { formatSong, formatAlbum } from "../lib/formatters.js";
import { defaultSongInclude } from "./home.js";

export const genresRouter = new Hono();

/**
 * GET /api/v1/genres
 * Returns all genres with counts of songs and albums.
 */
genresRouter.get("/", async (c) => {
  const genres = await prisma.genre.findMany({
    orderBy: {
      songs: {
        _count: "desc",
      },
    },
    include: {
      _count: {
        select: {
          songs: true,
          albums: true,
        },
      },
    },
  });

  const data = genres.map((g) => ({
    id: g.id,
    name: g.name,
    slug: g.slug,
    songsCount: g._count.songs,
    albumsCount: g._count.albums,
    createdAt: g.createdAt.getTime(),
  }));

  return c.json({
    success: true,
    data,
  });
});

/**
 * GET /api/v1/genres/:slug
 * Returns genre details, paginated active songs, and albums under this genre.
 */
genresRouter.get("/:slug", async (c) => {
  const slug = decodeURIComponent(c.req.param("slug"));
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));
  const skip = (page - 1) * limit;

  const genre = await prisma.genre.findFirst({
    where: {
      OR: [{ slug }, { id: slug }, { name: { equals: slug, mode: "insensitive" as const } }],
    },
    include: {
      albums: {
        where: { isActive: true },
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          artist: true,
          genres: true,
          _count: { select: { songs: true } },
        },
      },
      _count: {
        select: { songs: true, albums: true },
      },
    },
  });

  if (!genre) {
    return c.json({ success: false, message: "ژانر یافت نشد." }, 404);
  }

  const songWhere = {
    isActive: true,
    isDisabled: false,
    genres: { some: { id: genre.id } },
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
      genre: {
        id: genre.id,
        name: genre.name,
        slug: genre.slug,
        songsCount: genre._count.songs,
        albumsCount: genre._count.albums,
      },
      albums: genre.albums.map(formatAlbum),
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
