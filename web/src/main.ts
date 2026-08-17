import { createApp } from "vue";
import HomeApp from "./HomeApp.vue";
import LegalPage from "./pages/LegalPage.vue";
import WorkspacePage from "./pages/WorkspacePage.vue";
import BatchPage from "./pages/BatchPage.vue";
import LibraryPage from "./pages/LibraryPage.vue";
import GalleryPage from "./pages/GalleryPage.vue";
import TasksPage from "./pages/TasksPage.vue";
import ToolsPage from "./pages/ToolsPage.vue";
import AdminApp from "./AdminApp.vue";
import AccountApp from "./AccountApp.vue";
import PlatformFeedbackHost from "./components/PlatformFeedbackHost.vue";
import "./style.css";
import "./admin-page.css";
import "./account-page.css";
import "./provider-manager.css";
import "./platform-v15.css";

function normalizePath(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed || "/";
}

const path = normalizePath(window.location.pathname);

const legalPaths = new Set([
  "/terms",
  "/privacy",
  "/ai-content",
  "/commercial-use"
]);

const Page =
  legalPaths.has(path)
    ? LegalPage
    : path === "/admin" || path.startsWith("/admin/")
    ? AdminApp
    : path === "/account" || path.startsWith("/account/")
      ? AccountApp
      : path === "/workspace" || path.startsWith("/workspace/")
        ? WorkspacePage
        : path === "/batch" || path.startsWith("/batch/")
          ? BatchPage
          : path === "/library" || path.startsWith("/library/")
            ? LibraryPage
            : path === "/gallery" || path.startsWith("/gallery/")
              ? GalleryPage
              : path === "/tasks" || path.startsWith("/tasks/")
                ? TasksPage
                : path === "/tools" || path.startsWith("/tools/")
                  ? ToolsPage
                  : HomeApp;

createApp(Page).mount("#app");

const feedbackRoot =
  document.createElement("div");

feedbackRoot.id =
  "platform-feedback-root";

document.body.appendChild(
  feedbackRoot
);

createApp(
  PlatformFeedbackHost
).mount(
  feedbackRoot
);
