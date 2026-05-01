import type { DeckSpec, DeckSlideSpec } from "./deckArtifacts.js";

const PX_TO_EMU = 9525;
const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;

function crc32(buf: Buffer) {
  let table = (crc32 as unknown as { table?: number[] }).table;
  if (!table) {
    table = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      return c >>> 0;
    });
    (crc32 as unknown as { table: number[] }).table = table;
  }

  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function buildZip(entries: Array<{ name: string; content: string | Buffer }>) {
  const fileRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let offset = 0;
  const stamp = dosDateTime();

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf8");
    const crc = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.dosTime, 10);
    local.writeUInt16LE(stamp.dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    fileRecords.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.dosTime, 12);
    central.writeUInt16LE(stamp.dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralRecords.push(central, name);

    offset += local.length + name.length + content.length;
  }

  const centralOffset = offset;
  const central = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...fileRecords, central, end]);
}

function xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function color(value: string) {
  return value.replace("#", "").slice(0, 6).toUpperCase() || "FFFFFF";
}

function emu(value: number) {
  return Math.round(value * PX_TO_EMU);
}

function shape(id: number, name: string, x: number, y: number, w: number, h: number, opts: {
  fill?: string;
  line?: string;
  radius?: boolean;
  text?: string;
  fontSize?: number;
  bold?: boolean;
  textColor?: string;
  fontFace?: string;
  align?: "l" | "ctr";
}) {
  const fill = opts.fill
    ? `<a:solidFill><a:srgbClr val="${color(opts.fill)}"/></a:solidFill>`
    : "<a:noFill/>";
  const line = opts.line
    ? `<a:ln w="9525"><a:solidFill><a:srgbClr val="${color(opts.line)}"/></a:solidFill></a:ln>`
    : "<a:ln><a:noFill/></a:ln>";
  const textBody = opts.text
    ? `<p:txBody><a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="${opts.align ?? "l"}"/><a:r><a:rPr lang="en-US" sz="${Math.round((opts.fontSize ?? 18) * 100)}"${opts.bold ? " b=\"1\"" : ""}><a:solidFill><a:srgbClr val="${color(opts.textColor ?? "#172033")}"/></a:solidFill><a:latin typeface="${xml(opts.fontFace ?? "Aptos")}"/></a:rPr><a:t>${xml(opts.text)}</a:t></a:r><a:endParaRPr lang="en-US" sz="${Math.round((opts.fontSize ?? 18) * 100)}"/></a:p></p:txBody>`
    : "";
  return `
    <p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>
        <a:prstGeom prst="${opts.radius ? "roundRect" : "rect"}"><a:avLst/></a:prstGeom>
        ${fill}
        ${line}
      </p:spPr>
      ${textBody}
    </p:sp>
  `;
}

function slideXml(deck: DeckSpec, slide: DeckSlideSpec, index: number) {
  const theme = deck.theme;
  const bullets = slide.body.slice(0, 5);
  let id = 2;
  const shapes: string[] = [
    shape(id++, "Background", 0, 0, SLIDE_WIDTH, SLIDE_HEIGHT, { fill: theme.background }),
    shape(id++, "Accent", 904, 0, 376, 720, { fill: theme.primary }),
    shape(id++, "Kicker", 72, 58, 310, 36, {
      fill: theme.surface,
      line: theme.primary,
      radius: true,
      text: slide.eyebrow || `Slide ${index + 1}`,
      fontSize: 12,
      bold: true,
      textColor: theme.primary,
      fontFace: theme.bodyFont
    }),
    shape(id++, "Title", 72, 124, index === 0 ? 840 : 760, index === 0 ? 170 : 124, {
      text: slide.title,
      fontSize: index === 0 ? 45 : 36,
      bold: true,
      textColor: theme.text,
      fontFace: theme.headingFont
    })
  ];

  if (slide.subtitle) {
    shapes.push(shape(id++, "Subtitle", 76, index === 0 ? 292 : 248, 740, 72, {
      text: slide.subtitle,
      fontSize: 18,
      textColor: theme.mutedText,
      fontFace: theme.bodyFont
    }));
  }

  bullets.forEach((item, itemIndex) => {
    shapes.push(shape(id++, `Point ${itemIndex + 1}`, 88, 346 + itemIndex * 58, 700, 42, {
      fill: theme.surface,
      line: theme.secondary,
      radius: true,
      text: item,
      fontSize: 17,
      textColor: theme.text,
      fontFace: theme.bodyFont
    }));
  });

  if (slide.visual && slide.visual.type !== "none") {
    const visual = slide.visual;
    const visualItems = visual.items.length > 0 ? visual.items.slice(0, 4) : [visual.title || slide.title, "Signal", "Action"];
    shapes.push(shape(id++, "Visual Canvas", 820, 126, 330, 250, {
      fill: theme.surface,
      line: theme.primary,
      radius: true
    }));
    shapes.push(shape(id++, "Visual Title", 844, 144, 282, 34, {
      fill: visual.type === "image" ? theme.secondary : theme.background,
      line: theme.secondary,
      radius: true,
      text: visual.type === "image" ? (visual.caption || visual.title || "Image asset") : (visual.title || `${visual.type} artifact`),
      fontSize: 14,
      bold: true,
      textColor: theme.primary,
      fontFace: theme.headingFont,
      align: "ctr"
    }));

    if (visual.type === "chart") {
      visualItems.forEach((item, itemIndex) => {
        shapes.push(shape(id++, `Chart Bar ${itemIndex + 1}`, 850, 198 + itemIndex * 38, 92 + itemIndex * 38, 18, {
          fill: itemIndex % 2 === 0 ? theme.primary : theme.accent,
          radius: true
        }));
        shapes.push(shape(id++, `Chart Label ${itemIndex + 1}`, 850, 218 + itemIndex * 38, 260, 20, {
          text: item,
          fontSize: 11,
          bold: true,
          textColor: theme.text,
          fontFace: theme.bodyFont
        }));
      });
    } else if (visual.type === "timeline" || visual.type === "process") {
      visualItems.forEach((item, itemIndex) => {
        const x = 850 + itemIndex * 70;
        shapes.push(shape(id++, `Step Node ${itemIndex + 1}`, x, 208, 46, 46, {
          fill: itemIndex % 2 === 0 ? theme.primary : theme.accent,
          radius: true,
          text: `${itemIndex + 1}`,
          fontSize: 16,
          bold: true,
          textColor: "#ffffff",
          fontFace: theme.headingFont,
          align: "ctr"
        }));
        if (itemIndex < visualItems.length - 1) {
          shapes.push(shape(id++, `Step Connector ${itemIndex + 1}`, x + 48, 229, 22, 4, {
            fill: theme.secondary
          }));
        }
        shapes.push(shape(id++, `Step Label ${itemIndex + 1}`, x - 6, 270, 62, 52, {
          text: item,
          fontSize: 10,
          textColor: theme.text,
          fontFace: theme.bodyFont,
          align: "ctr"
        }));
      });
    } else if (visual.type === "metrics") {
      visualItems.forEach((item, itemIndex) => {
        const x = 848 + (itemIndex % 2) * 138;
        const y = 196 + Math.floor(itemIndex / 2) * 78;
        shapes.push(shape(id++, `Metric ${itemIndex + 1}`, x, y, 120, 62, {
          fill: itemIndex % 2 === 0 ? theme.background : theme.surface,
          line: theme.secondary,
          radius: true,
          text: `${String(itemIndex + 1).padStart(2, "0")} ${item}`,
          fontSize: 11,
          bold: true,
          textColor: theme.text,
          fontFace: theme.bodyFont,
          align: "ctr"
        }));
      });
    } else if (visual.type === "illustration") {
      shapes.push(shape(id++, "Illustration Core", 874, 198, 148, 92, {
        fill: theme.primary,
        radius: true
      }));
      shapes.push(shape(id++, "Illustration Card", 1006, 220, 88, 68, {
        fill: theme.background,
        line: theme.secondary,
        radius: true,
        text: visualItems[0] ?? slide.title,
        fontSize: 10,
        bold: true,
        textColor: theme.text,
        fontFace: theme.bodyFont,
        align: "ctr"
      }));
      shapes.push(shape(id++, "Illustration Orb A", 1042, 184, 34, 34, {
        fill: theme.accent,
        radius: true
      }));
      shapes.push(shape(id++, "Illustration Orb B", 858, 304, 24, 24, {
        fill: theme.secondary,
        radius: true
      }));
      shapes.push(shape(id++, "Illustration Signal", 890, 308, 204, 8, {
        fill: theme.accent,
        radius: true
      }));
    } else if (visual.type === "image") {
      shapes.push(shape(id++, "Image Placeholder", 850, 196, 270, 138, {
        fill: theme.background,
        line: theme.secondary,
        radius: true,
        text: visual.assetId ? "Reusable image asset" : "Image composition",
        fontSize: 16,
        bold: true,
        textColor: theme.text,
        fontFace: theme.headingFont,
        align: "ctr"
      }));
    } else {
      shapes.push(shape(id++, "Diagram Center", 914, 206, 124, 52, {
        fill: theme.primary,
        radius: true,
        text: visual.title || slide.title,
        fontSize: 12,
        bold: true,
        textColor: "#ffffff",
        fontFace: theme.headingFont,
        align: "ctr"
      }));
      visualItems.forEach((item, itemIndex) => {
        const x = itemIndex % 2 === 0 ? 850 : 1010;
        const y = 292 + Math.floor(itemIndex / 2) * 42;
        shapes.push(shape(id++, `Diagram Node ${itemIndex + 1}`, x, y, 112, 30, {
          fill: theme.background,
          line: theme.secondary,
          radius: true,
          text: item,
          fontSize: 10,
          bold: true,
          textColor: theme.text,
          fontFace: theme.bodyFont,
          align: "ctr"
        }));
      });
    }

    if (visual.caption && visual.type !== "image") {
      shapes.push(shape(id++, "Visual Caption", 848, 352, 276, 32, {
        text: visual.caption,
        fontSize: 10,
        textColor: theme.mutedText,
        fontFace: theme.bodyFont
      }));
    }
  }

  if (slide.callout) {
    shapes.push(shape(id++, "Callout", 844, 466, 330, 112, {
      fill: theme.accent,
      radius: true,
      text: slide.callout,
      fontSize: 20,
      bold: true,
      textColor: "#ffffff",
      fontFace: theme.headingFont,
      align: "ctr"
    }));
  }

  shapes.push(shape(id++, "Slide Number", 1112, 640, 96, 26, {
    text: `${index + 1}/${deck.slides.length}`,
    fontSize: 12,
    bold: true,
    textColor: "#ffffff",
    fontFace: theme.bodyFont,
    align: "ctr"
  }));

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      ${shapes.join("\n")}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function slideRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;
}

function contentTypes(slideCount: number) {
  const slideOverrides = Array.from({ length: slideCount }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  ${slideOverrides}
</Types>`;
}

function presentationXml(deck: DeckSpec) {
  const slides = deck.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${slides}</p:sldIdLst>
  <p:sldSz cx="${emu(SLIDE_WIDTH)}" cy="${emu(SLIDE_HEIGHT)}" type="wide"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle/>
</p:presentation>`;
}

function presentationRels(deck: DeckSpec) {
  const slideRelsEntries = deck.slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slideRelsEntries}
  <Relationship Id="rId${deck.slides.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`;
}

export function buildDeckPptx(deck: DeckSpec) {
  const entries: Array<{ name: string; content: string | Buffer }> = [
    { name: "[Content_Types].xml", content: contentTypes(deck.slides.length) },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: "docProps/core.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(deck.title)}</dc:title><dc:creator>Agentic Designer</dc:creator><cp:lastModifiedBy>Agentic Designer</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified></cp:coreProperties>` },
    { name: "docProps/app.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Agentic Designer</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>${deck.slides.length}</Slides></Properties>` },
    { name: "ppt/presentation.xml", content: presentationXml(deck) },
    { name: "ppt/_rels/presentation.xml.rels", content: presentationRels(deck) },
    { name: "ppt/theme/theme1.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Agentic Designer"><a:themeElements><a:clrScheme name="Agentic"><a:dk1><a:srgbClr val="${color(deck.theme.text)}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="${color(deck.theme.secondary)}"/></a:dk2><a:lt2><a:srgbClr val="${color(deck.theme.background)}"/></a:lt2><a:accent1><a:srgbClr val="${color(deck.theme.primary)}"/></a:accent1><a:accent2><a:srgbClr val="${color(deck.theme.accent)}"/></a:accent2><a:accent3><a:srgbClr val="${color(deck.theme.secondary)}"/></a:accent3><a:accent4><a:srgbClr val="8EA4C8"/></a:accent4><a:accent5><a:srgbClr val="6D7E99"/></a:accent5><a:accent6><a:srgbClr val="D8DEE9"/></a:accent6><a:hlink><a:srgbClr val="${color(deck.theme.primary)}"/></a:hlink><a:folHlink><a:srgbClr val="${color(deck.theme.accent)}"/></a:folHlink></a:clrScheme><a:fontScheme name="Agentic"><a:majorFont><a:latin typeface="${xml(deck.theme.headingFont.split(",")[0] || "Aptos Display")}"/></a:majorFont><a:minorFont><a:latin typeface="${xml(deck.theme.bodyFont.split(",")[0] || "Aptos")}"/></a:minorFont></a:fontScheme><a:fmtScheme name="Agentic"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>` },
    { name: "ppt/slideMasters/slideMaster1.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>` },
    { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>` },
    { name: "ppt/slideLayouts/slideLayout1.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>` },
    { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>` },
  ];

  deck.slides.forEach((slide, index) => {
    entries.push({ name: `ppt/slides/slide${index + 1}.xml`, content: slideXml(deck, slide, index) });
    entries.push({ name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, content: slideRels() });
  });

  return buildZip(entries);
}
