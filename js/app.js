/* Easyconvert app: wiring for the reader, the batch converter, sounds and announcements. */
(function (EC) {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = EC.md.esc;
  var events = EC.events = []; // test hook: an ordered log of what happened
  function logEvent(type, detail) { events.push({ type: type, detail: detail, at: Math.round(performance.now()) }); }
  var tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };
  var nf = function (n) { return Number(n).toLocaleString(); };
  var plural = function (n, w) { return nf(n) + ' ' + w + (n === 1 ? '' : 's'); };

  /* ---------- announcements ---------- */
  var toastEl = $('toast'), toastTimer = null, lastProgressAt = 0;
  function announce(msg, opts) {
    opts = opts || {};
    var el = opts.assertive ? $('alert') : $('status');
    el.textContent = '';
    setTimeout(function () { el.textContent = msg; }, 60);
    // the visible toast mirrors the words for sighted users; screen readers get the live region
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, opts.long ? 6000 : 3500);
    logEvent('announce', msg);
  }
  // Progress chatter is throttled so a screen reader isn't flooded.
  function announceProgress(msg, force) {
    var now = Date.now();
    if (!force && now - lastProgressAt < 2500) return;
    lastProgressAt = now; announce(msg);
  }

  /* ---------- downloads, sharing, clipboard ---------- */
  var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function canShareFile(blob, name) {
    try { return !!(navigator.canShare && navigator.canShare({ files: [new File([blob], name, { type: blob.type })] })); } catch (e) { return false; }
  }
  function shareFile(blob, name) {
    return navigator.share({ files: [new File([blob], name, { type: blob.type })], title: name }).catch(function (e) { if (e && e.name !== 'AbortError') announce('Sharing failed: ' + e.message); });
  }
  function save(blob, name) {
    // A home-screen web app on iOS can't download; the share sheet's "Save to Files" can.
    if (isIOS && navigator.standalone && canShareFile(blob, name)) { shareFile(blob, name); return; }
    var url = URL.createObjectURL(blob);
    if (!('download' in HTMLAnchorElement.prototype)) { window.open(url, '_blank'); }
    else {
      var a = document.createElement('a');
      a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
      document.body.appendChild(a); a.click(); a.remove();
    }
    // iOS Safari reads the blob after the click returns, so don't revoke it straight away.
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    logEvent('download', name);
  }
  function copyText(text, what) {
    var done = function () { announce((what || 'Text') + ' copied to the clipboard'); };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text) ? done() : announce('Copy failed. Select the text and copy it yourself.'); });
    if (legacyCopy(text)) done(); else announce('Copy failed. Select the text and copy it yourself.');
  }
  function legacyCopy(text) {
    var t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } t.remove(); return ok;
  }
  function safeName(s) { return String(s).replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'conversation'; }

  /* ---------- sound controls ---------- */
  var soundBtn = $('sound-toggle'), vol = $('volume');
  function syncSound() {
    var on = !EC.sound.isMuted();
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.textContent = on ? 'Sounds on' : 'Sounds off';
    vol.disabled = !on;
    vol.value = Math.round(EC.sound.getVolume() * 100);
    vol.setAttribute('aria-valuetext', vol.value + ' percent');
  }
  soundBtn.addEventListener('click', function () {
    EC.sound.setMuted(!EC.sound.isMuted()); syncSound();
    announce(EC.sound.isMuted() ? 'Sounds off' : 'Sounds on');
    EC.sound.play('tick');
  });
  vol.addEventListener('input', function () { EC.sound.setVolume(vol.value / 100); vol.setAttribute('aria-valuetext', vol.value + ' percent'); });
  vol.addEventListener('change', function () { EC.sound.play('file'); });
  syncSound();

  /* ---------- file intake ---------- */
  var input = $('file-input'), drop = $('drop');
  input.addEventListener('change', function () { handleFiles(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) { document.addEventListener(ev, function (e) { if (hasFiles(e)) { e.preventDefault(); drop.classList.add('drag'); } }); });
  ['dragleave', 'dragend'].forEach(function (ev) { document.addEventListener(ev, function (e) { if (!e.relatedTarget) drop.classList.remove('drag'); }); });
  document.addEventListener('drop', function (e) { if (!hasFiles(e)) return; e.preventDefault(); drop.classList.remove('drag'); handleFiles(e.dataTransfer.files); });
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }

  var items = [], nextId = 1;
  async function handleFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    var opened = false;
    for (var i = 0; i < files.length; i++) {
      var f = files[i], kind = null;
      try { kind = await EC.claude.sniff(f); } catch (e) { kind = null; }
      if (kind && !opened) { opened = true; openExport(f); }
      items.push({ id: nextId++, file: f, state: 'ready', progress: 0, claude: !!kind });
    }
    $('format-section').hidden = false;
    $('results-section').hidden = false;
    renderResults();
    var others = files.length - (opened ? 1 : 0);
    if (!opened || others) announce(plural(files.length, 'file') + ' added. ' + (opened ? 'The Claude export is opening in the reader. ' : '') + 'Choose a format, then press Convert files.');
  }

  /* ---------- converter ---------- */
  var resultsEl = $('results');
  function stateText(it) {
    switch (it.state) {
      case 'ready': return 'Ready to convert';
      case 'working': return 'Converting… ' + it.progress + '%';
      case 'done': return 'Converted to ' + it.result.filename + ' (' + EC.claude.fmtSize(it.result.blob.size) + ')';
      case 'error': return it.error;
    }
  }
  function renderResults() {
    resultsEl.replaceChildren();
    items.forEach(function (it) {
      var li = document.createElement('li'); li.className = 'result'; li.id = 'file-' + it.id;
      li.setAttribute('aria-labelledby', 'file-name-' + it.id);
      li.innerHTML =
        '<h3 id="file-name-' + it.id + '">' + esc(it.file.name) + '</h3>' +
        '<p class="hint">' + EC.claude.fmtSize(it.file.size) + (it.claude ? ' · Claude export' : '') + '</p>' +
        '<label class="visually-hidden" for="bar-' + it.id + '">Progress for ' + esc(it.file.name) + '</label>' +
        '<progress id="bar-' + it.id + '" max="100" value="' + it.progress + '"></progress>' +
        '<p class="state ' + (it.state === 'done' ? 'ok' : it.state === 'error' ? 'bad' : '') + '" id="state-' + it.id + '">' + esc(stateText(it)) + '</p>' +
        '<h4 id="actions-' + it.id + '">File actions<span class="visually-hidden"> for ' + esc(it.file.name) + '</span></h4>' +
        '<div class="actions" role="group" aria-labelledby="actions-' + it.id + '">' +
          '<button type="button" class="secondary" data-act="preview" aria-expanded="false" aria-controls="prev-' + it.id + '"' + (it.state !== 'done' ? ' disabled' : '') + '>Preview</button>' +
          '<button type="button" class="secondary" data-act="copy"' + (it.state !== 'done' || !it.text ? ' disabled' : '') + '>Copy text</button>' +
          '<button type="button" data-act="download"' + (it.state !== 'done' ? ' disabled' : '') + '>Download</button>' +
          (it.state === 'done' && canShareFile(it.result.blob, it.result.filename) ? '<button type="button" class="secondary" data-act="share">Share or save to Files</button>' : '') +
          '<button type="button" class="secondary" data-act="remove">Remove</button>' +
        '</div>' +
        '<div id="prev-' + it.id + '" hidden><pre tabindex="0" aria-label="Preview of ' + esc(it.file.name) + '"></pre></div>';
      li.querySelectorAll('[data-act] , .actions button').forEach(function (b) { b.setAttribute('aria-describedby', 'file-name-' + it.id); });
      resultsEl.appendChild(li);
    });
    $('download-all').disabled = !items.some(function (x) { return x.state === 'done'; });
    $('convert').disabled = !items.length;
    if (!items.length) resultsEl.innerHTML = '<li class="empty">No files yet.</li>';
  }
  function updateRow(it) {
    var bar = $('bar-' + it.id), st = $('state-' + it.id);
    if (bar) bar.value = it.progress;
    if (st) { st.textContent = stateText(it); st.className = 'state ' + (it.state === 'done' ? 'ok' : it.state === 'error' ? 'bad' : ''); }
  }
  resultsEl.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]'); if (!b) return;
    var li = b.closest('.result'), id = +li.id.slice(5), it = items.find(function (x) { return x.id === id; });
    if (!it) return;
    var act = b.getAttribute('data-act');
    if (act === 'download') { save(it.result.blob, it.result.filename); announce('Downloading ' + it.result.filename); }
    if (act === 'share') shareFile(it.result.blob, it.result.filename);
    if (act === 'copy') copyText(it.text, it.result.filename);
    if (act === 'preview') {
      var box = $('prev-' + id), open = box.hidden;
      box.hidden = !open; b.setAttribute('aria-expanded', String(open));
      if (open) box.querySelector('pre').textContent = it.preview && it.preview.length > 200000 ? it.preview.slice(0, 200000) + '\n\n… preview cut short; the download has everything.' : (it.preview || '');
    }
    if (act === 'remove') {
      var idx = items.indexOf(it); items.splice(idx, 1); renderResults();
      announce(it.file.name + ' removed');
      var next = resultsEl.querySelectorAll('.result')[Math.min(idx, items.length - 1)];
      (next ? next.querySelector('button') : input).focus();
    }
  });
  $('clear-files').addEventListener('click', function () { items = []; renderResults(); setOverall(0, ''); announce('All files removed'); input.focus(); });
  $('format').addEventListener('change', function () {
    if (items.some(function (x) { return x.state === 'done'; })) {
      items.forEach(function (x) { if (x.state === 'done') { x.state = 'ready'; x.progress = 0; } });
      renderResults(); announce('Format changed. Press Convert files to convert again.');
    }
  });

  var overallTicks = {};
  function setOverall(pct, text) {
    $('overall-bar').value = pct;
    $('overall-text').textContent = text;
    [25, 50, 75].forEach(function (m) { if (pct >= m && !overallTicks[m]) { overallTicks[m] = true; EC.sound.play('tick'); logEvent('tick', m); } });
  }

  var converting = false;
  $('convert').addEventListener('click', async function () {
    if (converting || !items.length) return;
    converting = true; this.disabled = true;
    var fmt = $('format').value, todo = items.slice(), total = todo.length, done = 0, failed = 0;
    overallTicks = {};
    todo.forEach(function (it) { it.state = 'ready'; it.progress = 0; });
    renderResults(); setOverall(0, '0 of ' + total);
    announce('Converting ' + plural(total, 'file') + ' to ' + EC.convert.FORMATS[fmt].label);
    logEvent('batch-start', { total: total, format: fmt });
    for (var i = 0; i < todo.length; i++) {
      var it = todo[i];
      it.state = 'working'; it.progress = 1; updateRow(it);
      try {
        var doc = await EC.convert.read(it.file, function (p) {
          it.progress = Math.max(it.progress, Math.min(90, Math.round(p.percent * 0.9))); updateRow(it);
          setOverall(Math.round((done + failed + it.progress / 100) / total * 100), (done + failed) + ' of ' + total);
          announceProgress(it.file.name + ': ' + it.progress + ' percent');
        });
        it.progress = 92; updateRow(it); await tick();
        var out = EC.convert.render(doc, fmt, it.file.name);
        it.result = out;
        it.text = /^(txt|md|html|json|csv)$/.test(fmt) ? await out.blob.text() : EC.md.toText(doc.blocks);
        it.preview = it.text;
        it.state = 'done'; it.progress = 100; done++;
        updateRow(it);
        EC.sound.play('file'); logEvent('file-done', out.filename);
        announce(out.filename + ' converted, ' + (done + failed) + ' of ' + total + ' done');
      } catch (err) {
        it.state = 'error'; it.progress = 0; failed++;
        it.error = 'Could not convert: ' + (err && err.message || err);
        updateRow(it);
        EC.sound.play('error'); logEvent('file-error', it.file.name);
        announce(it.file.name + ' could not be converted. ' + (err && err.message || ''), { long: true });
      }
      setOverall(Math.round((done + failed) / total * 100), (done + failed) + ' of ' + total);
      await tick();
    }
    renderResults();
    converting = false; this.disabled = false;
    var msg = failed ? nf(done) + ' of ' + plural(total, 'file') + ' converted, ' + nf(failed) + ' failed' : (total === 1 ? 'Your file is converted' : 'All ' + nf(total) + ' files converted');
    setOverall(100, (done + failed) + ' of ' + total);
    if (done) { EC.sound.play('all'); logEvent('all-done', { done: done, failed: failed }); }
    announce(msg + (done ? (done === 1 ? '. Download it below.' : '. Download them below.') : '.'), { long: true });
  });

  $('download-all').addEventListener('click', async function () {
    var ok = items.filter(function (x) { return x.state === 'done'; });
    if (!ok.length) return;
    var used = {}, files = [];
    for (var i = 0; i < ok.length; i++) {
      var n = ok[i].result.filename, k = n, c = 2;
      while (used[k]) { k = n.replace(/(\.[^.]+)$/, ' (' + c++ + ')$1'); }
      used[k] = 1;
      files.push({ name: k, data: new Uint8Array(await ok[i].result.blob.arrayBuffer()) });
    }
    save(EC.zip.makeZip(files), 'Easyconvert-converted-files.zip');
    announce('Downloading ' + plural(files.length, 'converted file') + ' as a ZIP');
  });

  /* ---------- reader ---------- */
  var exp = null, filtered = [], shown = 0, PAGE = 100, current = null;
  var listEl = $('conv-list'), layout = document.querySelector('.reader-layout');

  async function openExport(file) {
    var reader = $('reader'), bar = $('load-bar');
    reader.hidden = false; $('load-progress').hidden = false; bar.value = 0;
    $('export-summary').textContent = ''; listEl.replaceChildren(); $('conv-view').hidden = true;
    $('reader-title').setAttribute('tabindex', '-1');
    announce('Opening ' + file.name);
    var t0 = performance.now();
    try {
      exp = await EC.claude.load(file, function (p) {
        bar.value = p.percent;
        $('load-label').textContent = p.message + ' (' + Math.round(p.percent) + '%)';
        announceProgress(p.message + ', ' + Math.round(p.percent) + ' percent');
      });
    } catch (err) {
      $('load-progress').hidden = true;
      $('export-summary').textContent = 'This export could not be opened: ' + err.message;
      EC.sound.play('error'); announce('This export could not be opened. ' + err.message, { assertive: true });
      return;
    }
    logEvent('export-loaded', { conversations: exp.conversations.length, ms: Math.round(performance.now() - t0) });
    $('load-progress').hidden = true;
    var cs = exp.conversations, msgs = cs.reduce(function (n, c) { return n + c.count; }, 0);
    var dates = cs.map(function (c) { return c.created; }).filter(Boolean).sort(function (a, b) { return a - b; });
    var range = dates.length ? ' from ' + EC.claude.dateFmt(dates[0], { dateStyle: 'medium' }) + ' to ' + EC.claude.dateFmt(dates[dates.length - 1], { dateStyle: 'medium' }) : '';
    $('export-summary').textContent = plural(cs.length, 'conversation') + ' and ' + plural(msgs, 'message') + range + '.' + (exp.user && exp.user.name ? ' Account: ' + exp.user.name + '.' : '') + (exp.projects.length ? ' ' + plural(exp.projects.length, 'project') + '.' : '');
    if (dates.length) {
      var iso = function (t) { var d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
      ['date-from', 'date-to'].forEach(function (id) { $(id).min = iso(dates[0]); $(id).max = iso(dates[dates.length - 1]); });
    }
    renderProjects();
    $('skip-search').hidden = false;
    applyFilters(true);
    EC.sound.play('open');
    $('reader-title').focus();
    announce('Export opened: ' + $('export-summary').textContent + ' Use the search field to find a conversation.', { long: true });
  }

  function renderProjects() {
    var box = $('project-list'); box.replaceChildren();
    $('projects').hidden = !exp.projects.length;
    $('projects-title').textContent = 'Projects (' + exp.projects.length + ')';
    exp.projects.forEach(function (p) {
      var d = document.createElement('div'); d.className = 'project';
      d.innerHTML = '<h4>' + esc(p.name) + '</h4>' + (p.description ? '<p>' + esc(p.description) + '</p>' : '') +
        (p.prompt ? '<details class="extra"><summary>Project instructions</summary><pre tabindex="0">' + esc(p.prompt) + '</pre></details>' : '') +
        p.docs.map(function (doc) { return '<details class="extra"><summary>Document: ' + esc(doc.name) + '</summary><pre tabindex="0">' + esc(doc.content) + '</pre></details>'; }).join('');
      box.appendChild(d);
    });
  }

  var searchTimer = null;
  $('conv-search').addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(function () { applyFilters(); }, 220); });
  ['search-scope', 'date-from', 'date-to', 'sort'].forEach(function (id) { $(id).addEventListener('change', function () { applyFilters(); }); });
  $('clear-filters').addEventListener('click', function () {
    $('conv-search').value = ''; $('date-from').value = ''; $('date-to').value = ''; $('search-scope').value = 'all'; $('sort').value = 'new';
    applyFilters(); $('conv-search').focus();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && exp && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); $('conv-search').focus(); }
    if (e.key === 'Escape' && layout.classList.contains('viewing') && window.matchMedia('(max-width: 820px)').matches) closeConversation();
  });
  $('conv-search').setAttribute('aria-keyshortcuts', '/');

  function query() { return $('conv-search').value.trim().toLowerCase(); }
  function applyFilters(initial) {
    if (!exp) return;
    var q = query(), scope = $('search-scope').value;
    var from = $('date-from').value ? new Date($('date-from').value + 'T00:00:00').getTime() : null;
    var to = $('date-to').value ? new Date($('date-to').value + 'T23:59:59.999').getTime() : null;
    var terms = q ? q.split(/\s+/) : [];
    filtered = exp.conversations.filter(function (c) {
      if (from != null && (c.created == null || c.created < from)) return false;
      if (to != null && (c.created == null || c.created > to)) return false;
      if (!terms.length) return true;
      var hay = scope === 'title' ? c.titleLower : c.textLower;
      for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) < 0) return false;
      return true;
    });
    var s = $('sort').value;
    filtered.sort(s === 'old' ? function (a, b) { return (a.created || 0) - (b.created || 0); } : s === 'long' ? function (a, b) { return b.count - a.count; } : s === 'az' ? function (a, b) { return a.title.localeCompare(b.title); } : function (a, b) { return (b.created || 0) - (a.created || 0); });
    shown = 0; listEl.replaceChildren(); renderMore(false);
    var msg = filtered.length === exp.conversations.length && !terms.length ? plural(filtered.length, 'conversation') : plural(filtered.length, 'conversation') + ' match' + (filtered.length === 1 ? 'es' : '') + (q ? ' “' + $('conv-search').value.trim() + '”' : ' the filters');
    $('result-count').textContent = msg + (filtered.length > shown ? ', showing ' + nf(shown) : '') + '.';
    if (!initial) announce(msg);
    $('bulk-download').disabled = !filtered.length;
  }

  function snippet(c, q) {
    if (!q) return '';
    var first = q.split(/\s+/)[0];
    for (var i = 0; i < c.messages.length; i++) {
      var m = c.messages[i], txt = m.parts.map(function (p) { return p.text; }).join(' ').replace(/\s+/g, ' ');
      var at = txt.toLowerCase().indexOf(first);
      if (at >= 0) {
        var s = Math.max(0, at - 50), e = Math.min(txt.length, at + first.length + 70);
        return EC.claude.speaker(m) + ': ' + (s ? '…' : '') + txt.slice(s, e).replace(/```+\w*|[*_`#>]{1,3}(?=\S)|(?<=\S)[*_`]{1,3}/g, '') + (e < txt.length ? '…' : '');
      }
    }
    return '';
  }
  function highlight(text, q) {
    var h = esc(text); if (!q) return h;
    q.split(/\s+/).filter(Boolean).forEach(function (t) {
      var re = new RegExp('(' + esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      h = h.replace(/(^|>)([^<]*)(?=<|$)/g, function (_, a, b) { return a + b.replace(re, '<mark>$1</mark>'); });
    });
    return h;
  }
  function renderMore(focusNew) {
    var q = query(), start = shown, end = Math.min(filtered.length, shown + PAGE), frag = document.createDocumentFragment();
    for (var i = start; i < end; i++) {
      var c = filtered[i], li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.className = 'conv-item'; b.dataset.id = c.id;
      if (current && current.id === c.id) b.setAttribute('aria-current', 'true');
      var sn = $('search-scope').value === 'all' && q && c.titleLower.indexOf(q.split(/\s+/)[0]) < 0 ? snippet(c, q) : '';
      b.innerHTML = '<span class="t">' + highlight(c.title, q) + '</span><span class="d">' + esc(c.created ? EC.claude.dateFmt(c.created, { dateStyle: 'medium' }) : 'No date') + ' · ' + plural(c.count, 'message') + '</span>' + (sn ? '<span class="s">' + highlight(sn, q) + '</span>' : '');
      li.appendChild(b); frag.appendChild(li);
    }
    listEl.appendChild(frag);
    shown = end;
    var more = $('show-more');
    more.hidden = shown >= filtered.length;
    more.textContent = 'Show ' + nf(Math.min(PAGE, filtered.length - shown)) + ' more (' + nf(filtered.length - shown) + ' left)';
    if (!filtered.length) listEl.innerHTML = '<li class="empty">No conversations match. Try another word or clear the filters.</li>';
    if (focusNew && listEl.children[start]) listEl.children[start].querySelector('button').focus();
  }
  $('show-more').addEventListener('click', function () {
    renderMore(true);
    $('result-count').textContent = $('result-count').textContent.replace(/, showing [\d,.\s]+/, '').replace(/\.$/, '') + (filtered.length > shown ? ', showing ' + nf(shown) : '') + '.';
    announce('Showing ' + nf(shown) + ' of ' + plural(filtered.length, 'conversation'));
  });
  listEl.addEventListener('click', function (e) { var b = e.target.closest('.conv-item'); if (b) openConversation(b.dataset.id, true); });

  /* one conversation */
  var marks = [], markAt = -1;
  function partHTML(p) {
    if (p.kind === 'text') return mdHTML(p.text);
    var label = p.kind === 'thinking' ? 'Claude’s thinking' : p.kind === 'tool_use' ? 'Used tool: ' + p.name : 'Tool result' + (p.name ? ': ' + p.name : '');
    return '<details class="extra"><summary>' + esc(label) + '</summary>' + (p.kind === 'thinking' ? mdHTML(p.text) : '<pre tabindex="0">' + esc(p.text) + '</pre>') + '</details>';
  }
  // headings inside a message start at h5 (under the h4 speaker heading) and never skip a level
  function mdHTML(text) {
    var bl = EC.md.parse(text), min = Math.min.apply(null, bl.filter(function (b) { return b.type === 'h'; }).map(function (b) { return b.level; }).concat([6]));
    return EC.md.toHTML(bl, 6 - min);
  }
  function openConversation(id, userAction) {
    var c = exp.conversations.find(function (x) { return x.id === id; });
    if (!c) return;
    current = c;
    listEl.querySelectorAll('.conv-item').forEach(function (b) { if (b.dataset.id === id) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
    $('conv-title').textContent = c.title;
    $('conv-meta').textContent = 'Started ' + (c.created ? EC.claude.dateFmt(c.created) : 'on an unknown date') + ' · ' + plural(c.count, 'message');
    var box = $('messages'); box.replaceChildren();
    var frag = document.createDocumentFragment();
    c.messages.forEach(function (m, i) {
      var a = document.createElement('article'), who = EC.claude.speaker(m), hid = 'msg-h-' + i;
      a.className = 'message ' + m.sender; a.setAttribute('aria-labelledby', hid); a.dataset.index = i;
      var when = m.created ? EC.claude.dateFmt(m.created) : '';
      a.innerHTML = '<header><h4 id="' + hid + '">' + who + '</h4>' + (when ? '<time datetime="' + new Date(m.created).toISOString() + '">' + esc(when) + '</time>' : '') + '</header>' +
        '<div class="body">' + (m.parts.length ? m.parts.map(partHTML).join('') : '<p class="meta">(empty message)</p>') +
        m.attachments.map(function (at) { return '<details class="extra"><summary>Attachment: ' + esc(at.name) + (at.size ? ' (' + EC.claude.fmtSize(at.size) + ')' : '') + '</summary>' + (at.content ? '<pre tabindex="0">' + esc(at.content) + '</pre>' : '<p class="meta">No text was included for this attachment.</p>') + '</details>'; }).join('') +
        (m.files.length ? '<p class="meta">Files: ' + m.files.map(function (f) { return esc(f.name); }).join(', ') + ' (not included in the export)</p>' : '') + '</div>' +
        '<div class="msg-actions"><button type="button" class="secondary small" data-copy-msg="' + i + '">Copy message<span class="visually-hidden"> ' + (i + 1) + ' from ' + who + '</span></button></div>';
      frag.appendChild(a);
    });
    box.appendChild(frag);
    var view = $('conv-view'); view.hidden = false;
    layout.classList.add('viewing');
    // search matches inside the conversation
    marks = []; markAt = -1;
    var q = query();
    if (q && $('search-scope').value === 'all') markMatches(box, q);
    $('find-bar').hidden = !marks.length;
    if (userAction) {
      if (location.hash !== '#c=' + encodeURIComponent(id)) history.pushState({ c: id }, '', '#c=' + encodeURIComponent(id));
      $('conv-title').setAttribute('tabindex', '-1');
      $('conv-title').focus();
      if (!window.matchMedia('(max-width: 820px)').matches) view.scrollIntoView({ block: 'start' });
      announce('Opened ' + c.title + ', ' + plural(c.count, 'message') + (marks.length ? ', ' + plural(marks.length, 'match') + ' for “' + $('conv-search').value.trim() + '”. Use Next match to jump.' : ''));
    }
    logEvent('open-conversation', c.id);
  }
  function markMatches(root, q) {
    var terms = q.split(/\s+/).filter(Boolean), walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { return n.parentElement.closest('button, .code-head') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } }), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    var re = new RegExp(terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'), 'gi');
    nodes.forEach(function (n) {
      var t = n.nodeValue; re.lastIndex = 0; if (!re.test(t)) return; re.lastIndex = 0;
      var frag = document.createDocumentFragment(), last = 0, m;
      while ((m = re.exec(t))) {
        if (m.index > last) frag.appendChild(document.createTextNode(t.slice(last, m.index)));
        var mk = document.createElement('mark'); mk.textContent = m[0]; mk.tabIndex = -1; frag.appendChild(mk); marks.push(mk);
        last = re.lastIndex;
      }
      frag.appendChild(document.createTextNode(t.slice(last)));
      n.parentNode.replaceChild(frag, n);
    });
    $('find-status').textContent = marks.length ? plural(marks.length, 'match') + ' in this conversation' : '';
  }
  function gotoMark(d) {
    if (!marks.length) return;
    if (markAt >= 0) marks[markAt].classList.remove('current');
    markAt = (markAt + d + marks.length) % marks.length;
    var mk = marks[markAt]; mk.classList.add('current');
    var det = mk.closest('details'); if (det) det.open = true;
    mk.focus(); mk.scrollIntoView({ block: 'center' });
    var art = mk.closest('article'), who = art ? art.querySelector('h4').textContent : '';
    $('find-status').textContent = 'Match ' + (markAt + 1) + ' of ' + marks.length;
    announce('Match ' + (markAt + 1) + ' of ' + marks.length + (who ? ', in a message from ' + who : '') + ': ' + (mk.parentElement.textContent || '').slice(0, 140));
  }
  $('find-next').addEventListener('click', function () { gotoMark(1); });
  $('find-prev').addEventListener('click', function () { gotoMark(-1); });

  function closeConversation() {
    layout.classList.remove('viewing');
    var b = current && listEl.querySelector('.conv-item[data-id="' + CSS.escape(current.id) + '"]');
    if (window.matchMedia('(max-width: 820px)').matches) $('conv-view').hidden = true;
    (b || $('conv-search')).focus();
  }
  $('back').addEventListener('click', function () { if (history.state && history.state.c) history.back(); else closeConversation(); });
  window.addEventListener('popstate', function () {
    var m = /^#c=(.+)$/.exec(location.hash);
    if (m && exp) openConversation(decodeURIComponent(m[1]), false); else if (exp) closeConversation();
  });

  $('messages').addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy-msg]');
    if (b && current) {
      var m = current.messages[+b.getAttribute('data-copy-msg')];
      copyText(m.parts.map(function (p) { return p.text; }).join('\n\n'), 'Message from ' + EC.claude.speaker(m));
    }
  });
  // copy buttons on code blocks, anywhere
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.copy-code'); if (!b) return;
    var pre = b.closest('.code-block').querySelector('pre');
    copyText(pre.textContent, 'Code');
    var label = b.firstChild; label.nodeValue = 'Copied';
    setTimeout(function () { label.nodeValue = 'Copy code'; }, 1500);
  });

  function convDoc(c) {
    return {
      title: c.title, kind: 'claude', blocks: EC.claude.conversationBlocks(c, 1),
      json: { id: c.id, title: c.title, created: c.created && new Date(c.created).toISOString(), messages: c.messages.map(function (m) { return { sender: m.sender, created: m.created && new Date(m.created).toISOString(), text: m.parts.map(function (p) { return p.text; }).join('\n\n'), attachments: m.attachments.map(function (a) { return a.name; }), files: m.files.map(function (f) { return f.name; }) }; }) },
      rows: [['speaker', 'time', 'text']].concat(c.messages.map(function (m) { return [EC.claude.speaker(m), m.created ? new Date(m.created).toISOString() : '', m.parts.map(function (p) { return p.text; }).join('\n\n')]; }))
    };
  }
  document.querySelector('.conv-tools').addEventListener('click', function (e) {
    var b = e.target.closest('[data-export]'); if (!b || !current) return;
    var out = EC.convert.render(convDoc(current), b.getAttribute('data-export'), safeName(current.title) + '.x');
    save(out.blob, out.filename);
    EC.sound.play('file');
    announce('Saved ' + out.filename);
  });
  $('print').addEventListener('click', function () { window.print(); });
  $('copy-conv').addEventListener('click', function () { if (current) copyText(EC.md.toText(EC.claude.conversationBlocks(current, 1)), 'Conversation'); });

  $('bulk-download').addEventListener('click', async function () {
    if (!filtered.length) return;
    var fmt = $('bulk-format').value, files = [], used = {}, btn = this;
    btn.disabled = true;
    announce('Preparing ' + plural(filtered.length, 'conversation') + '…');
    for (var i = 0; i < filtered.length; i++) {
      var c = filtered[i], d = c.created ? new Date(c.created).toISOString().slice(0, 10) + ' ' : '';
      var out = EC.convert.render(convDoc(c), fmt, safeName(d + c.title) + '.x');
      var n = out.filename, k = n, x = 2; while (used[k]) k = n.replace(/(\.[^.]+)$/, ' (' + x++ + ')$1'); used[k] = 1;
      files.push({ name: k, data: new Uint8Array(await out.blob.arrayBuffer()) });
      if (i % 50 === 49) { announceProgress('Prepared ' + nf(i + 1) + ' of ' + nf(filtered.length)); await tick(); }
    }
    save(EC.zip.makeZip(files), 'Claude conversations (' + EC.convert.FORMATS[fmt].label.replace(/[()]/g, '') + ').zip');
    btn.disabled = false;
    EC.sound.play('all');
    announce('Downloading ' + plural(files.length, 'conversation') + ' as a ZIP', { long: true });
  });

  renderResults();
  window.addEventListener('error', function (e) { announce('Something went wrong: ' + e.message, { assertive: true }); });
  window.addEventListener('unhandledrejection', function (e) { announce('Something went wrong: ' + (e.reason && e.reason.message || e.reason), { assertive: true }); });
})(window.EC = window.EC || {});
