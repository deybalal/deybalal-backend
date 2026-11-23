import dotenv from "dotenv";

dotenv.config();

export const env = {
  PORT: parseInt(process.env.PORT || "4000", 10),
  NODE_ENV: process.env.NODE_ENV || "development",
  DATABASE_URL: process.env.DATABASE_URL || "",
  DOWNLOAD_HOST: process.env.DOWNLOAD_HOST || "https://dl.deybalal.ir",
  TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || "deybalalirbot",
  TELEGRAM_BOT_SECRET: process.env.TELEGRAM_BOT_SECRET || "",
};
