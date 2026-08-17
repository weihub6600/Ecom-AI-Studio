import type {
  ZipTextReader
} from "./types";

export async function readSpreadsheet(
  file: File
): Promise<string[][]> {
  const lowerName =
    file.name.toLowerCase();

  if (lowerName.endsWith(".csv")) {
    return readCsvFile(file);
  }

  if (lowerName.endsWith(".xlsx")) {
    return readXlsxFile(file);
  }

  throw new Error(
    "仅支持 CSV 或 XLSX 文件"
  );
}

async function readCsvFile(
  file: File
): Promise<string[][]> {
  const bytes =
    await file.arrayBuffer();
  let text = new TextDecoder(
    "utf-8"
  ).decode(bytes);

  const replacementCount =
    (text.match(/�/g) || []).length;

  if (
    replacementCount > 2 &&
    typeof TextDecoder !== "undefined"
  ) {
    try {
      text = new TextDecoder(
        "gb18030"
      ).decode(bytes);
    } catch {
      // Keep UTF-8 output.
    }
  }

  return parseCsv(
    text.replace(/^\uFEFF/, "")
  );
}

function parseCsv(
  text: string
): string[][] {
  const output: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (
    let index = 0;
    index < text.length;
    index += 1
  ) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }

      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (
      character === "\n" ||
      character === "\r"
    ) {
      if (
        character === "\r" &&
        text[index + 1] === "\n"
      ) {
        index += 1;
      }

      row.push(field);
      output.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (
    field.length > 0 ||
    row.length > 0
  ) {
    row.push(field);
    output.push(row);
  }

  return output;
}

async function readXlsxFile(
  file: File
): Promise<string[][]> {
  const JSZip =
    (await import("jszip")).default;
  const zip =
    await JSZip.loadAsync(file);
  const workbookText =
    await readZipText(
      zip,
      "xl/workbook.xml"
    );
  const relationshipsText =
    await readZipText(
      zip,
      "xl/_rels/workbook.xml.rels"
    );
  const parser = new DOMParser();
  const workbook = parser.parseFromString(
    workbookText,
    "application/xml"
  );
  const relationships =
    parser.parseFromString(
      relationshipsText,
      "application/xml"
    );
  const firstSheet =
    workbook.getElementsByTagName(
      "sheet"
    )[0];

  if (!firstSheet) {
    throw new Error(
      "XLSX 中没有工作表"
    );
  }

  const relationshipId =
    firstSheet.getAttribute("r:id") ||
    firstSheet.getAttributeNS(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "id"
    );

  if (!relationshipId) {
    throw new Error(
      "无法读取 XLSX 工作表关系"
    );
  }

  const relationshipNodes =
    Array.from(
      relationships.getElementsByTagName(
        "Relationship"
      )
    );
  const relationship =
    relationshipNodes.find(
      (node) =>
        node.getAttribute("Id") ===
        relationshipId
    );
  const target =
    relationship?.getAttribute(
      "Target"
    );

  if (!target) {
    throw new Error(
      "无法定位 XLSX 第一张工作表"
    );
  }

  const sheetPath = normalizeZipPath(
    "xl/workbook.xml",
    target
  );
  const sheetText =
    await readZipText(
      zip,
      sheetPath
    );
  const sheet = parser.parseFromString(
    sheetText,
    "application/xml"
  );
  const sharedStrings =
    await readSharedStrings(
      zip,
      parser
    );
  const result: string[][] = [];
  const rowNodes = Array.from(
    sheet.getElementsByTagName("row")
  );

  for (const rowNode of rowNodes) {
    const values: string[] = [];
    const cells = Array.from(
      rowNode.getElementsByTagName("c")
    );

    for (const cell of cells) {
      const reference =
        cell.getAttribute("r") || "A1";
      const column =
        columnIndex(reference);
      const type =
        cell.getAttribute("t") || "";
      let value = "";

      if (type === "inlineStr") {
        value = Array.from(
          cell.getElementsByTagName("t")
        )
          .map((node) =>
            node.textContent || ""
          )
          .join("");
      } else {
        const raw =
          cell.getElementsByTagName("v")[0]
            ?.textContent || "";

        if (type === "s") {
          value =
            sharedStrings[
              Number(raw)
            ] || "";
        } else if (type === "b") {
          value = raw === "1"
            ? "true"
            : "false";
        } else {
          value = raw;
        }
      }

      values[column] = value;
    }

    result.push(values);
  }

  return result;
}

async function readZipText(
  zip: ZipTextReader,
  path: string
): Promise<string> {
  const entry = zip.file(path);

  if (!entry) {
    throw new Error(
      `XLSX 缺少文件：${path}`
    );
  }

  return entry.async("string");
}

async function readSharedStrings(
  zip: ZipTextReader,
  parser: DOMParser
): Promise<string[]> {
  const entry =
    zip.file("xl/sharedStrings.xml");

  if (!entry) return [];

  const text =
    await entry.async("string");
  const document =
    parser.parseFromString(
      text,
      "application/xml"
    );

  return Array.from(
    document.getElementsByTagName("si")
  ).map((item) =>
    Array.from(
      item.getElementsByTagName("t")
    )
      .map((node) =>
        node.textContent || ""
      )
      .join("")
  );
}

function normalizeZipPath(
  baseFile: string,
  target: string
): string {
  if (target.startsWith("/")) {
    return target.slice(1);
  }

  const base = baseFile.split("/");
  base.pop();

  for (const part of target.split("/")) {
    if (
      part === "" ||
      part === "."
    ) {
      continue;
    }

    if (part === "..") {
      base.pop();
    } else {
      base.push(part);
    }
  }

  return base.join("/");
}

function columnIndex(
  reference: string
): number {
  const letters =
    reference.match(/[A-Za-z]+/)?.[0]
      .toUpperCase() || "A";
  let index = 0;

  for (const letter of letters) {
    index =
      index * 26 +
      letter.charCodeAt(0) -
      64;
  }

  return Math.max(0, index - 1);
}
