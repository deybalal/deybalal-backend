import { getAssetUrl, resolveSongLinks } from "./cdn.ts";

export function formatSong(song: any) {
  if (!song) return null;
  return {
    id: song.id,
    slug: song.slug,
    title: song.title,
    titleEn: song.titleEn,
    artist: song.artist,
    artistEn: song.artistEn,
    album: song.albumName || (song.album?.name ?? null),
    albumId: song.albumId,
    coverArt: getAssetUrl(song.coverArt),
    uri: getAssetUrl(song.uri),
    ogg: song.ogg ? getAssetUrl(song.ogg) : null,
    filename: song.filename || "",
    index: song.index,
    year: song.year ? song.year.toString() : "0",
    duration: song.duration,
    playCount: song.playCount,
    downloads: song.downloads,
    lyrics: song.lyrics || null,
    syncedLyrics: song.syncedLyrics || null,
    isFeatured: song.isFeatured,
    links: resolveSongLinks(song.links),
    artists: Array.isArray(song.artists)
      ? song.artists.map((a: any) => ({
          id: a.id,
          name: a.name,
          nameEn: a.nameEn,
          image: getAssetUrl(a.image),
          isVerified: a.isVerified,
        }))
      : [],
    genres: Array.isArray(song.genres)
      ? song.genres.map((g: any) => ({
          id: g.id,
          name: g.name,
          slug: g.slug,
        }))
      : [],
    albumDetails: song.album
      ? {
          id: song.album.id,
          name: song.album.name,
          artistName: song.album.artistName,
          artistNameEn: song.album.artistNameEn,
          coverArt: getAssetUrl(song.album.coverArt),
        }
      : null,
    crew: Array.isArray(song.crew)
      ? song.crew.map((c: any) => ({
          id: c.id,
          role: c.role,
          name: c.name,
        }))
      : [],
    contributors: Array.isArray(song.contributors)
      ? song.contributors.map((c: any) => ({
          id: c.id,
          userId: c.userId,
          type: c.type,
          percentage: c.percentage,
          user: c.user
            ? {
                id: c.user.id,
                name: c.user.name,
                userSlug: c.user.userSlug,
                image: getAssetUrl(c.user.image),
              }
            : null,
        }))
      : [],
    createdAt: song.createdAt ? new Date(song.createdAt).getTime() : 0,
    updatedAt: song.updatedAt ? new Date(song.updatedAt).getTime() : 0,
  };
}

export function formatArtist(artist: any) {
  if (!artist) return null;
  return {
    id: artist.id,
    name: artist.name,
    nameEn: artist.nameEn,
    image: getAssetUrl(artist.image),
    isVerified: artist.isVerified,
    description: artist.description || null,
    ig: artist.ig || null,
    igFollowers: artist.igFollowers || 0,
    followerCount:
      artist._count?.followers ??
      (Array.isArray(artist.followers) ? artist.followers.length : 0),
    createdAt: artist.createdAt ? new Date(artist.createdAt).getTime() : 0,
    updatedAt: artist.updatedAt ? new Date(artist.updatedAt).getTime() : 0,
  };
}

export function formatAlbum(album: any) {
  if (!album) return null;
  return {
    id: album.id,
    name: album.name,
    artistName: album.artistName,
    artistNameEn: album.artistNameEn,
    coverArt: getAssetUrl(album.coverArt),
    releaseDate: album.releaseDate,
    duration: album.duration,
    isActive: album.isActive,
    isFeatured: album.isFeatured,
    artistId: album.artistId,
    artist: album.artist ? formatArtist(album.artist) : null,
    trackCount:
      album._count?.songs ??
      (Array.isArray(album.songs) ? album.songs.length : 0),
    songs: Array.isArray(album.songs) ? album.songs.map(formatSong) : undefined,
    genres: Array.isArray(album.genres)
      ? album.genres.map((g: any) => ({ id: g.id, name: g.name, slug: g.slug }))
      : [],
    createdAt: album.createdAt ? new Date(album.createdAt).getTime() : 0,
    updatedAt: album.updatedAt ? new Date(album.updatedAt).getTime() : 0,
  };
}

export function formatPlaylist(playlist: any) {
  if (!playlist) return null;
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description || null,
    coverArt: getAssetUrl(playlist.coverArt),
    duration: playlist.duration,
    isFavorite: playlist.isFavorite,
    isDownload: playlist.isDownload,
    isPrivate: playlist.isPrivate,
    userId: playlist.userId,
    user: playlist.user
      ? {
          id: playlist.user.id,
          name: playlist.user.name,
          userSlug: playlist.user.userSlug,
          image: getAssetUrl(playlist.user.image),
        }
      : null,
    trackCount:
      playlist._count?.songs ??
      (Array.isArray(playlist.songs) ? playlist.songs.length : 0),
    songs: Array.isArray(playlist.songs)
      ? playlist.songs.map((ps: any) =>
          ps.song ? formatSong(ps.song) : formatSong(ps)
        )
      : undefined,
    createdAt: playlist.createdAt ? new Date(playlist.createdAt).getTime() : 0,
    updatedAt: playlist.updatedAt ? new Date(playlist.updatedAt).getTime() : 0,
  };
}
