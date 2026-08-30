const UI_SIZE = { width: 420, height: 560 };

figma.showUI(__html__, {
  ...UI_SIZE,
  themeColors: true,
});

function selectionSummary() {
  const selection = figma.currentPage.selection;
  return selection.map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type,
  }));
}

function sendSelection() {
  figma.ui.postMessage({
    type: "SELECTION_CHANGED",
    selection: selectionSummary(),
  });
}

function safeRead(node, key) {
  try {
    const value = node[key];
    return value === figma.mixed ? "__MIXED__" : value;
  } catch (error) {
    return undefined;
  }
}

function toPlain(value, depth = 0, seen = new WeakSet()) {
  if (value === undefined || value === null) return value;
  if (value === figma.mixed) return "__MIXED__";
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  if (typeof value === "symbol") return value.toString();
  if (typeof value !== "object") return String(value);
  if (depth > 7) return "__MAX_DEPTH__";
  if (seen.has(value)) return "__CIRCULAR__";

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => toPlain(item, depth + 1, seen));
  }

  const output = {};
  for (const key of Object.keys(value)) {
    try {
      const child = value[key];
      if (typeof child !== "function") {
        output[key] = toPlain(child, depth + 1, seen);
      }
    } catch (error) {
      output[key] = `__READ_ERROR__: ${String(error)}`;
    }
  }
  return output;
}

const SERIALIZED_PROPERTIES = [
  "visible",
  "locked",
  "opacity",
  "blendMode",
  "rotation",
  "x",
  "y",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "absoluteBoundingBox",
  "absoluteRenderBounds",
  "constraints",
  "layoutAlign",
  "layoutGrow",
  "layoutPositioning",
  "layoutMode",
  "primaryAxisAlignItems",
  "counterAxisAlignItems",
  "primaryAxisSizingMode",
  "counterAxisSizingMode",
  "itemSpacing",
  "counterAxisSpacing",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "clipsContent",
  "fills",
  "strokes",
  "strokeWeight",
  "strokeAlign",
  "strokeTopWeight",
  "strokeRightWeight",
  "strokeBottomWeight",
  "strokeLeftWeight",
  "effects",
  "cornerRadius",
  "topLeftRadius",
  "topRightRadius",
  "bottomRightRadius",
  "bottomLeftRadius",
  "characters",
  "fontName",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlignHorizontal",
  "textAlignVertical",
  "textAutoResize",
  "textCase",
  "textDecoration",
  "paragraphIndent",
  "paragraphSpacing",
  "hyperlink",
  "componentPropertyDefinitions",
  "componentProperties",
  "variantProperties",
];

async function serializeNode(node, index, total) {
  const record = {
    id: node.id,
    name: node.name,
    type: node.type,
    parentId: node.parent ? node.parent.id : null,
  };

  for (const key of SERIALIZED_PROPERTIES) {
    const value = safeRead(node, key);
    if (value !== undefined) record[key] = toPlain(value);
  }

  if (typeof node.getCSSAsync === "function") {
    try {
      record.css = await node.getCSSAsync();
    } catch (error) {
      record.cssError = String(error);
    }
  }

  if (index % 20 === 0 || index === total - 1) {
    figma.ui.postMessage({
      type: "PROGRESS",
      current: index + 1,
      total,
      nodeName: node.name,
    });
  }

  return record;
}

function flatten(root) {
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    if ("children" in node) {
      for (const child of node.children) visit(child);
    }
  };
  visit(root);
  return nodes;
}

function safeFilename(value) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "figma-selection";
}

async function exportSelection(includePreview) {
  const selection = figma.currentPage.selection;

  if (selection.length !== 1) {
    throw new Error("Select exactly one frame, section, component, or layer.");
  }

  const root = selection[0];
  const allNodes = flatten(root);
  const serializedNodes = [];

  for (let index = 0; index < allNodes.length; index += 1) {
    serializedNodes.push(await serializeNode(allNodes[index], index, allNodes.length));
  }

  let rest = null;
  let restError = null;
  try {
    rest = await root.exportAsync({ format: "JSON_REST_V1" });
  } catch (error) {
    restError = String(error);
  }

  let preview = null;
  let previewError = null;
  if (includePreview) {
    try {
      preview = await root.exportAsync({
        format: "PNG",
        constraint: { type: "SCALE", value: 1 },
      });
    } catch (error) {
      previewError = String(error);
    }
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    file: {
      name: figma.root.name,
      page: figma.currentPage.name,
    },
    selection: {
      id: root.id,
      name: root.name,
      type: root.type,
    },
    rest,
    restError,
    nodes: serializedNodes,
    previewError,
  };

  figma.ui.postMessage({
    type: "EXPORT_READY",
    filename: safeFilename(root.name),
    json: JSON.stringify(payload, null, 2),
    preview,
  });
}

figma.ui.onmessage = async (message) => {
  if (!message || message.type !== "EXPORT_SELECTION") return;

  try {
    await exportSelection(Boolean(message.includePreview));
    figma.notify("Figma data exported");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    figma.ui.postMessage({ type: "EXPORT_ERROR", detail });
    figma.notify(detail, { error: true });
  }
};

figma.on("selectionchange", sendSelection);
sendSelection();
