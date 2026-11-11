//! Escritor de PDF 1.4 mínimo (fontes Type 1 padrão, Windows-1252) e a
//! linguagem visual compartilhada pelos relatórios do SCR.
//!
//! As cores repetem os tokens de `ui/app.css` (tema claro), para que o papel e
//! a tela tenham a mesma identidade: primária teal, superfícies planas com
//! bordas de 1px, texto verde-escuro e as mesmas cores de aula.

/// Converte `#rrggbb` no operando RGB do PDF (`r g b`, 0–1).
pub fn rgb(hex: &str) -> String {
    let h = hex.trim_start_matches('#');
    let c = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).unwrap_or(0) as f64 / 255.0;
    let f = |v: f64| {
        let s = format!("{v:.3}");
        let s = s.trim_end_matches('0').trim_end_matches('.');
        if s.is_empty() {
            "0".to_string()
        } else {
            s.to_string()
        }
    };
    format!("{} {} {}", f(c(0)), f(c(2)), f(c(4)))
}

// Tokens de ui/app.css.
pub const INK: &str = "#0f2b28"; // --text
pub const MUTED: &str = "#4b5f5c"; // --text-muted
pub const SUBTLE: &str = "#6b7f7c"; // --text-subtle
pub const LINE: &str = "#d6e2df"; // --border
pub const LINE_STRONG: &str = "#b7cbc7"; // --border-strong
pub const SURFACE_2: &str = "#eef4f3"; // --surface-2
pub const BG: &str = "#f3f7f6"; // --bg
pub const PRIMARY: &str = "#0f766e"; // --primary
pub const WHITE: &str = "#ffffff";

/// Preenchimento, contorno e faixa lateral de um cartão (como `.preview-lesson`).
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Tone {
    pub fill: &'static str,
    pub stroke: &'static str,
    pub accent: &'static str,
}

pub const PAGE_W: f64 = 842.0;
pub const PAGE_H: f64 = 595.0;
pub const MARGIN: f64 = 36.0;
/// Limite inferior do conteúdo (acima da legenda e do rodapé).
pub const BOTTOM: f64 = 84.0;

// PDF 1.4 com fontes Type 1 padrão e Windows-1252 para o português.
pub fn encoded(text: &str) -> Vec<u8> {
    text.chars()
        .map(|c| match c {
            '\u{2013}' | '\u{2014}' => b'-',
            '\u{2018}' | '\u{2019}' => b'\'',
            '\u{201c}' | '\u{201d}' => b'"',
            '\u{2022}' => 0x95,
            c if (c as u32) <= 255 => c as u8,
            _ => b'?',
        })
        .collect()
}
pub fn literal(text: &str) -> String {
    encoded(text).iter().map(|c| format!("{c:02X}")).collect()
}

/// Largura aproximada (métricas AFM da Helvetica) em pontos.
pub fn width(text: &str, size: f64, bold: bool) -> f64 {
    const ASCII: [u16; 95] = [
        278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556,
        556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722,
        722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
        667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
        556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
        500, 334, 260, 334, 584,
    ];
    let base = |c: char| -> char {
        match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'Á' | 'À' | 'Â' | 'Ã' | 'Ä' => 'A',
            'é' | 'ê' | 'è' => 'e',
            'É' | 'Ê' | 'È' => 'E',
            'í' | 'ì' | 'î' => 'i',
            'Í' | 'Ì' | 'Î' => 'I',
            'ó' | 'ô' | 'õ' | 'ò' | 'ö' => 'o',
            'Ó' | 'Ô' | 'Õ' | 'Ò' | 'Ö' => 'O',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'Ú' | 'Ù' | 'Û' | 'Ü' => 'U',
            'ç' => 'c',
            'Ç' => 'C',
            'ñ' => 'n',
            'Ñ' => 'N',
            c => c,
        }
    };
    let units: f64 = text
        .chars()
        .map(|c| {
            let c = base(c);
            match c as u32 {
                32..=126 => ASCII[(c as u32 - 32) as usize] as f64,
                0xAA | 0xBA => 370.0,
                _ => 556.0,
            }
        })
        .sum();
    units * size / 1000.0 * if bold { 1.06 } else { 1.0 }
}

/// Quebra o texto em linhas que cabem em `max` pontos.
pub fn wrap(text: &str, size: f64, bold: bool, max: f64) -> Vec<String> {
    let mut out = Vec::new();
    for paragraph in text.lines() {
        let mut line = String::new();
        for word in paragraph.split_whitespace() {
            // Palavras maiores que a linha são cortadas por caractere.
            let mut pieces = Vec::new();
            let mut piece = String::new();
            for ch in word.chars() {
                piece.push(ch);
                if width(&piece, size, bold) > max && piece.chars().count() > 1 {
                    piece.pop();
                    pieces.push(std::mem::take(&mut piece));
                    piece.push(ch);
                }
            }
            pieces.push(piece);
            for piece in pieces {
                let candidate = if line.is_empty() {
                    piece.clone()
                } else {
                    format!("{line} {piece}")
                };
                if !line.is_empty() && width(&candidate, size, bold) > max {
                    out.push(std::mem::replace(&mut line, piece));
                } else {
                    line = candidate;
                }
            }
        }
        out.push(line);
    }
    out
}

pub struct Pdf {
    pages: Vec<String>,
    pub page: String,
    pub y: f64,
    /// Rótulo em caixa alta ao lado da marca, no topo de cada página.
    pub kicker: String,
    /// Texto à esquerda do rodapé.
    pub footer: String,
    /// Legenda desenhada no pé de cada página.
    pub legend: Vec<(&'static str, Tone)>,
}
impl Pdf {
    pub fn new(kicker: &str, footer: &str) -> Self {
        Self {
            pages: Vec::new(),
            page: String::new(),
            y: 0.0,
            kicker: kicker.into(),
            footer: footer.into(),
            legend: Vec::new(),
        }
    }
    // ---- Primitivas ----
    pub fn rect(&mut self, x: f64, y: f64, w: f64, h: f64, fill: &str, stroke: Option<&str>) {
        match stroke {
            Some(stroke) => self.page.push_str(&format!(
                "q {} rg {} RG 0.6 w {x:.2} {y:.2} {w:.2} {h:.2} re B Q\n",
                rgb(fill),
                rgb(stroke)
            )),
            None => self.page.push_str(&format!(
                "q {} rg {x:.2} {y:.2} {w:.2} {h:.2} re f Q\n",
                rgb(fill)
            )),
        }
    }
    pub fn hline(&mut self, x1: f64, x2: f64, y: f64, color: &str, w: f64) {
        self.page.push_str(&format!(
            "q {} RG {w} w {x1:.2} {y:.2} m {x2:.2} {y:.2} l S Q\n",
            rgb(color)
        ));
    }
    pub fn text_at(&mut self, x: f64, y: f64, t: &str, size: f64, bold: bool, color: &str) {
        self.page.push_str(&format!(
            "BT /{} {size} Tf {} rg 1 0 0 1 {x:.2} {y:.2} Tm <{}> Tj ET\n",
            if bold { "F2" } else { "F1" },
            rgb(color),
            literal(t)
        ));
    }
    /// Texto em caixa alta com espaçamento entre letras (rótulos de seção).
    pub fn label_at(&mut self, x: f64, y: f64, t: &str, size: f64, color: &str) {
        self.page.push_str(&format!(
            "BT /F2 {size} Tf 0.6 Tc {} rg 1 0 0 1 {x:.2} {y:.2} Tm <{}> Tj 0 Tc ET\n",
            rgb(color),
            literal(&t.to_uppercase())
        ));
    }
    /// Cartão no estilo das aulas da interface: fundo suave, borda e faixa à esquerda.
    pub fn card(&mut self, x: f64, y: f64, w: f64, h: f64, tone: Tone) {
        self.rect(x, y, w, h, tone.fill, Some(tone.stroke));
        self.rect(x, y, 2.6, h, tone.accent, None);
    }
    // ---- Fluxo ----
    /// Abre uma página nova com o cabeçalho da marca.
    pub fn next(&mut self) {
        if !self.page.is_empty() {
            self.pages.push(std::mem::take(&mut self.page));
        }
        let top = PAGE_H - MARGIN;
        // Marca: quadrado teal com "SCR", como o logotipo da barra lateral.
        self.rect(MARGIN, top - 20.0, 30.0, 20.0, PRIMARY, None);
        self.text_at(MARGIN + 4.6, top - 13.4, "SCR", 9.0, true, WHITE);
        let kicker = self.kicker.clone();
        self.label_at(MARGIN + 40.0, top - 13.4, &kicker, 8.0, PRIMARY);
        self.hline(MARGIN, PAGE_W - MARGIN, top - 30.0, LINE, 0.6);
        self.y = top - 58.0;
    }
    pub fn text(&mut self, t: &str, size: f64, bold: bool) {
        self.text_at(MARGIN, self.y, t, size, bold, INK);
        self.y -= size + 5.0;
    }
    pub fn block(&mut self, t: &str, size: f64, bold: bool) {
        for line in wrap(t, size, bold, PAGE_W - 2.0 * MARGIN) {
            if self.y < BOTTOM + 6.0 {
                self.next();
            }
            self.text(&line, size, bold);
        }
    }
    /// Título da página e linha de apoio (destaque em negrito + complemento discreto).
    pub fn heading(&mut self, title: &str, strong: &str, rest: &str) {
        self.text_at(MARGIN, self.y, title, 22.0, true, INK);
        self.y -= 20.0;
        self.text_at(MARGIN, self.y, strong, 10.5, true, INK);
        if !rest.is_empty() {
            let x = MARGIN + width(strong, 10.5, true) + 8.0;
            self.text_at(x, self.y, rest, 10.0, false, MUTED);
        }
        self.y -= 18.0;
    }
    fn draw_legend(&self) -> String {
        if self.legend.is_empty() {
            return String::new();
        }
        let mut pdf = Pdf::new("", "");
        let y = 60.0;
        pdf.label_at(MARGIN, y + 1.0, "Legenda", 7.0, SUBTLE);
        let mut x = MARGIN + width("LEGENDA", 7.0, true) + 7.0 * 0.6 + 16.0;
        for (label, tone) in &self.legend {
            pdf.card(x, y - 1.0, 16.0, 10.0, *tone);
            pdf.text_at(x + 21.0, y + 1.0, label, 8.0, false, MUTED);
            x += 21.0 + width(label, 8.0, false) + 18.0;
        }
        pdf.page
    }
    pub fn bytes(mut self) -> Vec<u8> {
        if !self.page.is_empty() {
            self.pages.push(std::mem::take(&mut self.page));
        }
        let legend = self.draw_legend();
        let count = self.pages.len();
        let mut objects = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            format!(
                "<< /Type /Pages /Count {count} /Kids [{}] >>",
                (0..count)
                    .map(|i| format!("{} 0 R", 5 + i * 2))
                    .collect::<Vec<_>>()
                    .join(" ")
            ),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
                .into(),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
                .into(),
        ];
        let pages = std::mem::take(&mut self.pages);
        for (i, mut content) in pages.into_iter().enumerate() {
            content.push_str(&legend);
            let mut foot = Pdf::new("", "");
            foot.hline(MARGIN, PAGE_W - MARGIN, 46.0, LINE, 0.6);
            foot.text_at(MARGIN, 32.0, &self.footer, 7.5, false, SUBTLE);
            let number = format!("Página {} de {}", i + 1, count);
            let x = PAGE_W - MARGIN - width(&number, 7.5, false);
            foot.text_at(x, 32.0, &number, 7.5, false, SUBTLE);
            content.push_str(&foot.page);
            objects.push(format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {} 0 R >>",
                6 + i * 2
            ));
            objects.push(format!(
                "<< /Length {} >>\nstream\n{}endstream",
                content.len(),
                content
            ));
        }
        let mut bytes = b"%PDF-1.4\n".to_vec();
        let mut offsets = vec![0];
        for (i, o) in objects.iter().enumerate() {
            offsets.push(bytes.len());
            bytes.extend(format!("{} 0 obj\n{}\nendobj\n", i + 1, o).as_bytes());
        }
        let xref = bytes.len();
        bytes.extend(format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len()).as_bytes());
        for off in offsets.iter().skip(1) {
            bytes.extend(format!("{off:010} 00000 n \n").as_bytes());
        }
        bytes.extend(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
                offsets.len()
            )
            .as_bytes(),
        );
        bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rgb_matches_css_tokens() {
        assert_eq!(rgb("#ffffff"), "1 1 1");
        assert_eq!(rgb(PRIMARY), "0.059 0.463 0.431");
    }
    #[test]
    fn wrap_respects_width_and_keeps_words() {
        let text = "Algoritmos e Programação Estruturada Avançada";
        let lines = wrap(text, 8.0, true, 90.0);
        assert!(lines.len() > 1);
        assert!(lines.iter().all(|l| width(l, 8.0, true) <= 90.0));
        assert_eq!(lines.join(" "), text);
    }
}
