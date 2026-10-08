/* Easyconvert: batch converter. Every input is turned into the shared block model first,
   so a binary file can never be dumped into a document as raw bytes again
   (that was the cause of the broken / "random characters" DOCX files). */
(function (EC) {
  'use strict';
  var FORMATS = {
    txt: { label: 'Plain text', ext: 'txt', mime: 'text/plain;charset=utf-8' },
    md: { label: 'Markdown', ext: 'md', mime: 'text/markdown;charset=utf-8' },
    html: { label: 'HTML', ext: 'html', mime: 'text/html;charset=utf-8' },
    docx: { label: 'Word (DOCX)', ext: 'docx', mime: EC.docx.MIME },
    pdf: { label: 'PDF', ext: 'pdf', mime: 'application/pdf' },
    json: { label: 'JSON', ext: 'json', mime: 'application/json;charset=utf-8' },
    csv: { label: 'CSV', ext: 'csv', mime: 'text/csv;charset=utf-8' }
  };
  var TEXT_EXT = /\.(txt|text|log|md|markdown|json|csv|tsv|html?|xml|yaml|yml|ini|cfg|conf|js|ts|py|rb|rs|go|java|c|h|cpp|cs|css|sh|sql|toml|srt|vtt)$/i;

  function baseName(n) { return n.replace(/\.[^.\/]+$/, '') || n; }

  function looksBinary(bytes) {
    var n = Math.min(bytes.length, 4096), bad = 0;
    for (var i = 0; i < n; i++) { var c = bytes[i]; if (c === 0) return true; if (c < 9 || (c > 13 && c < 32)) bad++; }
    return n > 0 && bad / n > 0.1;
  }

  function parseCSV(text, sep) {
    sep = sep || (text.split('\n', 1)[0].split('\t').length > text.split('\n', 1)[0].split(',').length ? '\t' : ',');
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.length > 1 || r[0] !== ''; });
  }
  function toCSV(rows) {
    return rows.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); return /[",\n\r]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n') + '\r\n';
  }

  function jsonToRows(v) {
    if (Array.isArray(v) && v.length && v.every(function (o) { return o && typeof o === 'object' && !Array.isArray(o); })) {
      var keys = [];
      v.forEach(function (o) { Object.keys(o).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
      return [keys].concat(v.map(function (o) { return keys.map(function (k) { var x = o[k]; return x == null ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x); }); }));
    }
    return null;
  }

  async function docxText(file) {
    var z = await EC.zip.readZip(file), e = z.find(/^word\/document\.xml$/)[0];
    if (!e) throw new Error('This Word file has no document text.');
    var xml = await EC.zip.entryText(z, e), doc = new DOMParser().parseFromString(xml, 'application/xml');
    var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', blocks = [];
    Array.prototype.forEach.call(doc.getElementsByTagNameNS(W, 'p'), function (p) {
      var style = p.getElementsByTagNameNS(W, 'pStyle')[0], sv = style ? style.getAttributeNS(W, 'val') || style.getAttribute('w:val') : '';
      var t = Array.prototype.map.call(p.getElementsByTagNameNS(W, 't'), function (n) { return n.textContent; }).join('');
      if (!t.trim()) return;
      var h = /^Heading(\d)$/i.exec(sv || '') || (/^Title$/i.test(sv) ? [0, 1] : null);
      blocks.push(h ? { type: 'h', level: +h[1], text: t } : { type: 'p', text: t });
    });
    return blocks;
  }

  /* File -> {title, blocks, rows?, kind}. Claude exports become one document with every conversation. */
  async function read(file, onProgress) {
    var name = file.name, title = baseName(name);
    var kind = await EC.claude.sniff(file);
    if (kind) {
      var exp = await EC.claude.load(file, onProgress);
      var blocks = [{ type: 'h', level: 1, text: 'Claude conversations' }, { type: 'meta', text: exp.conversations.length.toLocaleString() + ' conversation' + (exp.conversations.length === 1 ? '' : 's') + ' from ' + name }];
      exp.conversations.forEach(function (c) { blocks = blocks.concat(EC.claude.conversationBlocks(c, 2)); });
      var rows = [['title', 'created', 'messages', 'id']].concat(exp.conversations.map(function (c) { return [c.title, c.created ? new Date(c.created).toISOString() : '', c.count, c.id]; }));
      return { title: 'Claude conversations', blocks: blocks, rows: rows, kind: 'claude', json: exp.conversations.map(function (c) { return { id: c.id, title: c.title, created: c.created && new Date(c.created).toISOString(), messages: c.messages.map(function (m) { return { sender: m.sender, created: m.created && new Date(m.created).toISOString(), text: m.parts.map(function (p) { return p.text; }).join('\n\n') }; }) }; }) };
    }
    if (/\.docx$/i.test(name)) return { title: title, blocks: [{ type: 'h', level: 1, text: title }].concat(await docxText(file)), kind: 'docx' };
    var head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    if (!TEXT_EXT.test(name) && looksBinary(head) || /\.(zip|pdf|png|jpe?g|gif|webp|heic|mp[34]|mov|pptx|xlsx|exe|dmg)$/i.test(name)) {
      var e = new Error(name + ' is not a text file, so it can’t be converted' + (/\.zip$/i.test(name) ? ' (this ZIP has no conversations.json in it)' : '') + '. Easyconvert reads Claude exports, text, Markdown, CSV, JSON, HTML and Word files.');
      e.unsupported = true; throw e;
    }
    var text = (await EC.claude.readFileText(file, function (d, t) { onProgress && onProgress({ percent: t ? Math.round(d / t * 80) : 50, message: 'Reading' }); })).replace(/^\uFEFF/, '');
    if (/\.(csv|tsv)$/i.test(name)) {
      var r = parseCSV(text, /\.tsv$/i.test(name) ? '\t' : null);
      return { title: title, blocks: [{ type: 'h', level: 1, text: title }, { type: 'table', rows: r, header: true, caption: title }], rows: r, kind: 'csv', text: text };
    }
    if (/\.json$/i.test(name)) {
      var v; try { v = JSON.parse(text); } catch (err) { v = undefined; }
      var jr = v !== undefined ? jsonToRows(v) : null;
      return { title: title, blocks: [{ type: 'h', level: 1, text: title }, { type: 'code', lang: 'json', text: v !== undefined ? JSON.stringify(v, null, 2) : text }], rows: jr, kind: 'json', json: v, text: text };
    }
    if (/\.html?$/i.test(name)) {
      var doc = new DOMParser().parseFromString(text, 'text/html'), hb = [];
      doc.querySelectorAll('script,style,noscript,template').forEach(function (n) { n.remove(); });
      doc.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,td,th').forEach(function (n) {
        if (n.closest('li,pre,blockquote') && n.closest('li,pre,blockquote') !== n) return;
        var t = n.textContent.replace(/\s+/g, n.tagName === 'PRE' ? '$&' : ' ').trim(); if (!t) return;
        var tag = n.tagName.toLowerCase();
        hb.push(/^h\d$/.test(tag) ? { type: 'h', level: +tag[1], text: t } : tag === 'pre' ? { type: 'code', text: n.textContent } : tag === 'li' ? { type: 'list', ordered: n.parentElement && n.parentElement.tagName === 'OL', items: [{ text: t }] } : tag === 'blockquote' ? { type: 'quote', text: t } : { type: 'p', text: t });
      });
      if (!hb.length && doc.body.textContent.trim()) hb.push({ type: 'p', text: doc.body.textContent.trim() });
      var t2 = (doc.title || '').trim() || title;
      if (!hb.length || hb[0].type !== 'h') hb.unshift({ type: 'h', level: 1, text: t2 });
      return { title: t2, blocks: hb, kind: 'html', text: text };
    }
    if (/\.(md|markdown)$/i.test(name)) {
      var mb = EC.md.parse(text);
      if (!mb.length || mb[0].type !== 'h') mb.unshift({ type: 'h', level: 1, text: title });
      return { title: title, blocks: mb, kind: 'md', text: text };
    }
    // plain text: keep the author's line breaks, blank lines separate paragraphs
    var paras = text.split(/\n{2,}/).map(function (p) { return p.replace(/\s+$/, ''); }).filter(Boolean).map(function (p) { return { type: 'p', text: p, plain: true }; });
    return { title: title, blocks: [{ type: 'h', level: 1, text: title }].concat(paras), kind: 'text', text: text };
  }

  function htmlDocument(title, blocks, lang) {
    return '<!doctype html>\n<html lang="' + EC.md.esc(lang || 'en') + '">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' + EC.md.esc(title) + '</title>\n<meta name="generator" content="Easyconvert">\n<style>\n' +
      'body{margin:0;background:#eef2f5;color:#17202a;font:17px/1.6 system-ui,-apple-system,sans-serif}main{max-width:46rem;margin:auto;padding:1.5rem;background:#fff;min-height:100vh}h1,h2,h3{line-height:1.25;color:#102a43}h2{color:#075985;border-top:1px solid #b8c5cf;padding-top:1rem}' +
      'pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f5f9;border:1px solid #b8c5cf;border-radius:6px;padding:.85rem;font-size:.92em}code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}p code{background:#f1f5f9;padding:.1em .3em;border-radius:4px}' +
      'blockquote{margin:0;border-left:4px solid #b8c5cf;padding-left:1rem;color:#334e68}.meta{color:#52606d}table{border-collapse:collapse;width:100%}th,td{border:1px solid #b8c5cf;padding:.45rem;text-align:left;vertical-align:top}th{background:#e8f0f5}a{color:#075985}' +
      '.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.code-head{display:none}:focus-visible{outline:4px solid #f59e0b;outline-offset:2px}' +
      '@media(prefers-color-scheme:dark){body{background:#0b1620;color:#e6edf3}main{background:#102a43}h1,h3{color:#fff}h2,a{color:#7cc4ef}pre,p code{background:#0b1620;border-color:#334e68}blockquote,.meta{color:#b8c5cf}th{background:#16324f}}\n</style>\n</head>\n<body>\n<main>\n' +
      EC.md.toHTML(blocks, 1).replace(/<button[^>]*>.*?<\/button>/g, '') + '\n</main>\n</body>\n</html>\n';
  }

  /* {title, blocks, ...} + format -> {blob, filename} */
  function render(doc, fmt, fileName) {
    var F = FORMATS[fmt], lang = (navigator.language || 'en-US'), title = doc.title || baseName(fileName), out;
    var blocks = doc.blocks;
    switch (fmt) {
      case 'docx': out = EC.docx.build(blocks, { title: title, author: 'Easyconvert', lang: lang }); break;
      case 'pdf': out = EC.pdf.build(blocks, { title: title, author: 'Easyconvert', lang: lang }); break;
      case 'html': out = htmlDocument(title, blocks, lang.split('-')[0]); break;
      case 'md': out = doc.kind === 'md' ? doc.text : EC.md.toMarkdown(blocks); break;
      case 'txt': out = doc.kind === 'text' ? doc.text : EC.md.toText(blocks); break;
      case 'csv': out = toCSV(doc.rows || EC.md.toText(blocks).split('\n').filter(function (l) { return l.trim(); }).map(function (l) { return [l]; })); break;
      case 'json':
        var v = doc.json !== undefined ? doc.json : doc.rows ? doc.rows.slice(1).map(function (r) { var o = {}; doc.rows[0].forEach(function (k, i) { o[k] = r[i]; }); return o; }) : { title: title, content: EC.md.toText(blocks) };
        out = JSON.stringify(v, null, 2) + '\n'; break;
    }
    var blob = out instanceof Blob ? out : new Blob([out], { type: F.mime });
    return { blob: blob, filename: baseName(fileName) + '.' + F.ext, mime: F.mime };
  }
  EC.convert = { FORMATS: FORMATS, read: read, render: render, htmlDocument: htmlDocument, parseCSV: parseCSV, toCSV: toCSV, baseName: baseName };
})(window.EC = window.EC || {});
