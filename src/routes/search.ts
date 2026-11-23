import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../lib/prisma.js";
import { formatSong, formatArtist, formatAlbum, formatPlaylist } from "../lib/formatters.js";
import { calculateRelevance, normalizeSearchQuery } from "../lib/search.js";
import { defaultSongInclude } from "./home.js";

export const searchRouter = new Hono();

const searchSchema = z.object({
  query: z.string().min(1, "عبارت جستجو نمی‌تواند خالی باشد."),
  scope: z
    .object({
      type: z.enum(["artist", "album", "playlist", "radioPlaylist"]),
      id: z.string(),
    })
    .optional(),
});

async function executeSearch(query: string, scope?: { type: string; id: string }) {
  const normQuery = normalizeSearchQuery(query);

  // If scoped to a specific entity
  if (scope) {
    if (scope.type === "artist") {
      const songs = await prisma.song.findMany({
        where: {
          isActive: true,
          isDisabled: false,
          artists: { some: { id: scope.id } },
          OR: [
            { title: { contains: normQuery, mode: "insensitive" } },
            { titleEn: { contains: normQuery, mode: "insensitive" } },
            { lyrics: { contains: normQuery, mode: "insensitive" } },
          ],
        },
        take: 30,
        include: defaultSongInclude,
      });

      return {
        query,
        topResult: songs[0] ? { type: "song", data: formatSong(songs[0]) } : null,
        songs: songs.map(formatSong),
        artists: [],
        albums: [],
        playlists: [],
      };
    }

    if (scope.type === "album") {
      const songs = await prisma.song.findMany({
        where: {
          isActive: true,
          isDisabled: false,
          albumId: scope.id,
          OR: [
            { title: { contains: normQuery, mode: "insensitive" } },
            { titleEn: { contains: normQuery, mode: "insensitive" } },
          ],
        },
        take: 30,
        include: defaultSongInclude,
      });

      return {
        query,
        topResult: songs[0] ? { type: "song", data: formatSong(songs[0]) } : null,
        songs: songs.map(formatSong),
        artists: [],
        albums: [],
        playlists: [],
      };
    }

    if (scope.type === "playlist") {
      const items = await prisma.playlistSong.findMany({
        where: {
          playlistId: scope.id,
          song: {
            isActive: true,
            isDisabled: false,
            OR: [
              { title: { contains: normQuery, mode: "insensitive" } },
              { titleEn: { contains: normQuery, mode: "insensitive" } },
              { artist: { contains: normQuery, mode: "insensitive" } },
            ],
          },
        },
        take: 30,
        include: {
          song: {
            include: defaultSongInclude,
          },
        },
      });

      const songs = items.map((i) => formatSong(i.song));

      return {
        query,
        topResult: songs[0] ? { type: "song", data: songs[0] } : null,
        songs,
        artists: [],
        albums: [],
        playlists: [],
      };
    }
  }

  // Global search across songs, artists, albums, playlists
  const [songsRaw, artistsRaw, albumsRaw, playlistsRaw] = await Promise.all([
    prisma.song.findMany({
      where: {
        isActive: true,
        isDisabled: false,
        OR: [
          { title: { contains: normQuery, mode: "insensitive" } },
          { titleEn: { contains: normQuery, mode: "insensitive" } },
          { artist: { contains: normQuery, mode: "insensitive" } },
          { artistEn: { contains: normQuery, mode: "insensitive" } },
          { lyrics: { contains: normQuery, mode: "insensitive" } },
        ],
      },
      take: 25,
      include: defaultSongInclude,
    }),

    prisma.artist.findMany({
      where: {
        OR: [
          { name: { contains: normQuery, mode: "insensitive" } },
          { nameEn: { contains: normQuery, mode: "insensitive" } },
        ],
      },
      take: 10,
      include: {
        _count: { select: { followers: true, songs: true, albums: true } },
      },
    }),

    prisma.album.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: normQuery, mode: "insensitive" } },
          { artistName: { contains: normQuery, mode: "insensitive" } },
          { artistNameEn: { contains: normQuery, mode: "insensitive" } },
        ],
      },
      take: 10,
      include: {
        artist: true,
        genres: true,
        _count: { select: { songs: true } },
      },
    }),

    prisma.playlist.findMany({
      where: {
        isPrivate: false,
        OR: [
          { name: { contains: normQuery, mode: "insensitive" } },
          { description: { contains: normQuery, mode: "insensitive" } },
        ],
      },
      take: 10,
      include: {
        user: true,
        _count: { select: { songs: true } },
      },
    }),
  ]);

  // Rank songs by relevance
  const rankedSongs = songsRaw
    .map((song) => {
      const titleRel = Math.max(
        calculateRelevance(song.title, query),
        calculateRelevance(song.titleEn, query)
      );
      const artistRel = Math.max(
        calculateRelevance(song.artist, query),
        calculateRelevance(song.artistEn, query)
      );
      const score = Math.max(titleRel * 1.2, artistRel);
      return { song, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => formatSong(item.song));

  // Rank artists
  const rankedArtists = artistsRaw
    .map((artist) => {
      const score = Math.max(
        calculateRelevance(artist.name, query),
        calculateRelevance(artist.nameEn, query)
      );
      return { artist, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => formatArtist(item.artist));

  // Rank albums
  const rankedAlbums = albumsRaw
    .map((album) => {
      const score = calculateRelevance(album.name, query);
      return { album, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => formatAlbum(item.album));

  const formattedPlaylists = playlistsRaw.map(formatPlaylist);

  // Determine top result
  let topResult: { type: string; data: any } | null = null;
  const topArtistScore = artistsRaw[0] ? calculateRelevance(artistsRaw[0].name, query) : 0;
  const topSongScore = songsRaw[0] ? calculateRelevance(songsRaw[0].title, query) : 0;

  if (topArtistScore >= 85 && rankedArtists.length > 0) {
    topResult = { type: "artist", data: rankedArtists[0] };
  } else if (rankedSongs.length > 0) {
    topResult = { type: "song", data: rankedSongs[0] };
  } else if (rankedArtists.length > 0) {
    topResult = { type: "artist", data: rankedArtists[0] };
  } else if (rankedAlbums.length > 0) {
    topResult = { type: "album", data: rankedAlbums[0] };
  }

  return {
    query,
    topResult,
    songs: rankedSongs,
    artists: rankedArtists,
    albums: rankedAlbums,
    playlists: formattedPlaylists,
  };
}

/**
 * POST /api/v1/search
 * Search endpoint (body: { query, scope }).
 */
searchRouter.post("/", zValidator("json", searchSchema), async (c) => {
  const { query, scope } = c.req.valid("json");
  const results = await executeSearch(query, scope);
  return c.json({
    success: true,
    data: results,
  });
});

/**
 * GET /api/v1/search
 * Convenient GET search endpoint.
 */
searchRouter.get("/", async (c) => {
  const query = c.req.query("q") || c.req.query("query") || "";
  if (!query.trim()) {
    return c.json({ success: false, message: "عبارت جستجو ارسال نشده است." }, 400);
  }

  const scopeType = c.req.query("scopeType") as any;
  const scopeId = c.req.query("scopeId");
  const scope = scopeType && scopeId ? { type: scopeType, id: scopeId } : undefined;

  const results = await executeSearch(query, scope);
  return c.json({
    success: true,
    data: results,
  });
});
