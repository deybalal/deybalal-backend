# Deybalal Android Backend (Hono.js + Node.js + Prisma)

Dedicated RESTful backend service for the **Deybalal Android Music App**, built with **Hono.js**, **Node.js (TypeScript)**, and **Prisma ORM** connecting to the shared PostgreSQL database.

---

## 🚀 Tech Stack

- **Framework**: [Hono.js](https://hono.dev/) with `@hono/node-server`
- **Language**: TypeScript (Node.js runtime)
- **Database ORM**: [Prisma](https://www.prisma.io/)
- **Validation**: [Zod](https://zod.dev/) with `@hono/zod-validator`
- **Authentication**: Bearer Token via `Session` model + Instant Telegram Login Bot Flow

---

## 📁 Project Structure

```
deybalal-backend/
├── prisma/
│   └── schema.prisma         # Full shared PostgreSQL database schema
├── src/
│   ├── config/
│   │   └── env.ts            # Environment variables loader
│   ├── lib/
│   │   ├── prisma.ts         # Prisma client singleton
│   │   ├── cdn.ts            # Asset URL & CDN link resolver
│   │   ├── search.ts         # Relevance scoring and search query normalizer
│   │   └── formatters.ts     # Standard formatters (Song, Artist, Album, Playlist)
│   ├── middleware/
│   │   ├── auth.ts           # Bearer token auth & role guard middlewares
│   │   └── error.ts          # Global JSON error and 404 handlers
│   ├── routes/
│   │   ├── auth.ts           # /api/v1/auth (Telegram mobile flow, /me, /logout)
│   │   ├── home.ts           # /api/v1/home, /api/v1/s/:index, /api/v1/crew/:name
│   │   ├── songs.ts          # /api/v1/songs (top, featured, random, play, upload)
│   │   ├── artists.ts        # /api/v1/artists (profile, songs, follow toggle)
│   │   ├── albums.ts         # /api/v1/albums (listing, album tracks)
│   │   ├── playlists.ts      # /api/v1/playlists (user playlists & song management)
│   │   ├── favorites.ts      # /api/v1/favorites (favorites list and toggle)
│   │   ├── genres.ts         # /api/v1/genres (genres list & songs by genre)
│   │   ├── comments.ts       # /api/v1/comments (nested comments & moderation)
│   │   ├── lyrics.ts         # /api/v1/lyrics (lyrics submission & approval)
│   │   ├── radio.ts          # /api/v1/radio (synced live stream state & history)
│   │   ├── search.ts         # /api/v1/search (multi-entity relevance search)
│   │   ├── user.ts           # /api/v1/user (private profile & public profiles)
│   │   ├── notifications.ts  # /api/v1/notifications & /api/v1/badges
│   │   └── identify.ts       # /api/v1/identify (audio recognition)
│   └── index.ts              # Hono application entry point & route mounting
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 🛠️ Getting Started

### 1. Installation

```bash
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and fill in your database credentials:

```bash
cp .env.example .env
```

Environment variables:
```env
PORT=4000
NODE_ENV=development
DATABASE_URL="postgresql://user:password@localhost:5432/deybalal?schema=public"
DOWNLOAD_HOST="https://dl.deybalal.ir"
TELEGRAM_BOT_USERNAME="deybalalirbot"
TELEGRAM_BOT_SECRET="your-telegram-bot-secret"
```

### 3. Generate Prisma Client

```bash
npx prisma generate
```

### 4. Development & Build

```bash
# Run development server with watch mode
npm run dev

# Build TypeScript to dist/
npm run build

# Start production server
npm start
```

---

## 📡 API Endpoints Overview (`/api/v1`)

| Module | Method & Route | Description |
|---|---|---|
| **Health** | `GET /` & `GET /health` | Health status and uptime |
| **Auth** | `POST /api/v1/auth/telegram/create` | Generate Telegram login deep link |
| | `GET /api/v1/auth/telegram/status?token=...` | Poll login approval status |
| | `POST /api/v1/auth/telegram/verify` | Telegram bot authorization webhook |
| | `GET /api/v1/auth/me` | Current authenticated user profile |
| | `POST /api/v1/auth/logout` | Invalidate active session |
| **Home & Feeds** | `GET /api/v1/home` | Unified home screen discovery feed |
| | `GET /api/v1/s/:index` | Short link resolver by numeric index |
| | `GET /api/v1/crew/:name` | Songs by crew member (composer, etc.) |
| **Songs** | `GET /api/v1/songs` | Paginated song catalogue |
| | `GET /api/v1/songs/top` | Most played songs feed |
| | `GET /api/v1/songs/featured` | Featured songs feed |
| | `GET /api/v1/songs/random` | Single random active song |
| | `GET /api/v1/songs/random-synced` | Random song with 4-line synced lyrics card |
| | `GET /api/v1/songs/:id` | Song details with similar songs |
| | `POST /api/v1/songs/:id/play` | Increment play count & log history |
| | `POST /api/v1/songs/download` | Add song to offline download playlist |
| | `POST /api/v1/songs/check-duplicate` | Check candidate song duplicates |
| | `POST /api/v1/songs` | Submit new song |
| | `PUT /api/v1/songs/:id` | Moderate / update song metadata |
| | `DELETE /api/v1/songs/:id` | Disable or delete song |
| **Artists** | `GET /api/v1/artists` | Artist catalogue |
| | `GET /api/v1/artists/:id` | Artist profile, albums, and paginated songs |
| | `GET /api/v1/artists/:id/songs` | Full discography for queue playback |
| | `GET /api/v1/artists/:id/follow` | Check follow status |
| | `POST /api/v1/artists/:id/follow` | Toggle artist follow |
| **Albums** | `GET /api/v1/albums` | Paginated albums catalogue |
| | `GET /api/v1/albums/:id` | Album details with tracklist |
| | `GET /api/v1/albums/:id/songs` | Album tracks for playback |
| **Playlists** | `GET /api/v1/playlists` | User created playlists |
| | `POST /api/v1/playlists` | Create new playlist |
| | `GET /api/v1/playlists/:id` | Playlist details |
| | `GET /api/v1/playlists/:id/songs` | Playlist songs for playback |
| | `POST /api/v1/playlists/:id/songs` | Add song to playlist |
| | `DELETE /api/v1/playlists/:id/songs` | Remove song from playlist |
| | `PATCH /api/v1/playlists/:id` | Update playlist metadata |
| | `DELETE /api/v1/playlists/:id` | Delete playlist |
| **Favorites** | `GET /api/v1/favorites` | User favorite songs |
| | `POST /api/v1/favorites/is-favorite` | Check favorite status |
| | `POST /api/v1/favorites/add-song` | Add song to favorites |
| | `POST /api/v1/favorites/remove-song` | Remove song from favorites |
| **Genres** | `GET /api/v1/genres` | Genres with song & album counts |
| | `GET /api/v1/genres/:slug` | Genre details, songs, and albums |
| **Comments** | `GET /api/v1/comments` | Nested comments for song or album |
| | `POST /api/v1/comments` | Post comment or reply |
| **Lyrics** | `POST /api/v1/lyrics` | Suggest lyrics / synced LRC |
| | `GET /api/v1/lyrics/suggestions` | Review pending lyrics (admin/mod) |
| | `PUT /api/v1/lyrics/suggestions/:id` | Approve or reject lyrics suggestion |
| **Live Radio** | `GET /api/v1/radio/state` | Synced live radio stream position |
| | `GET /api/v1/radio/history/today` | Tracks played earlier today |
| | `GET /api/v1/radio/playlists` | Historic radio playlists |
| | `GET /api/v1/radio/playlists/:id` | Specific radio playlist tracks |
| **Search** | `POST /api/v1/search` & `GET /api/v1/search?q=...` | Multi-entity ranked search |
| **User Profile** | `GET /api/v1/user/profile` | Private user profile |
| | `PATCH /api/v1/user/profile` | Update profile settings |
| | `GET /api/v1/users/:userSlug` | Public profile & public playlists |
| **Notifications** | `GET /api/v1/notifications` | User notifications |
| | `PATCH /api/v1/notifications` | Mark notifications as read |
| | `GET /api/v1/badges` | Platform badges |
| | `GET /api/v1/users/:id/badges` | Badges awarded to user |
| **Identification** | `POST /api/v1/identify` | Audio fingerprint matching |
