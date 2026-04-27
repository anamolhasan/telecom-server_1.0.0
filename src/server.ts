import { Server } from "http";
import app from "./app";
import { envVars } from "./app/config/env";

let server: Server;

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

const handleShutdown = (signal: string, exitCode: number = 0): void => {
  console.log(`\n[${signal}] সার্ভার বন্ধ হচ্ছে...`);

  if (server) {
    server.close(() => {
      console.log("✅ সার্ভার সফলভাবে বন্ধ হয়েছে।");
      process.exit(exitCode);
    });

    setTimeout(() => {
      console.warn("⚠️  সময়সীমা শেষ — সার্ভার জোর করে বন্ধ করা হচ্ছে।");
      process.exit(exitCode);
    }, 10_000).unref();
  } else {
    process.exit(exitCode);
  }
};

// ─── Signal Handlers ─────────────────────────────────────────────────────────

process.on("SIGTERM", () => handleShutdown("SIGTERM", 0));
process.on("SIGINT", () => handleShutdown("SIGINT", 0));

// ─── Error Handlers ──────────────────────────────────────────────────────────

process.on("uncaughtException", (error: Error) => {
  console.error("💥 Uncaught Exception ধরা পড়েছে:", error);
  handleShutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("⚠️  Unhandled Rejection ধরা পড়েছে:", reason);
  handleShutdown("unhandledRejection", 1);
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const bootstrap = async (): Promise<void> => {
  try {
    server = app.listen(envVars.PORT, () => {
      console.log(`🚀 সার্ভার চলছে: http://localhost:${envVars.PORT}`);
    });
  } catch (error) {
    console.error("❌ সার্ভার চালু করতে সমস্যা হয়েছে:", error);
    process.exit(1);
  }
};

bootstrap().catch((error) => {
  console.error("❌ Bootstrap failed:", error);
  process.exit(1);
});
