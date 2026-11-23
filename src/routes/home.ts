import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import { formatSong, formatAlbum, formatArtist } from "../lib/formatters.js";

export const homeRouter = new Hono();

/**
 * Standard include options for songs
 */
export const defaultSongInclude = {
  artists: true,
  genres: true,
  album: true,
  crew: true,
  contributors: {
    include: {
      user: true,
    },
  },
};

/**
 * Helper to shuffle array
 */
function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * GET /api/v1/home
 * Consolidates all discovery data for Android App home screen.
 */
homeRouter.get("/", async (c) => {
  const [featuredRaw, newSongsRaw, mostPlayedRaw, newAlbumsRaw, popularGenresRaw, radioPlaylistsRaw] =
    await Promise.all([
      // 1. Featured songs (10 songs, shuffled)
      prisma.song.findMany({
        where: { isActive: true, isFeatured: true, isDisabled: false },
        take: 30,
        orderBy: { createdAt: "desc" },
        include: defaultSongInclude,
      }),

      // 2. New songs (14 songs)
      prisma.song.findMany({
        where: { isActive: true, isDisabled: false },
        take: 14,
        orderBy: { createdAt: "desc" },
        include: defaultSongInclude,
      }),

      // 3. Most played songs (20 songs)
      prisma.song.findMany({
        where: { isActive: true, isDisabled: false },
        take: 20,
        orderBy: { playCount: "desc" },
        include: defaultSongInclude,
      }),

      // 4. New albums (10 albums)
      prisma.album.findMany({
        where: { isActive: true },
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          artist: true,
          genres: true,
          songs: {
            where: { isActive: true, isDisabled: false },
            include: defaultSongInclude,
          },
          _count: {
            select: { songs: true },
          },
        },
      }),

      // 5. Popular genres (10 genres)
      prisma.genre.findMany({
        take: 10,
        orderBy: {
          songs: {
            _count: "desc",
          },
        },
        include: {
          _count: {
            select: { songs: true, albums: true },
          },
        },
      }),

      // 6. Recent radio playlists (20 playlists)
      prisma.radioPlaylist.findMany({
        take: 20,
        orderBy: { date: "desc" },
        include: {
          _count: {
            select: { tracks: true },
          },
        },
      }),
    ]);

  // Extract top unique artists from most played songs
  const artistMap = new Map<string, any>();
  for (const song of mostPlayedRaw) {
    if (Array.isArray(song.artists)) {
      for (const artist of song.artists) {
        if (!artistMap.has(artist.id)) {
          artistMap.set(artist.id, artist);
        }
      }
    }
  }
  const mostPlayedArtists = Array.from(artistMap.values()).slice(0, 10).map(formatArtist);

  const featuredSongs = shuffleArray(featuredRaw).slice(0, 10).map(formatSong);
  const newSongs = newSongsRaw.map(formatSong);
  const mostPlayedSongs = mostPlayedRaw.map(formatSong);
  const newAlbums = newAlbumsRaw.map(formatAlbum);
  const popularGenres = popularGenresRaw.map((g) => ({
    id: g.id,
    name: g.name,
    slug: g.slug,
    songsCount: g._count.songs,
    albumsCount: g._count.albums,
  }));
  const radioPlaylists = radioPlaylistsRaw.map((rp) => ({
    id: rp.id,
    date: rp.date.toISOString(),
    startTime: rp.startTime.toISOString(),
    totalDuration: rp.totalDuration,
    trackCount: rp._count.tracks,
  }));

  return c.json({
    success: true,
    data: {
      featuredSongs,
      newSongs,
      mostPlayedSongs,
      mostPlayedArtists,
      newAlbums,
      popularGenres,
      radioPlaylists,
    },
  });
});

/**
 * GET /api/v1/s/:index
 * Short link resolver: resolves numeric song index to song ID and slug.
 */
homeRouter.get("/s/:index", async (c) => {
  const indexParam = c.req.param("index");
  const index = parseInt(indexParam, 10);

  if (isNaN(index)) {
    return c.json({ success: false, message: "شاخص آهنگ نامعتبر است." }, 400);
  }

  const song = await prisma.song.findFirst({
    where: { index, isDisabled: false },
    select: { id: true, slug: true },
  });

  if (!song) {
    return c.json({ success: false, message: "آهنگ یافت نشد." }, 404);
  }

  return c.json({
    success: true,
    data: {
      id: song.id,
      slug: song.slug,
    },
  });
});

/**
 * GET /api/v1/crew/:name
 * Returns all songs where SongCrew.name matches given person's name.
 */
homeRouter.get("/crew/:name", async (c) => {
  const name = decodeURIComponent(c.req.param("name"));
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));
  const skip = (page - 1) * limit;

  const where = {
    song: {
      isActive: true,
      isDisabled: false,
    },
    name: {
      equals: name,
      mode: "insensitive" as const,
    },
  };

  const [total, crewEntries] = await Promise.all([
    prisma.songCrew.count({ where }),
    prisma.songCrew.findMany({
      where,
      skip,
      take: limit,
      include: {
        song: {
          include: defaultSongInclude,
        },
      },
      orderBy: {
        song: {
          createdAt: "desc",
        },
      },
    }),
  ]);

  const songs = crewEntries.map((ce) => formatSong(ce.song));

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
