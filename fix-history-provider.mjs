import fs from "node:fs";

const filePath = "server/src/history.ts";
let text = fs.readFileSync(filePath, "utf8");

const oldType = 'export type HistoryProviderId = "lingke" | "grsai";';
const newType = 'export type HistoryProviderId = "lingke" | "grsai" | "nanobanana";';

const oldProvider = 'if (value === "lingke" || value === "grsai") return value;';
const newProvider = 'if (value === "lingke" || value === "grsai" || value === "nanobanana") return value;';

if (!text.includes(oldType)) {
  throw new Error("HistoryProviderId anchor not found");
}

if (!text.includes(oldProvider)) {
  throw new Error("readProvider anchor not found");
}

text = text
  .replace(oldType, newType)
  .replace(oldProvider, newProvider);

fs.writeFileSync(filePath, text, "utf8");
console.log("history.ts repaired successfully");
