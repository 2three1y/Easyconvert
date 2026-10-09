/* Easyconvert: tiny offline ZIP reader + writer. No network, no dependencies.
   Reader: streams each entry through the browser's DecompressionStream ("deflate-raw").
   Writer: "stored" entries with real CRC-32, which Word, LibreOffice and every unzip tool accept. */
(function (EC) {
  'use strict';
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  var enc = new TextEncoder();

  function canInflate() { return typeof DecompressionStream === 'function'; }

  /* ---------- Reader ---------- */
  async function readZip(file) {
    var size = file.size;
    var tailLen = Math.min(size, 65557 + 22);
    var tail = new DataView(await file.slice(size - tailLen).arrayBuffer());
    var eocd = -1;
    for (var i = tail.byteLength - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This file is not a ZIP archive, or it is damaged.');
    var count = tail.getUint16(eocd + 10, true);
    var cdSize = tail.getUint32(eocd + 12, true);
    var cdOffset = tail.getUint32(eocd + 16, true);
    if (cdOffset === 0xFFFFFFFF || count === 0xFFFF) {
      // ZIP64: read the ZIP64 end record through its locator.
      var loc = eocd - 20;
      if (loc >= 0 && tail.getUint32(loc, true) === 0x07064b50) {
        var z64off = Number(tail.getBigUint64(loc + 8, true));
        var z = new DataView(await file.slice(z64off, z64off + 56).arrayBuffer());
        count = Number(z.getBigUint64(32, true));
        cdSize = Number(z.getBigUint64(40, true));
        cdOffset = Number(z.getBigUint64(48, true));
      }
    }
    var cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    var dec = new TextDecoder();
    var entries = [];
    var p = 0;
    for (var e = 0; e < count && p + 46 <= cd.byteLength; e++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      var flags = cd.getUint16(p + 8, true);
      var method = cd.getUint16(p + 10, true);
      var compSize = cd.getUint32(p + 20, true);
      var usize = cd.getUint32(p + 24, true);
      var nameLen = cd.getUint16(p + 28, true);
      var extraLen = cd.getUint16(p + 30, true);
      var commentLen = cd.getUint16(p + 32, true);
      var offset = cd.getUint32(p + 42, true);
      var nameBytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen);
      var name = dec.decode(nameBytes);
      // ZIP64 extra field
      var x = p + 46 + nameLen, xEnd = x + extraLen;
      while (x + 4 <= xEnd) {
        var id = cd.getUint16(x, true), len = cd.getUint16(x + 2, true), q = x + 4;
        if (id === 0x0001) {
          if (usize === 0xFFFFFFFF) { usize = Number(cd.getBigUint64(q, true)); q += 8; }
          if (compSize === 0xFFFFFFFF) { compSize = Number(cd.getBigUint64(q, true)); q += 8; }
          if (offset === 0xFFFFFFFF) { offset = Number(cd.getBigUint64(q, true)); q += 8; }
        }
        x += 4 + len;
      }
      entries.push({ name: name, method: method, compressedSize: compSize, size: usize, offset: offset, encrypted: !!(flags & 1), dir: /\/$/.test(name) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { file: file, entries: entries, find: function (re) { return entries.filter(function (en) { return !en.dir && re.test(en.name); }); } };
  }

  async function entryStream(zip, entry) {
    if (entry.encrypted) throw new Error(entry.name + ' is password protected.');
    var head = new DataView(await zip.file.slice(entry.offset, entry.offset + 30).arrayBuffer());
    if (head.getUint32(0, true) !== 0x04034b50) throw new Error('Damaged ZIP entry: ' + entry.name);
    var start = entry.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    var raw = zip.file.slice(start, start + entry.compressedSize).stream();
    if (entry.method === 0) return raw;
    if (entry.method === 8) {
      if (!canInflate()) throw new Error('This browser cannot unzip files. Unzip the export first, then open conversations.json.');
      return raw.pipeThrough(new DecompressionStream('deflate-raw'));
    }
    throw new Error('Unsupported compression in ' + entry.name);
  }

  /* Read an entry fully. onProgress(bytesDone, bytesTotal) */
  async function entryBytes(zip, entry, onProgress) {
    var reader = (await entryStream(zip, entry)).getReader();
    var chunks = [], done = 0;
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      chunks.push(r.value); done += r.value.length;
      if (onProgress) onProgress(done, entry.size);
    }
    var out = new Uint8Array(done), o = 0;
    chunks.forEach(function (c) { out.set(c, o); o += c.length; });
    return out;
  }
  async function entryText(zip, entry, onProgress) {
    var reader = (await entryStream(zip, entry)).getReader();
    var td = new TextDecoder('utf-8'), parts = [], done = 0;
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      done += r.value.length;
      parts.push(td.decode(r.value, { stream: true }));
      if (onProgress) onProgress(done, entry.size);
    }
    parts.push(td.decode());
    return parts.join('');
  }

  /* ---------- Writer ---------- */
  function dosTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2)),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }
  /* files: [{name, data: string|Uint8Array}] -> Blob */
  function makeZip(files, mime) {
    var now = dosTime(new Date());
    var parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      var name = enc.encode(f.name);
      var crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, now.time, true); lh.setUint16(12, now.date, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, name, data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, now.time, true); ch.setUint16(14, now.date, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (n, b) { return n + b.byteLength; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end.buffer]), { type: mime || 'application/zip' });
  }

  EC.zip = { readZip: readZip, entryText: entryText, entryBytes: entryBytes, makeZip: makeZip, crc32: crc32, canInflate: canInflate };
})(window.EC = window.EC || {});
