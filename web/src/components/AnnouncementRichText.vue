<script lang="ts">
// V14_3_1_2_2_RICHBLOCK_NARROW_FIX
import { defineComponent, h, type VNodeChild } from "vue";

type RichBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "ul" | "ol"; items: string[] };

const INLINE_PATTERN = /(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\((?:https?:\/\/|\/)[^) \n]+(?:\?[^)\n]*)?\))/gi;

export default defineComponent({
  name: "AnnouncementRichText",
  props: { content: { type: String, default: "" } },
  setup(props) {
    return () => h("div", { class: "announcement-rich-text" }, parseBlocks(props.content).map(renderBlock));
  }
});

function parseBlocks(raw: string): RichBlock[] {
  const lines = String(raw || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: RichBlock[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (listType && listItems.length) blocks.push({ type: listType, items: [...listItems] });
    listType = null;
    listItems = [];
  };

  for (const line of lines) {
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph(); flushList();
      blocks.push({ type: "heading", level: Math.min(3, heading[1]?.length || 1) as 1 | 2 | 3, text: heading[2]?.trim() || "" });
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.+)$/.exec(line);
    if (bullet) {
      flushParagraph();
      if (listType && listType !== "ul") flushList();
      listType = "ul"; listItems.push(bullet[1]?.trim() || ""); continue;
    }
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (ordered) {
      flushParagraph();
      if (listType && listType !== "ol") flushList();
      listType = "ol"; listItems.push(ordered[1]?.trim() || ""); continue;
    }
    flushList(); paragraph.push(line.trimEnd());
  }
  flushParagraph(); flushList();
  return blocks;
}

function renderBlock(block: RichBlock, index: number) {
  if (block.type === "heading") {
    const tag = block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5";
    return h(tag, { key: `heading-${index}` }, renderInline(block.text));
  }
  if (block.type === "ul" || block.type === "ol") {
    return h(block.type, { key: `list-${index}` }, block.items.map((item, itemIndex) => h("li", { key: `${index}-${itemIndex}` }, renderInline(item))));
  }
  if (block.type === "paragraph") {
    return h(
      "p",
      { key: `paragraph-${index}` },
      renderInline(block.text)
    );
  }

  return null;
}

function renderInline(raw: string): VNodeChild[] {
  const result: VNodeChild[] = [];
  let cursor = 0, tokenIndex = 0;
  INLINE_PATTERN.lastIndex = 0;
  for (let match = INLINE_PATTERN.exec(raw); match; match = INLINE_PATTERN.exec(raw)) {
    if (match.index > cursor) pushPlainText(result, raw.slice(cursor, match.index), tokenIndex++);
    const token = match[0] || "";
    if (token.startsWith("**") && token.endsWith("**")) {
      result.push(h("strong", { key: `strong-${tokenIndex++}` }, token.slice(2, -2)));
    } else {
      const linkMatch = /^\[([^\]]+)\]\((.+)\)$/.exec(token);
      if (linkMatch) {
        const label = linkMatch[1] || "", url = linkMatch[2] || "", external = /^https?:\/\//i.test(url);
        result.push(h("a", { key: `link-${tokenIndex++}`, href: url, target: external ? "_blank" : undefined, rel: external ? "noopener noreferrer" : undefined }, label));
      } else pushPlainText(result, token, tokenIndex++);
    }
    cursor = match.index + token.length;
  }
  if (cursor < raw.length) pushPlainText(result, raw.slice(cursor), tokenIndex++);
  return result;
}

function pushPlainText(output: VNodeChild[], text: string, keySeed: number) {
  const pieces = text.split("\n");
  pieces.forEach((piece, index) => {
    if (piece) output.push(piece);
    if (index < pieces.length - 1) output.push(h("br", { key: `br-${keySeed}-${index}` }));
  });
}
</script>

<style scoped>
.announcement-rich-text{display:grid;gap:12px;min-width:0;color:inherit;font:inherit;line-height:inherit;text-align:inherit;overflow-wrap:anywhere}
.announcement-rich-text p,.announcement-rich-text h3,.announcement-rich-text h4,.announcement-rich-text h5,.announcement-rich-text ul,.announcement-rich-text ol{margin:0}
.announcement-rich-text h3{margin-top:2px;font-size:1.12em;font-weight:900;line-height:1.5;color:#343949}
.announcement-rich-text h4{margin-top:1px;font-size:1.05em;font-weight:850;line-height:1.55;color:#3b4050}
.announcement-rich-text h5{font-size:1em;font-weight:800;line-height:1.6;color:#424858}
.announcement-rich-text ul,.announcement-rich-text ol{display:grid;gap:6px;padding-left:1.45em}
.announcement-rich-text li{padding-left:.15em}
.announcement-rich-text strong{font-weight:850;color:#343949}
.announcement-rich-text a{color:#6654bd;font-weight:750;text-decoration:none;border-bottom:1px solid rgba(102,84,189,.28)}
.announcement-rich-text a:hover{color:#4f3ca8;border-bottom-color:currentColor}
</style>
