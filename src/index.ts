import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";

// Routes
import { authRouter } from "./routes/auth.js";
import { homeRouter } from "./routes/home.js";
import { songsRouter } from "./routes/songs.js";
import { artistsRouter } from "./routes/artists.js";
import { albumsRouter } from "./routes/albums.js";
import { playlistsRouter } from "./routes/playlists.js";
import { favoritesRouter } from "./routes/favorites.js";
import { genresRouter } from "./routes/genres.js";
import { commentsRouter } from "./routes/comments.js";
import { lyricsRouter } from "./routes/lyrics.js";
import { radioRouter } from "./routes/radio.js";
import { searchRouter } from "./routes/search.js";
import { userRouter } from "./routes/user.js";
import { notificationsRouter } from "./routes/notifications.js";
import { identifyRouter } from "./routes/identify.js";

const app = new Hono();

// Global Middlewares
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-telegram-bot-secret"],
    exposeHeaders: ["Content-Length"],
    maxAge: 86400,
  })
);

// Error Handling
app.onError(errorHandler);
app.notFound(notFoundHandler);

// Health check
app.get("/", (c) => {
  return c.json({
    status: "online",
    service: "Deybalal Android Music Backend",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (c) => {
  return c.json({ status: "healthy", timestamp: Date.now() });
});

// API v1 Router
const v1 = new Hono();

// Mount individual sub-routers under /api/v1
v1.route("/auth", authRouter);
v1.route("/home", homeRouter);
v1.route("/songs", songsRouter);
v1.route("/artists", artistsRouter);
v1.route("/albums", albumsRouter);
v1.route("/playlists", playlistsRouter);
v1.route("/favorites", favoritesRouter);
v1.route("/genres", genresRouter);
v1.route("/comments", commentsRouter);
v1.route("/lyrics", lyricsRouter);
v1.route("/radio", radioRouter);
v1.route("/search", searchRouter);
v1.route("/user", userRouter);
v1.route("/notifications", notificationsRouter);
v1.route("/identify", identifyRouter);

// Specific direct routes specified in prompt.md under /api/v1
// Section 4.1: Short link resolver & crew
v1.get("/s/:index", (c) => homeRouter.fetch(c.req.raw));
v1.get("/crew/:name", (c) => homeRouter.fetch(c.req.raw));

// Section 4.13: /api/v1/users/:userSlug
v1.get("/users/:userSlug", (c) => userRouter.fetch(c.req.raw));

// Section 4.14: Platform Badges
v1.get("/badges", (c) => notificationsRouter.fetch(c.req.raw));
v1.get("/users/:id/badges", (c) => notificationsRouter.fetch(c.req.raw));

// Mount v1 router to main application
app.route("/api/v1", v1);

// Start server
serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`🎶 Deybalal Hono Backend is running on http://localhost:${info.port}`);
    console.log(`📡 API v1 Base URL: http://localhost:${info.port}/api/v1`);
  }
);

export default app;
