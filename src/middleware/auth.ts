import { createMiddleware } from "hono/factory";
import { prisma } from "../lib/prisma.ts";
import type { User, Session, Role } from "@prisma/client";

declare module "hono" {
  interface ContextVariableMap {
    user?: User;
    session?: Session;
  }
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      { success: false, message: "توکن احراز هویت ارسال نشده است." },
      401
    );
  }

  const token = authHeader.substring(7).trim();
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!session || new Date() > session.expiresAt || session.user.isBanned) {
    return c.json(
      { success: false, message: "نشست نامعتبر یا منقضی شده است." },
      401
    );
  }

  c.set("user", session.user);
  c.set("session", session);
  await next();
});

export const optionalAuthMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });
    if (session && new Date() <= session.expiresAt && !session.user.isBanned) {
      c.set("user", session.user);
      c.set("session", session);
    }
  }
  await next();
});

export const requireRoles = (roles: Role[]) =>
  createMiddleware(async (c, next) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ success: false, message: "احراز هویت الزامی است." }, 401);
    }
    if (!roles.includes(user.role)) {
      return c.json({ success: false, message: "دسترسی غیرمجاز است." }, 403);
    }
    await next();
  });
