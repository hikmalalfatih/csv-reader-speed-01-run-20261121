// Fast drop-in for make.fun's csv-reader 1.0.0 (csv-reader-speed-01-run-20261121).
//
// run(input) returns exactly what csv-reader 1.0.0's readCsv returns for the same
// {text, header}: {columns, rows, errors}. Written from scratch against the
// reference's documented policy (RULES.txt + vendor/csv-reader/index.js header):
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not doubled,
//     "" inside it is one quote, each CRLF or lone CR inside it reads as LF;
//     what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that
//     never closes is a literal character and the text after it is read again
//     as an unquoted field (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it, each padded with "" (short_row, with fields: its
//     count) or cut (long_row, with extra: the cut fields) to the first
//     record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts
//     on (every LF, CRLF and lone CR inside a quoted field counted), row its
//     record's index in rows (null for the header), in the order met.
//
// Speed: the reference builds every field one character at a time. This reader
// instead slices fields out of the text with native scans: one RegExp scan
// (/[,\n\r]/) per unquoted field, indexOf('"') per quoted field, and slice()
// for the field values, so no per-character concatenation happens anywhere.
// A quoted field whose content holds no CR/LF and no doubled quote is a single
// slice; only the rare broken/embedded-newline paths allocate extra parts.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the
// next (the shared RegExp is only ever used with lastIndex set before exec).

/** One RegExp scan for the next field terminator: comma, LF or CR. */
const FIELD_END = /[,\n\r]/g;

/** What follows a CR or LF inside a quoted field: each counts one line. */
const QUOTED_BREAK = /\r\n|\r|\n/g;

/** How a field ended: at a comma (the record goes on), at a line break or at the end of the text (the record ends). */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // Reads unquoted characters from pos, starting with `prefix` already kept
  // ('' normally, the opening '"' of a quote that never closes, or a quoted
  // field's value when junk follows its closing quote), up to the next comma
  // or line break: a CR not followed by LF is dropped (stray_cr). Returns the
  // field, how it ended, and how many characters were kept after `prefix`.
  // Two indexOf scans find the field end (comma or LF); a CR inside the slice
  // is rare, so it is checked on the short slice and handled on a slow path.
  function readUnquoted(prefix) {
    {
      let c = text.indexOf(',', pos);
      let n = text.indexOf('\n', pos);
      let end;
      let ended;
      if (c === -1 && n === -1) { end = len; ended = END; }
      else if (c === -1) { end = n; ended = LINE_BREAK; }
      else if (n === -1) { end = c; ended = COMMA; }
      else if (c < n) { end = c; ended = COMMA; }
      else { end = n; ended = LINE_BREAK; }
      const seg = text.slice(pos, end);
      const r = seg.indexOf('\r');
      if (r === -1) {
        pos = ended === END ? len : end + 1;
        if (ended === LINE_BREAK) line += 1;
        if (prefix === '') return { value: seg, ended, added: seg.length };
        const value = prefix + seg;
        return { value, ended, added: seg.length };
      }
      // Slow path: the field holds CRs. A CR immediately before the LF
      // that ends the field is the record's CRLF break; any other CR is stray.
      let value = prefix;
      let start = pos;
      let i = pos + r;
      for (;;) {
        if (ended === LINE_BREAK && i === end - 1) {
          value += text.slice(start, i);
          pos = end + 1;
          line += 1;
          return { value, ended: LINE_BREAK, added: value.length - prefix.length };
        }
        if (i >= end) {
          value += text.slice(start, end);
          pos = ended === END ? len : end + 1;
          if (ended === LINE_BREAK) line += 1;
          return { value, ended, added: value.length - prefix.length };
        }
        // Lone CR inside the field: dropped (stray_cr), field goes on.
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        value += text.slice(start, i);
        i += 1;
        start = i;
        const nx = text.indexOf('\r', i);
        i = nx === -1 || nx >= end ? end : nx;
      }
    }
  }

  // Normalises one stretch inside a quoted field: CRLF and lone CR each read
  // as LF, and counts the line breaks it holds. The common stretch holds
  // neither, so it comes back untouched.
  function quotedStretch(seg) {
    if (seg.indexOf('\r') === -1 && seg.indexOf('\n') === -1) return { value: seg, lines: 0 };
    const breaks = seg.match(QUOTED_BREAK);
    return { value: seg.replace(/\r\n?/g, '\n'), lines: breaks === null ? 0 : breaks.length };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let start = pos + 1;
    let search = start;
    let parts = null; // stretches joined with '"' for each doubled quote
    let lineDelta = 0; // line breaks inside the quotes, applied once it closes
    for (;;) {
      const q = text.indexOf('"', search);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted. The line breaks tentatively
        // counted inside it do not stand.
        line = openLine;
        pos = open + 1;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      if (q + 1 < len && text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the value, and the field goes on.
        const seg = quotedStretch(text.slice(start, q));
        if (parts === null) parts = [];
        parts.push(seg.value, '"');
        lineDelta += seg.lines;
        search = q + 2;
        start = q + 2;
        continue;
      }
      // The closing quote.
      const seg = quotedStretch(text.slice(start, q));
      lineDelta += seg.lines;
      let value;
      if (parts === null) {
        value = seg.value;
      } else {
        parts.push(seg.value);
        value = parts.join('');
      }
      line += lineDelta;
      pos = q + 1;
      if (pos >= len) return { value, ended: END, added: 0 };
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return { value, ended: COMMA, added: 0 };
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK, added: 0 };
      }
      if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return { value, ended: LINE_BREAK, added: 0 };
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      const junk = readUnquoted(value);
      if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return junk;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
