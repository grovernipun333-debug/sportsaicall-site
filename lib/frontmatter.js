// Tiny, dependency-free YAML-frontmatter reader, purpose-built for the
// specific shapes Decap CMS writes for this project's "matches" collection:
// plain/quoted strings, numbers, flat lists of strings, and flat lists of
// small objects (e.g. matchups: [{player_a, player_b, note}]). This is NOT
// a general YAML parser — it deliberately only supports what our
// content/matches/*.md files actually contain, so the site's build has
// zero external dependencies (nothing to `npm install`, nothing that can
// break from a registry hiccup).

function unquote(raw) {
  let v = raw.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      v = v.slice(1, -1);
      if (first === '"') {
        v = v.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      } else {
        v = v.replace(/''/g, "'");
      }
      return v;
    }
  }
  return v;
}

function coerceScalar(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return unquote(v);
}

function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

// Parses a block of lines (all belonging to the same nesting level) into
// either a mapping object or a list, starting at `start`. `baseIndent` is
// the indentation those lines share. Returns { value, next }.
function parseBlock(lines, start, baseIndent) {
  if (start >= lines.length) return { value: '', next: start };

  const firstLine = lines[start];
  const isList = /^\s*-(\s|$)/.test(firstLine);

  if (isList) {
    const items = [];
    let i = start;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      const ind = indentOf(line);
      if (ind < baseIndent) break;
      if (ind === baseIndent && /^\s*-(\s|$)/.test(line)) {
        const afterDash = line.replace(/^\s*-\s?/, '');
        const kv = afterDash.match(/^(\w[\w-]*):\s*(.*)$/);
        if (afterDash.trim() === '') {
          // "- " with nested content on following lines only (rare for us) — skip as empty item.
          items.push('');
          i++;
        } else if (kv) {
          // Item is a mapping; first pair is inline, rest are indented lines
          // more than baseIndent, read until we hit a sibling "-" or dedent.
          const obj = {};
          obj[kv[1]] = coerceScalar(kv[2]);
          let j = i + 1;
          while (j < lines.length) {
            const l2 = lines[j];
            if (!l2.trim()) {
              j++;
              continue;
            }
            const ind2 = indentOf(l2);
            if (ind2 <= baseIndent) break;
            const kv2 = l2.match(/^\s*(\w[\w-]*):\s*(.*)$/);
            if (!kv2) break;
            obj[kv2[1]] = coerceScalar(kv2[2]);
            j++;
          }
          items.push(obj);
          i = j;
        } else {
          items.push(coerceScalar(afterDash));
          i++;
        }
      } else {
        break;
      }
    }
    return { value: items, next: i };
  }

  // Mapping block.
  const obj = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const ind = indentOf(line);
    if (ind < baseIndent) break;
    if (ind > baseIndent) {
      i++;
      continue;
    }
    const m = line.match(/^\s*(\w[\w-]*):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const rest = m[2];
    if (rest.trim() === '') {
      // Nested block (list or mapping) — figure out its indent from the next non-empty line.
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && indentOf(lines[j]) > baseIndent) {
        const nestedIndent = indentOf(lines[j]);
        const { value, next } = parseBlock(lines, j, nestedIndent);
        obj[key] = value;
        i = next;
      } else {
        obj[key] = '';
        i++;
      }
    } else {
      obj[key] = coerceScalar(rest);
      i++;
    }
  }
  return { value: obj, next: i };
}

function parseFrontmatter(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  if (lines[0].trim() !== '---') {
    return { data: {} };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return { data: {} };

  const body = lines.slice(1, end);
  const { value } = parseBlock(body, 0, 0);
  return { data: value && typeof value === 'object' && !Array.isArray(value) ? value : {} };
}

module.exports = { parseFrontmatter };
