import { Server } from "http";
import app from "./app";
import { envVars } from "./app/config/env";

let server: Server;

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

const handleShutdown = (signal: string, exitCode: number = 0): void => {
  console.log(`\n[${signal}] Server is shutting down...`);

  if (server) {
    server.close(() => {
      console.log("✅ Server closed gracefully.");
      process.exit(exitCode);
    });

    setTimeout(() => {
      console.warn("⚠️  Timeout reached — forcing server shutdown.");
      process.exit(exitCode);
    }, 10_000).unref();
  } else {
    process.exit(exitCode);
  }
};

// ─── Signal Handlers ─────────────────────────────────────────────────────────

process.on("SIGTERM", () => handleShutdown("SIGTERM", 0));
process.on("SIGINT",  () => handleShutdown("SIGINT",  0));

// ─── Error Handlers ──────────────────────────────────────────────────────────

process.on("uncaughtException", (error: Error) => {
  console.error("💥 Uncaught Exception detected:", error);
  handleShutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("⚠️  Unhandled Rejection detected:", reason);
  handleShutdown("unhandledRejection", 1);
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const bootstrap = async (): Promise<void> => {
  try {
    server = app.listen(envVars.PORT, () => {
      console.log(`🚀 Server is running: http://localhost:${envVars.PORT}`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

bootstrap().catch((error) => {
  console.error("❌ Bootstrap failed:", error);
  process.exit(1);
});