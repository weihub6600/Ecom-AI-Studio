import { createApp } from "vue";
import App from "./App.vue";
import AdminApp from "./AdminApp.vue";
import "./style.css";
import "./admin-page.css";

const isAdminPage = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
createApp(isAdminPage ? AdminApp : App).mount("#app");
