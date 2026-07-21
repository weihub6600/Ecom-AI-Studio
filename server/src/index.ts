import { startServer } from "./server.js";

startServer().catch((error) => {
  console.error("Failed to start Ecom AI Studio", error);
  process.exitCode = 1;
});
