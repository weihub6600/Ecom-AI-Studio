import { createApp } from "vue";
import App from "./App.vue";
import AdminApp from "./AdminApp.vue";
import AccountApp from "./AccountApp.vue";
import GalleryApp from "./GalleryApp.vue";
import "./style.css";
import "./admin-page.css";
import "./account-page.css";
import "./provider-manager.css";

const isAdminPage = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
const isAccountPage = window.location.pathname === "/account" || window.location.pathname.startsWith("/account/");
const isGalleryPage = window.location.pathname === "/gallery" || window.location.pathname.startsWith("/gallery/");
createApp(
  isAdminPage
    ? AdminApp
    : isAccountPage
      ? AccountApp
      : isGalleryPage
        ? GalleryApp
        : App
).mount("#app");
