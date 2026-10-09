/* Easyconvert: a small, safe Markdown reader.
   Markdown -> blocks (shared by the screen view, DOCX, PDF, HTML, TXT exports).
   Nothing here ever inserts raw HTML from a file: every string is escaped. */
(function (EC) {
  'use strict';
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Block parser. Returns [{type, text, level, lang, items, ordered, rows}] */
  function parse(md) {
    var lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
    var out = [], para = [], i = 0;
    function flush() { if (para.length) { out.push({ type: 'p', text: para.join('\n') }); para = []; } }
    while (i < lines.length) {
      var line = lines[i], m;
      if ((m = line.match(/^\s*(```+|~~~+)\s*([\w+#.-]*)/))) {
        flush();
        var fence = m[1], lang = m[2] || '', code = [];
        i++;
        while (i < lines.length && lines[i].trim().indexOf(fence) !== 0) { code.push(lines[i]); i++; }
        i++;
        out.push({ type: 'code', lang: lang, text: code.join('\n') });
        continue;
      }
      if (!line.trim()) { flush(); i++; continue; }
      if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) { flush(); out.push({ type: 'h', level: m[1].length, text: m[2] }); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push({ type: 'hr' }); i++; continue; }
      if (/^\s*>/.test(line)) {
        flush(); var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push({ type: 'quote', text: q.join('\n') });
        continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        flush();
        var ordered = /^\s*\d/.test(line), items = [];
        while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
          var li = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (li) items.push({ text: li[3], depth: Math.min(3, Math.floor(li[1].length / 2)) });
          else items[items.length - 1].text += ' ' + lines[i].trim();
          i++;
        }
        out.push({ type: 'list', ordered: ordered, items: items });
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        flush(); var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          if (!/^\s*\|?\s*:?-{2,}/.test(lines[i])) rows.push(splitRow(lines[i]));
          i++;
        }
        out.push({ type: 'table', rows: rows, header: true });
        continue;
      }
      para.push(line); i++;
    }
    flush();
    return out;
  }
  function splitRow(l) { return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); }); }

  /* Inline tokenizer -> runs [{text, bold, italic, code, href}] */
  function inline(text) {
    var runs = [], s = String(text), re = /(`+)([\s\S]*?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g, last = 0, m;
    while ((m = re.exec(s))) {
      if (m[0][0] === '_' && /\w/.test(s[m.index - 1] || '')) continue; // snake_case is not italics
      if (m.index > last) runs.push({ text: s.slice(last, m.index) });
      if (m[1]) runs.push({ text: m[2], code: true });
      else if (m[3] || m[4]) runs.push({ text: m[3] || m[4], bold: true });
      else if (m[5] || m[6]) runs.push({ text: m[5] || m[6], italic: true });
      else if (m[7]) runs.push({ text: m[7], href: m[8] });
      else if (m[9]) runs.push({ text: m[9], href: m[9] });
      last = re.lastIndex;
    }
    if (last < s.length) runs.push({ text: s.slice(last) });
    return runs;
  }
  function plainInline(text) { return inline(text).map(function (r) { return r.href && r.href !== r.text ? r.text + ' (' + r.href + ')' : r.text; }).join(''); }

  function safeHref(h) { return /^(https?:|mailto:)/i.test(h) ? h : null; }
  function inlineHTML(text, highlight) {
    return inline(text).map(function (r) {
      var t = esc(r.text).replace(/\n/g, '<br>');
      if (r.code) return '<code>' + t + '</code>';
      if (r.bold) return '<strong>' + t + '</strong>';
      if (r.italic) return '<em>' + t + '</em>';
      if (r.href) { var h = safeHref(r.href); return h ? '<a href="' + esc(h) + '" rel="noopener noreferrer" target="_blank">' + t + '<span class="visually-hidden"> (opens in a new tab)</span></a>' : t; }
      return t;
    }).join('');
  }

  /* blocks -> HTML. headingBase: the level a Markdown "#" becomes (so a message never breaks the page outline). */
  function toHTML(blocks, headingBase) {
    headingBase = headingBase || 1;
    return blocks.map(function (b) {
      switch (b.type) {
        case 'h': var lv = Math.min(6, b.level + headingBase - 1); return '<h' + lv + '>' + inlineHTML(b.text) + '</h' + lv + '>';
        case 'code':
          return '<div class="code-block"><div class="code-head"><span>' + esc(b.lang || 'code') + '</span><button type="button" class="copy-code">Copy code<span class="visually-hidden">' + (b.lang ? ' (' + esc(b.lang) + ')' : '') + '</span></button></div>' +
            '<pre tabindex="0" aria-label="' + esc((b.lang ? b.lang + ' ' : '') + 'code block') + '"><code>' + esc(b.text) + '</code></pre></div>';
        case 'quote': return '<blockquote>' + toHTML(parse(b.text), headingBase) + '</blockquote>';
        case 'list':
          var tag = b.ordered ? 'ol' : 'ul';
          return '<' + tag + '>' + b.items.map(function (it) { return '<li' + (it.depth ? ' class="depth-' + it.depth + '"' : '') + '>' + inlineHTML(it.text) + '</li>'; }).join('') + '</' + tag + '>';
        case 'table':
          var rows = b.rows, head = b.header ? rows[0] : null, body = b.header ? rows.slice(1) : rows;
          return '<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>' +
            (head ? '<thead><tr>' + head.map(function (c) { return '<th scope="col">' + inlineHTML(c) + '</th>'; }).join('') + '</tr></thead>' : '') +
            '<tbody>' + body.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + inlineHTML(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
        case 'hr': return '<hr>';
        case 'meta': return '<p class="meta">' + esc(b.text) + '</p>';
        default: return '<p>' + (b.plain ? esc(b.text).replace(/\n/g, '<br>') : inlineHTML(b.text)) + '</p>';
      }
    }).join('\n');
  }

  /* blocks -> plain text / Markdown */
  function toText(blocks) {
    return blocks.map(function (b) {
      switch (b.type) {
        case 'h': var pt = plainInline(b.text); return b.level <= 1 ? pt + '\n' + '='.repeat(Math.min(60, pt.length)) : b.level === 2 ? pt + '\n' + '-'.repeat(Math.min(60, pt.length)) : pt;
        case 'code': return b.text.split('\n').map(function (l) { return '    ' + l; }).join('\n');
        case 'quote': return b.text.split('\n').map(function (l) { return '> ' + l; }).join('\n');
        case 'list': return b.items.map(function (it, n) { return '  '.repeat(it.depth || 0) + (b.ordered ? (n + 1) + '. ' : '- ') + plainInline(it.text); }).join('\n');
        case 'table': return b.rows.map(function (r) { return r.map(plainInline).join('\t'); }).join('\n');
        case 'hr': return '----------';
        default: return b.plain ? b.text : plainInline(b.text);
      }
    }).join('\n\n') + '\n';
  }
  function toMarkdown(blocks) {
    return blocks.map(function (b) {
      switch (b.type) {
        case 'h': return '#'.repeat(Math.min(6, b.level)) + ' ' + b.text;
        case 'code': var f = /```/.test(b.text) ? '~~~~' : '```'; return f + (b.lang || '') + '\n' + b.text + '\n' + f;
        case 'quote': return b.text.split('\n').map(function (l) { return '> ' + l; }).join('\n');
        case 'list': return b.items.map(function (it, n) { return '  '.repeat(it.depth || 0) + (b.ordered ? (n + 1) + '. ' : '- ') + it.text; }).join('\n');
        case 'table':
          var r = b.rows, cell = function (c) { return String(c).replace(/\|/g, '\\|').replace(/\n/g, ' '); };
          var head = b.header ? r[0] : r[0].map(function (_, n) { return 'Column ' + (n + 1); });
          var body = b.header ? r.slice(1) : r;
          return '| ' + head.map(cell).join(' | ') + ' |\n|' + head.map(function () { return ' --- '; }).join('|') + '|\n' + body.map(function (row) { return '| ' + row.map(cell).join(' | ') + ' |'; }).join('\n');
        case 'hr': return '---';
        case 'meta': return '_' + b.text + '_';
        default: return b.plain ? b.text.replace(/([\\`*_\[\]#<>])/g, '\\$1') : b.text;
      }
    }).join('\n\n') + '\n';
  }

  EC.md = { parse: parse, inline: inline, inlineHTML: inlineHTML, plainInline: plainInline, toHTML: toHTML, toText: toText, toMarkdown: toMarkdown, esc: esc };
})(window.EC = window.EC || {});
