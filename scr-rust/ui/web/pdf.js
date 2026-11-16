// Port para JavaScript de src-tauri/src/pdf.rs: escritor de PDF 1.4 mínimo
// (fontes Type 1 padrão, Windows-1252) e a linguagem visual dos relatórios.
(function (root) {
  'use strict';
  const W = (root.SCRWeb = root.SCRWeb || {});

  function fmt3(v) {
    let s = v.toFixed(3);
    s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '' ? '0' : s;
  }
  function rgb(hex) {
    const h = hex.replace(/^#+/, '');
    const c = (i) => (parseInt(h.slice(i, i + 2), 16) || 0) / 255;
    return `${fmt3(c(0))} ${fmt3(c(2))} ${fmt3(c(4))}`;
  }
  // Display de f64 do Rust para os valores usados (inteiros sem ".0").
  const disp = (v) => String(v);
  const f2 = (v) => v.toFixed(2);

  const T = {
    INK: '#0f2b28',
    MUTED: '#4b5f5c',
    SUBTLE: '#6b7f7c',
    LINE: '#d6e2df',
    LINE_STRONG: '#b7cbc7',
    SURFACE_2: '#eef4f3',
    BG: '#f3f7f6',
    PRIMARY: '#0f766e',
    WHITE: '#ffffff',
    PAGE_W: 842,
    PAGE_H: 595,
    MARGIN: 36,
    BOTTOM: 84,
  };

  function encoded(text) {
    const out = [];
    for (const ch of text) {
      const c = ch.codePointAt(0);
      if (c === 0x2013 || c === 0x2014) out.push(0x2d);
      else if (c === 0x2018 || c === 0x2019) out.push(0x27);
      else if (c === 0x201c || c === 0x201d) out.push(0x22);
      else if (c === 0x2022) out.push(0x95);
      else if (c <= 255) out.push(c);
      else out.push(0x3f);
    }
    return out;
  }
  const literal = (text) =>
    encoded(text)
      .map((c) => c.toString(16).toUpperCase().padStart(2, '0'))
      .join('');

  const ASCII = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
    556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,
    500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469,
    556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
    278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ];
  const BASE = {};
  for (const [to, from] of [
    ['a', 'áàâãä'],
    ['A', 'ÁÀÂÃÄ'],
    ['e', 'éêè'],
    ['E', 'ÉÊÈ'],
    ['i', 'íìî'],
    ['I', 'ÍÌÎ'],
    ['o', 'óôõòö'],
    ['O', 'ÓÔÕÒÖ'],
    ['u', 'úùûü'],
    ['U', 'ÚÙÛÜ'],
    ['c', 'ç'],
    ['C', 'Ç'],
    ['n', 'ñ'],
    ['N', 'Ñ'],
  ])
    for (const ch of from) BASE[ch] = to;

  /** Largura aproximada (métricas AFM da Helvetica) em pontos. */
  function width(text, size, bold) {
    let units = 0;
    for (const raw of text) {
      const ch = BASE[raw] || raw;
      const c = ch.codePointAt(0);
      units += c >= 32 && c <= 126 ? ASCII[c - 32] : c === 0xaa || c === 0xba ? 370 : 556;
    }
    return ((units * size) / 1000) * (bold ? 1.06 : 1);
  }

  // Equivalente a str::lines() do Rust.
  function lines(text) {
    if (text === '') return [];
    const parts = text.split('\n');
    if (parts[parts.length - 1] === '') parts.pop();
    return parts.map((p) => p.replace(/\r$/, ''));
  }

  /** Quebra o texto em linhas que cabem em `max` pontos. */
  function wrap(text, size, bold, max) {
    const out = [];
    for (const paragraph of lines(text)) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const pieces = [];
        let piece = '';
        for (const ch of word) {
          piece += ch;
          if (width(piece, size, bold) > max && [...piece].length > 1) {
            pieces.push([...piece].slice(0, -1).join(''));
            piece = ch;
          }
        }
        pieces.push(piece);
        for (const p of pieces) {
          const candidate = line === '' ? p : `${line} ${p}`;
          if (line !== '' && width(candidate, size, bold) > max) {
            out.push(line);
            line = p;
          } else line = candidate;
        }
      }
      out.push(line);
    }
    return out;
  }

  class Pdf {
    constructor(kicker, footer) {
      this.pages = [];
      this.page = '';
      this.y = 0;
      this.kicker = kicker;
      this.footer = footer;
      this.legend = [];
    }
    rect(x, y, w, h, fill, stroke) {
      if (stroke)
        this.page += `q ${rgb(fill)} rg ${rgb(stroke)} RG 0.6 w ${f2(x)} ${f2(y)} ${f2(w)} ${f2(h)} re B Q\n`;
      else this.page += `q ${rgb(fill)} rg ${f2(x)} ${f2(y)} ${f2(w)} ${f2(h)} re f Q\n`;
    }
    hline(x1, x2, y, color, w) {
      this.page += `q ${rgb(color)} RG ${disp(w)} w ${f2(x1)} ${f2(y)} m ${f2(x2)} ${f2(y)} l S Q\n`;
    }
    textAt(x, y, t, size, bold, color) {
      this.page += `BT /${bold ? 'F2' : 'F1'} ${disp(size)} Tf ${rgb(color)} rg 1 0 0 1 ${f2(x)} ${f2(y)} Tm <${literal(t)}> Tj ET\n`;
    }
    labelAt(x, y, t, size, color) {
      this.page += `BT /F2 ${disp(size)} Tf 0.6 Tc ${rgb(color)} rg 1 0 0 1 ${f2(x)} ${f2(y)} Tm <${literal(t.toUpperCase())}> Tj 0 Tc ET\n`;
    }
    card(x, y, w, h, tone) {
      this.rect(x, y, w, h, tone.fill, tone.stroke);
      this.rect(x, y, 2.6, h, tone.accent, null);
    }
    next() {
      if (this.page !== '') {
        this.pages.push(this.page);
        this.page = '';
      }
      const top = T.PAGE_H - T.MARGIN;
      this.rect(T.MARGIN, top - 20, 30, 20, T.PRIMARY, null);
      this.textAt(T.MARGIN + 4.6, top - 13.4, 'SCR', 9, true, T.WHITE);
      this.labelAt(T.MARGIN + 40, top - 13.4, this.kicker, 8, T.PRIMARY);
      this.hline(T.MARGIN, T.PAGE_W - T.MARGIN, top - 30, T.LINE, 0.6);
      this.y = top - 58;
    }
    text(t, size, bold) {
      this.textAt(T.MARGIN, this.y, t, size, bold, T.INK);
      this.y -= size + 5;
    }
    block(t, size, bold) {
      for (const line of wrap(t, size, bold, T.PAGE_W - 2 * T.MARGIN)) {
        if (this.y < T.BOTTOM + 6) this.next();
        this.text(line, size, bold);
      }
    }
    heading(title, strong, rest) {
      this.textAt(T.MARGIN, this.y, title, 22, true, T.INK);
      this.y -= 20;
      this.textAt(T.MARGIN, this.y, strong, 10.5, true, T.INK);
      if (rest !== '') {
        const x = T.MARGIN + width(strong, 10.5, true) + 8;
        this.textAt(x, this.y, rest, 10, false, T.MUTED);
      }
      this.y -= 18;
    }
    drawLegend() {
      if (!this.legend.length) return '';
      const pdf = new Pdf('', '');
      const y = 60;
      pdf.labelAt(T.MARGIN, y + 1, 'Legenda', 7, T.SUBTLE);
      let x = T.MARGIN + width('LEGENDA', 7, true) + 7 * 0.6 + 16;
      for (const [label, tone] of this.legend) {
        pdf.card(x, y - 1, 16, 10, tone);
        pdf.textAt(x + 21, y + 1, label, 8, false, T.MUTED);
        x += 21 + width(label, 8, false) + 18;
      }
      return pdf.page;
    }
    /** Documento completo como Uint8Array (todo o conteúdo é ASCII). */
    bytes() {
      if (this.page !== '') {
        this.pages.push(this.page);
        this.page = '';
      }
      const legend = this.drawLegend();
      const count = this.pages.length;
      const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        `<< /Type /Pages /Count ${count} /Kids [${Array.from({ length: count }, (_, i) => `${5 + i * 2} 0 R`).join(' ')}] >>`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      ];
      this.pages.forEach((page, i) => {
        let content = page + legend;
        const foot = new Pdf('', '');
        foot.hline(T.MARGIN, T.PAGE_W - T.MARGIN, 46, T.LINE, 0.6);
        foot.textAt(T.MARGIN, 32, this.footer, 7.5, false, T.SUBTLE);
        const number = `Página ${i + 1} de ${count}`;
        foot.textAt(T.PAGE_W - T.MARGIN - width(number, 7.5, false), 32, number, 7.5, false, T.SUBTLE);
        content += foot.page;
        objects.push(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${T.PAGE_W} ${T.PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
        );
        objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
      });
      this.pages = [];
      let out = '%PDF-1.4\n';
      const offsets = [0];
      objects.forEach((o, i) => {
        offsets.push(out.length);
        out += `${i + 1} 0 obj\n${o}\nendobj\n`;
      });
      const xref = out.length;
      out += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
      for (const off of offsets.slice(1)) out += `${String(off).padStart(10, '0')} 00000 n \n`;
      out += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
      return bytes;
    }
  }

  W.pdf = { rgb, encoded, literal, width, wrap, Pdf, T };
  if (typeof module !== 'undefined') module.exports = W;
})(typeof globalThis !== 'undefined' ? globalThis : window);
