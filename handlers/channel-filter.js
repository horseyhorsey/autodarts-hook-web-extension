(function() {
  // ChannelFilter
  class ChannelFilter {
    // Try to get a channel name from a raw string/object without a full json parse
    static extractChannel(rawData) {
      if (!rawData) return null;
      // If object, do a cheap top-level key scan
      if (typeof rawData === 'object' && rawData !== null) {
        const KEYS = ['channel', 'topic', 'event', 'name', 'type'];
        for (const k of KEYS) if (typeof rawData[k] === 'string' && rawData[k]) return rawData[k];
        return null;
      }
      if (typeof rawData !== 'string') return null;
      const s = rawData;
      if (s === '(binary data)') return null;
      let idx = s.indexOf('"channel"');
      if (idx === -1) idx = s.indexOf('"Channel"');
      if (idx === -1) idx = s.indexOf("'channel'");
      if (idx === -1) idx = s.indexOf("'Channel'");
      if (idx !== -1) {
        let i = s.indexOf(':', idx + 1);
        if (i === -1) return null;
        i++; while (i < s.length && /\s/.test(s[i])) i++;
        const quote = s[i];
        if (quote === '"' || quote === "'") {
          let start = i + 1; let esc = false;
          for (let j = start; j < s.length; j++) {
            const ch = s[j];
            if (ch === quote && !esc) return s.slice(start, j);
            esc = (ch === '\\' && !esc);
          }
          return null;
        }
        // unquoted token (rare)
        let start = i; while (start < s.length && /\s/.test(s[start])) start++;
        let j = start; while (j < s.length && /[^,\]\}\s]/.test(s[j])) j++;
        let token = s.slice(start, j);
        return token.replace(/^['"]|['"]$/g, '') || null;
      }
      const m = /["']channel["']\s*:\s*["']([^"']+)["']/i.exec(s);
      if (m && m[1]) return m[1];
      return null;
    }
  }

  self.ChannelFilter = ChannelFilter;
})();
