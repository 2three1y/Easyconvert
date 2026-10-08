/* Easyconvert: read a Claude data export (the .zip, or conversations.json on its own).
   Parses in chunks with progress so a 2,000+ conversation export stays responsive. */
(function (EC) {
  'use strict';
  var tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

  async function readFileText(file, onProgress) {
    if (!file.stream) return file.text();
    var reader = file.stream().getReader(), td = new TextDecoder('utf-8'), parts = [], done = 0;
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      done += r.value.length; parts.push(td.decode(r.value, { stream: true }));
      onProgress(done, file.size);
    }
    parts.push(td.decode());
    return parts.join('');
  }

  function isZip(file, head) { return /\.zip$/i.test(file.name) || /zip/.test(file.type) || (head && head[0] === 0x50 && head[1] === 0x4B); }

  /* Is this File a Claude export? Cheap check: zip with conversations.json, or a JSON array of chats. */
  async function sniff(file) {
    var head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
    if (isZip(file, head)) {
      try { var z = await EC.zip.readZip(file); return z.find(/(^|\/)conversations\.json$/i).length ? 'zip' : null; } catch (e) { return null; }
    }
    var txt = new TextDecoder().decode(head).replace(/^\uFEFF/, '').trim();
    if (/^\[\s*\{/.test(txt) && /"(chat_messages|uuid|name)"/.test(txt + (await file.slice(512, 8192).text()))) {
      var more = await file.slice(0, 65536).text();
      if (/"chat_messages"\s*:/.test(more)) return 'json';
    }
    return null;
  }

  function parseDate(s) { var t = Date.parse(s); return isNaN(t) ? null : t; }

  var CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  function messageParts(m) {
    var parts = [];
    if (Array.isArray(m.content) && m.content.length) {
      m.content.forEach(function (c) {
        if (!c) return;
        if (c.type === 'text' && c.text) parts.push({ kind: 'text', text: c.text });
        else if (c.type === 'thinking' && (c.thinking || c.text)) parts.push({ kind: 'thinking', text: c.thinking || c.text });
        else if (c.type === 'tool_use') parts.push({ kind: 'tool_use', name: c.name || 'tool', text: typeof c.input === 'string' ? c.input : JSON.stringify(c.input || {}, null, 2) });
        else if (c.type === 'tool_result') {
          var t = Array.isArray(c.content) ? c.content.map(function (x) { return x && (x.text || (x.type ? '[' + x.type + ']' : '')); }).join('\n') : (c.content || '');
          parts.push({ kind: 'tool_result', name: c.name || '', text: String(t) });
        } else if (c.text) parts.push({ kind: 'text', text: c.text });
      });
    }
    if (!parts.length && m.text) parts.push({ kind: 'text', text: m.text });
    parts.forEach(function (p) { p.text = String(p.text == null ? '' : p.text).replace(CTRL, ''); });
    return parts;
  }

  function normalize(c, idx) {
    var msgs = (c.chat_messages || []).map(function (m, i) {
      return {
        id: m.uuid || String(i),
        sender: m.sender === 'human' ? 'human' : 'assistant',
        created: parseDate(m.created_at),
        parts: messageParts(m),
        attachments: (m.attachments || []).map(function (a) { return { name: a.file_name || 'attachment', size: a.file_size || 0, type: a.file_type || '', content: String(a.extracted_content || '').replace(CTRL, '') }; }),
        files: (m.files || []).concat(m.files_v2 || []).map(function (f) { return { name: f.file_name || f.file_uuid || 'file' }; })
      };
    });
    var created = parseDate(c.created_at) || (msgs[0] && msgs[0].created) || null;
    var updated = parseDate(c.updated_at) || created;
    var title = (c.name || '').trim();
    if (!title) {
      var first = msgs[0] && msgs[0].parts[0] ? msgs[0].parts[0].text : '';
      title = first ? first.replace(/\s+/g, ' ').trim().slice(0, 70) + (first.length > 70 ? '…' : '') : 'Untitled conversation';
    }
    var hay = [title].concat(msgs.map(function (m) { return m.parts.map(function (p) { return p.text; }).join('\n') + m.attachments.map(function (a) { return '\n' + a.name + '\n' + a.content; }).join(''); })).join('\n');
    return { id: c.uuid || 'c' + idx, title: title, untitled: !c.name, summary: c.summary || '', created: created, updated: updated, messages: msgs, count: msgs.length, titleLower: title.toLowerCase(), textLower: hay.toLowerCase() };
  }

  /* Load an export. onProgress({phase, percent, message}) */
  async function load(file, onProgress) {
    onProgress = onProgress || function () {};
    var kind = await sniff(file), text, users = [], projects = [], memories = null;
    var pct = function (d, t) { return t ? Math.min(99, Math.round(d / t * 100)) : 0; };
    if (kind === 'zip') {
      var z = await EC.zip.readZip(file);
      var entry = z.find(/(^|\/)conversations\.json$/i)[0];
      text = await EC.zip.entryText(z, entry, function (d, t) { onProgress({ phase: 'unzip', percent: pct(d, t) * 0.5, message: 'Unzipping conversations' }); });
      var side = async function (re) { var e = z.find(re)[0]; if (!e) return null; try { return JSON.parse(await EC.zip.entryText(z, e)); } catch (err) { return null; } };
      users = (await side(/(^|\/)users\.json$/i)) || [];
      projects = (await side(/(^|\/)projects\.json$/i)) || [];
      memories = await side(/(^|\/)memories\.json$/i);
    } else {
      text = await readFileText(file, function (d, t) { onProgress({ phase: 'read', percent: pct(d, t) * 0.5, message: 'Reading file' }); });
    }
    onProgress({ phase: 'parse', percent: 50, message: 'Parsing conversations' });
    await tick();
    var raw;
    try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { throw new Error('conversations.json could not be read as JSON (' + e.message + ').'); }
    text = null;
    if (!Array.isArray(raw)) raw = raw && Array.isArray(raw.conversations) ? raw.conversations : [];
    var out = [], CH = 150;
    for (var i = 0; i < raw.length; i += CH) {
      for (var j = i; j < Math.min(raw.length, i + CH); j++) { if (raw[j] && typeof raw[j] === 'object') out.push(normalize(raw[j], j)); raw[j] = null; }
      onProgress({ phase: 'index', percent: 50 + Math.round(Math.min(raw.length, i + CH) / Math.max(1, raw.length) * 49), message: 'Indexed ' + Math.min(raw.length, i + CH).toLocaleString() + ' of ' + raw.length.toLocaleString() + ' conversations' });
      await tick();
    }
    var user = Array.isArray(users) ? users[0] : users;
    onProgress({ phase: 'done', percent: 100, message: 'Done' });
    return {
      fileName: file.name,
      conversations: out,
      user: user ? { name: user.full_name || '', email: user.email_address || '' } : null,
      projects: (Array.isArray(projects) ? projects : []).map(function (p) {
        return { id: p.uuid, name: p.name || 'Untitled project', description: p.description || '', created: parseDate(p.created_at), prompt: p.prompt_template || '', docs: (p.docs || []).map(function (d) { return { name: d.filename || 'document', content: d.content || '' }; }) };
      }),
      memories: memories
    };
  }

  /* ---------- conversation -> blocks (shared by every export format) ---------- */
  var dateFmt = function (t, opts) { return t == null ? '' : new Date(t).toLocaleString(undefined, opts || { dateStyle: 'medium', timeStyle: 'short' }); };
  function speaker(m) { return m.sender === 'human' ? 'You' : 'Claude'; }
  function messageBlocks(m, base) {
    var out = [];
    m.parts.forEach(function (p) {
      if (p.kind === 'text') {
        // a message's own headings sit one level under the speaker heading, without skipping levels
        var bl = EC.md.parse(p.text), min = Math.min.apply(null, bl.filter(function (b) { return b.type === 'h'; }).map(function (b) { return b.level; }).concat([6]));
        bl.forEach(function (b) { if (b.type === 'h') b = { type: 'h', level: Math.min(6, b.level - min + base + 1), text: b.text }; out.push(b); });
      }
      else if (p.kind === 'thinking') { out.push({ type: 'p', text: '**Claude’s thinking:**' }); out.push({ type: 'quote', text: p.text }); }
      else if (p.kind === 'tool_use') { out.push({ type: 'p', text: '**Used tool:** ' + p.name }); out.push({ type: 'code', lang: 'json', text: p.text }); }
      else if (p.kind === 'tool_result') { out.push({ type: 'p', text: '**Tool result' + (p.name ? ' (' + p.name + ')' : '') + ':**' }); out.push({ type: 'code', lang: '', text: p.text }); }
    });
    m.attachments.forEach(function (a) {
      out.push({ type: 'p', text: '**Attachment:** ' + a.name + (a.size ? ' (' + fmtSize(a.size) + ')' : '') });
      if (a.content) out.push({ type: 'code', lang: '', text: a.content });
    });
    m.files.forEach(function (f) { out.push({ type: 'p', text: '**File:** ' + f.name }); });
    if (!out.length) out.push({ type: 'meta', text: '(empty message)' });
    return out;
  }
  function conversationBlocks(c, level) {
    level = level || 1;
    var blocks = [{ type: 'h', level: level, text: c.title }, { type: 'meta', text: 'Started ' + dateFmt(c.created) + ' · ' + c.count + ' message' + (c.count === 1 ? '' : 's') }];
    c.messages.forEach(function (m) {
      blocks.push({ type: 'h', level: level + 1, text: speaker(m) + (m.created ? ' — ' + dateFmt(m.created) : '') });
      blocks = blocks.concat(messageBlocks(m, level + 1));
    });
    return blocks;
  }
  function fmtSize(n) { return n < 1024 ? n + ' bytes' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }

  EC.claude = { sniff: sniff, load: load, conversationBlocks: conversationBlocks, messageBlocks: messageBlocks, speaker: speaker, dateFmt: dateFmt, fmtSize: fmtSize, readFileText: readFileText };
})(window.EC = window.EC || {});
