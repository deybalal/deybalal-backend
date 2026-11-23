import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import { formatSong } from "../lib/formatters.js";
import { defaultSongInclude } from "./home.js";

export const radioRouter = new Hono();

/**
 * GET /api/v1/radio/state
 * Returns current live radio streaming state.
 */
radioRouter.get("/state", async (c) => {
  const now = new Date();

  // Find current active radio playlist
  const playlist = await prisma.radioPlaylist.findFirst({
    where: {
      startTime: { lte: now },
    },
    orderBy: { startTime: "desc" },
    include: {
      tracks: {
        orderBy: { order: "asc" },
        include: {
          song: {
            include: defaultSongInclude,
          },
        },
      },
    },
  });

  if (!playlist || playlist.tracks.length === 0) {
    return c.json({
      success: true,
      data: {
        serverTime: now.getTime(),
        isPlaying: false,
        message: "رادیو در حال حاضر برنامه‌ای ندارد.",
      },
    });
  }

  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - playlist.startTime.getTime()) / 1000));
  const totalDuration = playlist.totalDuration || playlist.tracks.reduce((sum, t) => sum + t.duration, 0);

  if (totalDuration === 0) {
    return c.json({
      success: true,
      data: {
        serverTime: now.getTime(),
        isPlaying: false,
      },
    });
  }

  // Handle looped playback if elapsed time exceeds total duration
  const loopPosition = elapsedSeconds % totalDuration;

  let currentTrackIndex = playlist.tracks.findIndex((track) => {
    const endOffset = track.startOffset + track.duration;
    return loopPosition >= track.startOffset && loopPosition < endOffset;
  });

  if (currentTrackIndex === -1) {
    currentTrackIndex = 0;
  }

  const currentTrack = playlist.tracks[currentTrackIndex];
  const nextTrack = playlist.tracks[(currentTrackIndex + 1) % playlist.tracks.length];
  const positionInTrack = Math.max(0, loopPosition - currentTrack.startOffset);

  return c.json({
    success: true,
    data: {
      serverTime: now.getTime(),
      isPlaying: true,
      elapsedTime: elapsedSeconds,
      loopPosition,
      totalDuration,
      playlistId: playlist.id,
      playlistDate: playlist.date.toISOString(),
      currentTrack: {
        order: currentTrack.order,
        position: positionInTrack,
        duration: currentTrack.duration,
        song: formatSong(currentTrack.song),
      },
      nextTrack: nextTrack
        ? {
            order: nextTrack.order,
            duration: nextTrack.duration,
            song: formatSong(nextTrack.song),
          }
        : null,
    },
  });
});

/**
 * GET /api/v1/radio/history/today
 * Returns the list of radio tracks played earlier today.
 */
radioRouter.get("/history/today", async (c) => {
  const now = new Date();

  const playlist = await prisma.radioPlaylist.findFirst({
    where: {
      startTime: { lte: now },
    },
    orderBy: { startTime: "desc" },
    include: {
      tracks: {
        orderBy: { order: "asc" },
        include: {
          song: {
            include: defaultSongInclude,
          },
        },
      },
    },
  });

  if (!playlist) {
    return c.json({
      success: true,
      data: [],
    });
  }

  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - playlist.startTime.getTime()) / 1000));
  const totalDuration = playlist.totalDuration || 1;
  const loopPosition = elapsedSeconds % totalDuration;

  // Tracks completed before current loop position
  const playedTracks = playlist.tracks
    .filter((track) => track.startOffset + track.duration <= loopPosition)
    .map((track) => ({
      order: track.order,
      startOffset: track.startOffset,
      duration: track.duration,
      song: formatSong(track.song),
    }));

  return c.json({
    success: true,
    data: playedTracks,
  });
});

/**
 * GET /api/v1/radio/playlists
 * Historic radio playlists list.
 */
radioRouter.get("/playlists", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));
  const skip = (page - 1) * limit;

  const [total, playlists] = await Promise.all([
    prisma.radioPlaylist.count(),
    prisma.radioPlaylist.findMany({
      skip,
      take: limit,
      orderBy: { date: "desc" },
      include: {
        _count: {
          select: { tracks: true },
        },
      },
    }),
  ]);

  return c.json({
    success: true,
    data: playlists.map((p) => ({
      id: p.id,
      date: p.date.toISOString(),
      startTime: p.startTime.toISOString(),
      totalDuration: p.totalDuration,
      trackCount: p._count.tracks,
      createdAt: p.createdAt.getTime(),
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * GET /api/v1/radio/playlists/:id
 * Specific radio playlist tracks.
 */
radioRouter.get("/playlists/:id", async (c) => {
  const id = c.req.param("id");

  const playlist = await prisma.radioPlaylist.findUnique({
    where: { id },
    include: {
      tracks: {
        orderBy: { order: "asc" },
        include: {
          song: {
            include: defaultSongInclude,
          },
        },
      },
    },
  });

  if (!playlist) {
    return c.json({ success: false, message: "پلی‌لیست رادیو یافت نشد." }, 404);
  }

  return c.json({
    success: true,
    data: {
      id: playlist.id,
      date: playlist.date.toISOString(),
      startTime: playlist.startTime.toISOString(),
      totalDuration: playlist.totalDuration,
      tracks: playlist.tracks.map((t) => ({
        id: t.id,
        order: t.order,
        duration: t.duration,
        startOffset: t.startOffset,
        song: formatSong(t.song),
      })),
    },
  });
});
