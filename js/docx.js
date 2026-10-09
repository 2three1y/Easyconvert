/* Easyconvert: real Office Open XML (.docx) writer, fully offline.
   Built from the shared block model, with Word heading styles (navigable in Word's
   Navigation pane, VoiceOver's rotor and JAWS/NVDA "H"), real lists, header rows on
   tables, a monospace Code style, document title/author metadata and the language set. */
(function (EC) {
  'use strict';
  var MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  // XML 1.0 only allows these characters. Anything else (NUL, control bytes, lone surrogates) breaks Word.
  var BAD_XML = /[^\t\n\r\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;
  function clean(s) { return String(s == null ? '' : s).replace(BAD_XML, ''); }
  function x(s) { return clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  var NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

  function textRuns(text, rPr) {
    // split on newlines and tabs so they become real breaks
    var out = [];
    String(text).split('\n').forEach(function (line, i) {
      if (i) out.push('<w:r>' + rPr + '<w:br/></w:r>');
      line.split('\t').forEach(function (seg, j) {
        if (j) out.push('<w:r>' + rPr + '<w:tab/></w:r>');
        if (seg) out.push('<w:r>' + rPr + '<w:t xml:space="preserve">' + x(seg) + '</w:t></w:r>');
      });
    });
    return out.join('');
  }

  function build(blocks, meta) {
    meta = meta || {};
    var lang = meta.lang || 'en-US';
    var links = [], nums = [], body = [];
    function runsXML(text) {
      return EC.md.inline(text).map(function (r) {
        var p = '';
        if (r.bold) p += '<w:b/>';
        if (r.italic) p += '<w:i/>';
        if (r.code) p = '<w:rStyle w:val="CodeChar"/>' + p;
        if (r.href && /^(https?:|mailto:)/i.test(r.href)) {
          links.push(r.href);
          var id = 'rIdL' + links.length;
          return '<w:hyperlink r:id="' + id + '" w:history="1">' + textRuns(r.text, '<w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>') + '</w:hyperlink>';
        }
        return textRuns(r.text, p ? '<w:rPr>' + p + '</w:rPr>' : '');
      }).join('');
    }
    function para(style, inner, extraPPr) {
      return '<w:p><w:pPr>' + (style ? '<w:pStyle w:val="' + style + '"/>' : '') + (extraPPr || '') + '</w:pPr>' + inner + '</w:p>';
    }
    blocks.forEach(function (b) {
      switch (b.type) {
        case 'h': body.push(para('Heading' + Math.max(1, Math.min(6, b.level)), runsXML(b.text))); break;
        case 'code': body.push(para('Code', textRuns(b.text, ''))); break;
        case 'quote': EC.md.parse(b.text).forEach(function (q) { body.push(para('Quote', runsXML(q.text || EC.md.toText([q]).trim()))); }); break;
        case 'meta': body.push(para('Subtitle', runsXML(b.text))); break;
        case 'hr': body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="B8C5CF"/></w:pBdr></w:pPr></w:p>'); break;
        case 'list':
          var numId;
          if (b.ordered) { nums.push(nums.length + 3); numId = nums[nums.length - 1]; } else numId = 1;
          b.items.forEach(function (it) {
            body.push(para('ListParagraph', runsXML(it.text), '<w:numPr><w:ilvl w:val="' + (it.depth || 0) + '"/><w:numId w:val="' + numId + '"/></w:numPr>'));
          });
          break;
        case 'table':
          if (!b.rows.length) break;
          var cols = Math.max.apply(null, b.rows.map(function (r) { return r.length; }));
          var t = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/><w:tblLook w:val="04A0" w:firstRow="' + (b.header ? 1 : 0) + '" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>' +
            (b.caption ? '<w:tblCaption w:val="' + x(b.caption) + '"/>' : '') + '</w:tblPr><w:tblGrid>' + new Array(cols + 1).join('<w:gridCol/>') + '</w:tblGrid>';
          b.rows.forEach(function (row, ri) {
            var head = b.header && ri === 0;
            t += '<w:tr>' + (head ? '<w:trPr><w:tblHeader/></w:trPr>' : '');
            for (var c = 0; c < cols; c++) {
              var cell = row[c] == null ? '' : row[c];
              t += '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>' + para(head ? 'TableHeading' : null, runsXML(cell)) + '</w:tc>';
            }
            t += '</w:tr>';
          });
          body.push(t + '</w:tbl>', '<w:p/>');
          break;
        default: body.push(para(null, b.plain ? textRuns(b.text, '') : runsXML(b.text)));
      }
    });
    if (!body.length) body.push('<w:p/>');

    var document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ' + NS + '><w:body>' + body.join('') +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';

    var heading = function (n, size, color) {
      return '<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>' +
        '<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="' + (n === 1 ? 360 : 240) + '" w:after="120"/><w:outlineLvl w:val="' + (n - 1) + '"/></w:pPr>' +
        '<w:rPr><w:b/><w:color w:val="' + color + '"/><w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/></w:rPr></w:style>';
    };
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles ' + NS + '>' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="' + x(lang) + '" w:eastAsia="' + x(lang) + '" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      heading(1, 40, '102A43') + heading(2, 30, '075985') + heading(3, 26, '102A43') + heading(4, 24, '102A43') + heading(5, 24, '334E68') + heading(6, 22, '334E68') +
      '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="52606D"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/><w:spacing w:after="160" w:line="240" w:lineRule="auto"/><w:ind w:left="144" w:right="144"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="B8C5CF"/></w:pBdr></w:pPr><w:rPr><w:i/><w:color w:val="334E68"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="TableHeading"><w:name w:val="Table Heading"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="075985"/><w:u w:val="single"/></w:rPr></w:style>' +
      '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="B8C5CF"/><w:left w:val="single" w:sz="4" w:space="0" w:color="B8C5CF"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="B8C5CF"/><w:right w:val="single" w:sz="4" w:space="0" w:color="B8C5CF"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="B8C5CF"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="B8C5CF"/></w:tblBorders><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
      '</w:styles>';

    var lvl = function (i, fmt, text) {
      return '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + fmt + '"/><w:lvlText w:val="' + text + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + (720 + 360 * i) + '" w:hanging="360"/></w:pPr>' +
        (fmt === 'bullet' ? '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>' : '') + '</w:lvl>';
    };
    var numbering = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering ' + NS + '>' +
      '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' + [0, 1, 2, 3].map(function (i) { return lvl(i, 'bullet', '\uF0B7'); }).join('') + '</w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' + [0, 1, 2, 3].map(function (i) { return lvl(i, i % 2 ? 'lowerLetter' : 'decimal', '%' + (i + 1) + '.'); }).join('') + '</w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
      nums.map(function (id) { return '<w:num w:numId="' + id + '"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>'; }).join('') +
      '</w:numbering>';

    var settings = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings ' + NS + '><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:themeFontLang w:val="' + x(lang) + '"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>';

    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
      links.map(function (h, i) { return '<Relationship Id="rIdL' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + x(h) + '" TargetMode="External"/>'; }).join('') +
      '</Relationships>';

    var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    var core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + x(meta.title || 'Easyconvert document') + '</dc:title><dc:creator>' + x(meta.author || 'Easyconvert') + '</dc:creator>' +
      (meta.subject ? '<dc:subject>' + x(meta.subject) + '</dc:subject>' : '') + '<dc:language>' + x(lang) + '</dc:language>' +
      '<cp:lastModifiedBy>Easyconvert</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>';
    var app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Easyconvert</Application></Properties>';

    var types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
    var pkgRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';

    // [Content_Types].xml must be the first entry in the package.
    return EC.zip.makeZip([
      { name: '[Content_Types].xml', data: types },
      { name: '_rels/.rels', data: pkgRels },
      { name: 'docProps/core.xml', data: core },
      { name: 'docProps/app.xml', data: app },
      { name: 'word/document.xml', data: document },
      { name: 'word/styles.xml', data: styles },
      { name: 'word/numbering.xml', data: numbering },
      { name: 'word/settings.xml', data: settings },
      { name: 'word/_rels/document.xml.rels', data: rels }
    ], MIME);
  }

  EC.docx = { build: build, MIME: MIME, clean: clean };
})(window.EC = window.EC || {});
