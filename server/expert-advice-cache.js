'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const KIND = 'roofrisk_advice_cache_v1';

// Instance-local, bounded cache; this is not a database or a cloud persistence
// guarantee. Stored values contain validated advice, not the original input.
function createAdviceCache({ directory = null, ttlMs = 86400000, limit = 64, now = Date.now } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || !Number.isInteger(limit) || limit < 1 || limit > 256) throw new TypeError('Invalid advice cache bounds');
  const entries = new Map();
  const validKey = key => { if (!/^[a-f0-9]{64}$/.test(key)) throw new TypeError('Invalid advice cache key'); };
  const file = key => path.join(directory, `${key}.json`);
  function read(key) {
    try {
      if (fs.statSync(file(key)).size > 65536) return null;
      const item = JSON.parse(fs.readFileSync(file(key), 'utf8'));
      return item.kind === KIND && item.key === key && Number.isFinite(item.created_ms) && Number.isFinite(item.expires_ms) ? item : null;
    } catch { return null; }
  }
  function pruneDisk() {
    const owned = fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
      .map(name => read(name.slice(0, -5))).filter(Boolean).sort((a, b) => b.created_ms - a.created_ms || b.key.localeCompare(a.key));
    owned.slice(limit).forEach(item => fs.unlinkSync(file(item.key)));
  }
  return {
    storage: directory ? 'instance_file' : 'process_memory',
    get(key) {
      validKey(key);
      const item = entries.get(key) || (directory ? read(key) : null), current = now();
      if (!item || item.expires_ms <= current || item.created_ms > current || item.expires_ms - item.created_ms > ttlMs) { entries.delete(key); return null; }
      return structuredClone(item.value);
    },
    set(key, value) {
      validKey(key);
      const current = now();
      const item = { kind: KIND, key, created_ms: current, expires_ms: current + ttlMs, value: structuredClone(value) };
      entries.delete(key); entries.set(key, item);
      while (entries.size > limit) entries.delete(entries.keys().next().value);
      if (directory) {
        let temporary;
        try {
          fs.mkdirSync(directory, { recursive: true });
          temporary = path.join(directory, `${key}.${randomUUID()}.tmp`);
          const text = JSON.stringify(item);
          if (Buffer.byteLength(text) > 65536) return;
          fs.writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
          fs.renameSync(temporary, file(key)); temporary = null; pruneDisk();
        } catch { /* Optional cache I/O must not suppress a validated live result. */ }
        finally { if (temporary) try { fs.unlinkSync(temporary); } catch { /* Best-effort own temporary only. */ } }
      }
    },
  };
}
module.exports = { createAdviceCache };
