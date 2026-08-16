import { createApp } from "vue";
import HomeApp from "./HomeApp.vue";
import WorkspacePage from "./pages/WorkspacePage.vue";
import BatchPage from "./pages/BatchPage.vue";
import LibraryPage from "./pages/LibraryPage.vue";
import GalleryPage from "./pages/GalleryPage.vue";
import TasksPage from "./pages/TasksPage.vue";
import ToolsPage from "./pages/ToolsPage.vue";
import AdminApp from "./AdminApp.vue";
import AccountApp from "./AccountApp.vue";
import "./style.css";
import "./admin-page.css";
import "./account-page.css";
import "./provider-manager.css";
import "./platform-v15.css";
import "./platform-v15-visual-polish.css";

function normalizePath(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed || "/";
}

const path = normalizePath(window.location.pathname);

const Page =
  path === "/admin" || path.startsWith("/admin/")
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
