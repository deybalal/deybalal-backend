import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

export const errorHandler: ErrorHandler = (err: Error, c: Context) => {
  console.error(`[Error] ${c.req.method} ${c.req.url}:`, err);

  if (err instanceof HTTPException) {
    return c.json(
      {
        success: false,
        message: err.message,
      },
      err.status
    );
  }

  if (err instanceof ZodError) {
    const messages = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    return c.json(
      {
        success: false,
        message: `خطای اعتبارسنجی: ${messages}`,
        errors: err.issues,
      },
      400
    );
  }

  const message =
    process.env.NODE_ENV === "production"
      ? "خطای داخلی سرور رخ داده است."
      : err.message || "خطای ناشناخته";

  return c.json(
    {
      success: false,
      message,
    },
    500
  );
};

export const notFoundHandler: NotFoundHandler = (c: Context) => {
  return c.json(
    {
      success: false,
      message: "مسیر مورد نظر یافت نشد.",
    },
    404
  );
};
