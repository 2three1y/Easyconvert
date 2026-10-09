/* Easyconvert: small real PDF writer (PDF 1.4, standard fonts, no network).
   Text, headings, lists, quotes and code wrap and paginate properly, with page numbers,
   a document title, author and language. The base PDF fonts only cover Western
   characters; for emoji or non-Latin scripts the conversation view's "Print or save
   as PDF" gives a full-Unicode, tagged PDF from the browser. */
(function (EC) {
  'use strict';
  var HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  var CP = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  function toWin(str) {
    var out = [];
    for (var ch of String(str)) {
      var c = ch.codePointAt(0);
      if (c === 9) { out.push(32, 32, 32, 32); continue; }
      if (c >= 32 && c < 127) out.push(c);
      else if (c >= 0xA0 && c <= 0xFF) out.push(c);
      else if (CP[c]) out.push(CP[c]);
      else if (c >= 0xFE00 && c <= 0xFE0F || c === 0x200D || /\p{Extended_Pictographic}/u.test(ch)) continue; // emoji, variation selectors, joiners
      else out.push(63); // "?"
    }
    return out;
  }
  function width(bytes, font, size) {
    if (font === 'F3') return bytes.length * 600 * size / 1000;
    var w = 0;
    for (var i = 0; i < bytes.length; i++) { var c = bytes[i]; w += (c >= 32 && c <= 126) ? HW[c - 32] : 556; }
    return w * (font === 'F2' ? 1.06 : 1) * size / 1000;
  }
  function hex(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16); return '<' + s + '>'; }
  function wrap(text, font, size, maxW) {
    var lines = [];
    String(text).split('\n').forEach(function (para) {
      var words = para.split(/(\s+)/), line = [];
      function lineW(l) { return width(toWin(l.join('')), font, size); }
      words.forEach(function (w) {
        if (!w) return;
        var trial = line.concat([w]);
        if (lineW(trial) <= maxW || !line.length && width(toWin(w), font, size) <= maxW) { line = trial; return; }
        if (line.length) { lines.push(line.join('').replace(/\s+$/, '')); line = []; }
        if (/^\s+$/.test(w)) return;
        // a single word longer than the line: hard-break it
        var chunk = '';
        for (var ch of w) {
          if (width(toWin(chunk + ch), font, size) > maxW) { lines.push(chunk); chunk = ''; }
          chunk += ch;
        }
        line = [chunk];
      });
      lines.push(line.join('').replace(/\s+$/, ''));
    });
    return lines;
  }

  function build(blocks, meta) {
    meta = meta || {};
    var PW = 612, PH = 792, M = 60, MAXW = PW - 2 * M;
    var pages = [], ops = null, y = 0;
    function newPage() { ops = []; pages.push(ops); y = PH - M; }
    function need(h) { if (!ops || y - h < M + 20) newPage(); }
    function textLine(str, font, size, x, color) {
      ops.push((color || '0.09 0.13 0.16') + ' rg BT /' + font + ' ' + size + ' Tf ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' Td ' + hex(toWin(str)) + ' Tj ET');
    }
    function flow(text, font, size, lead, indent, color, after) {
      indent = indent || 0;
      wrap(text, font, size, MAXW - indent).forEach(function (l) { need(lead); y -= lead; textLine(l, font, size, M + indent, color); });
      y -= after == null ? lead * 0.5 : after;
    }
    newPage();
    blocks.forEach(function (b) {
      var P = EC.md.plainInline;
      switch (b.type) {
        case 'h':
          var sz = [0, 20, 16, 14, 12.5, 12, 11.5][Math.min(6, b.level)];
          need(sz * 3); y -= sz * 0.6;
          flow(P(b.text), 'F2', sz, sz * 1.3, 0, b.level === 2 ? '0.03 0.35 0.52' : '0.06 0.16 0.26', sz * 0.4);
          break;
        case 'code':
          var lines = wrap(b.text, 'F3', 9, MAXW - 16);
          lines.forEach(function (l) {
            need(12); ops.push('0.945 0.96 0.976 rg ' + M + ' ' + (y - 12 - 3).toFixed(2) + ' ' + MAXW + ' 12 re f');
            y -= 12; textLine(l, 'F3', 9, M + 8);
          });
          y -= 8; break;
        case 'quote':
          var top = y; flow(P(b.text), 'F4', 11, 15, 16, '0.2 0.31 0.41', 6);
          if (top > y && pages[pages.length - 1] === ops) ops.push('0.72 0.77 0.81 rg ' + M + ' ' + (y + 4).toFixed(2) + ' 3 ' + (top - y - 4).toFixed(2) + ' re f');
          break;
        case 'list':
          b.items.forEach(function (it, n) {
            var ind = 18 + 16 * (it.depth || 0), mark = b.ordered ? (n + 1) + '.' : '\u2022';
            var ls = wrap(P(it.text), 'F1', 11, MAXW - ind);
            ls.forEach(function (l, j) { need(15); y -= 15; if (!j) textLine(mark, 'F1', 11, M + ind - 14); textLine(l, 'F1', 11, M + ind); });
          });
          y -= 7; break;
        case 'table':
          b.rows.forEach(function (r, ri) { flow(r.map(P).join('   |   '), ri === 0 && b.header ? 'F2' : 'F1', 10, 13.5, 0, null, 2); });
          y -= 6; break;
        case 'hr': need(12); y -= 6; ops.push('0.72 0.77 0.81 rg ' + M + ' ' + y.toFixed(2) + ' ' + MAXW + ' 0.8 re f'); y -= 8; break;
        case 'meta': flow(P(b.text), 'F4', 10, 14, 0, '0.32 0.38 0.43', 8); break;
        default: flow(b.plain ? b.text : P(b.text), 'F1', 11, 15, 0, null, 7.5);
      }
    });

    // assemble objects
    var objs = [], N = pages.length;
    function add(s) { objs.push(s); return objs.length; }
    var catalogId = add(null), pagesId = add(null);
    var f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    var f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    var f3 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
    var f4 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');
    var kids = [];
    pages.forEach(function (o, i) {
      var footer = '0.32 0.38 0.43 rg BT /F1 9 Tf ' + M + ' 34 Td ' + hex(toWin((meta.title || 'Easyconvert') .slice(0, 80))) + ' Tj ET ' +
        'BT /F1 9 Tf ' + (PW - M - width(toWin('Page ' + (i + 1) + ' of ' + N), 'F1', 9)).toFixed(2) + ' 34 Td ' + hex(toWin('Page ' + (i + 1) + ' of ' + N)) + ' Tj ET';
      var stream = o.join('\n') + '\n' + footer;
      var sid = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
      kids.push(add('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R /F3 ' + f3 + ' 0 R /F4 ' + f4 + ' 0 R >> >> /Contents ' + sid + ' 0 R >>'));
    });
    objs[pagesId - 1] = '<< /Type /Pages /Kids [' + kids.map(function (k) { return k + ' 0 R'; }).join(' ') + '] /Count ' + N + ' >>';
    objs[catalogId - 1] = '<< /Type /Catalog /Pages ' + pagesId + ' 0 R /Lang ' + hex(toWin(meta.lang || 'en-US')) + ' /ViewerPreferences << /DisplayDocTitle true >> >>';
    var d = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var pdfDate = 'D:' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
    var infoId = add('<< /Title ' + hex([254, 255].concat(utf16(meta.title || 'Easyconvert document'))) + ' /Author ' + hex([254, 255].concat(utf16(meta.author || 'Easyconvert'))) + ' /Producer (Easyconvert) /CreationDate (' + pdfDate + ') >>');

    // serialize (all object bodies are ASCII, so string length == byte length)
    var out = '%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n', offsets = [];
    objs.forEach(function (o, i) { offsets.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offsets.map(function (o) { return ('0000000000' + o).slice(-10) + ' 00000 n \n'; }).join('');
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalogId + ' 0 R /Info ' + infoId + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    var bytes = new Uint8Array(out.length);
    for (var i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
    return new Blob([bytes], { type: 'application/pdf' });
  }
  function utf16(s) { var a = []; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); a.push(c >> 8, c & 255); } return a; }

  EC.pdf = { build: build };
})(window.EC = window.EC || {});
