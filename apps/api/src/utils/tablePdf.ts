import PDFDocument from 'pdfkit';
import { drawLogo } from '../services/pdf.service';
import { ExcelColumn } from './excel';

const BRAND = '#1B3F6B';
const INK = '#16232F';

export interface PdfSection {
  name: string;
  columns: ExcelColumn[];
  rows: Record<string, unknown>[];
}

/**
 * PDF tabulaire générique (miroir de buildXlsx) : A4 paysage, bannière E&M OpS
 * (logo + « Ligne de vie »), une table par section avec zébrage, coupures de
 * page propres (l'en-tête de colonnes est redessiné) et numérotation des pages.
 */
export async function buildTablePdf(title: string, sections: PdfSection[], subtitle?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      const W = doc.page.width;
      const left = 36;
      const totalW = W - 72;
      const bottom = doc.page.height - 44;

      // ── Bandeau de marque ──
      doc.rect(0, 0, W, 64).fill(BRAND);
      drawLogo(doc, 34, 12, 40);
      doc.font('Helvetica-Bold').fontSize(15).fillColor('white').text('E&M ', 84, 15, { continued: true });
      doc.fillColor('#3BC9AF').text('OpS');
      doc.font('Helvetica').fontSize(11).fillColor('white').text(title, 84, 36);
      if (subtitle) doc.fontSize(8).fillColor('#cdd9e8').text(subtitle, 84, 51);
      doc.path(`M34 58 H${W - 200} l6 -8 l8 14 l6 -6 H${W - 60}`).lineWidth(1.2).lineJoin('round').lineCap('round').stroke('#FFB020');
      doc.circle(W - 52, 58, 2.4).fill('#3BC9AF');
      doc.fillColor('black');

      let y = 80;

      const headerRow = (cols: ExcelColumn[], colW: number[], yy: number): number => {
        doc.rect(left, yy, totalW, 16).fill(BRAND);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('white');
        let x = left;
        cols.forEach((c, j) => {
          doc.text(c.header, x + 3, yy + 4.5, { width: colW[j] - 6, height: 9, ellipsis: true, lineBreak: false });
          x += colW[j];
        });
        return yy + 19;
      };

      for (const s of sections) {
        if (sections.length > 1) {
          if (y > bottom - 70) { doc.addPage(); y = 44; }
          doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND).text(s.name, left, y);
          y += 17;
        }
        // Largeurs de colonnes : proportionnelles aux indices utilisés pour l'xlsx.
        const wsum = s.columns.reduce((a, c) => a + (c.width ?? 14), 0);
        const colW = s.columns.map((c) => ((c.width ?? 14) / wsum) * totalW);

        y = headerRow(s.columns, colW, y);
        doc.font('Helvetica').fontSize(7.5);

        if (!s.rows.length) {
          doc.fillColor('#8899AA').fontSize(8).text('Aucune donnée.', left, y);
          y += 16;
        }
        s.rows.forEach((r, i) => {
          if (y > bottom - 13) {
            doc.addPage();
            y = 44;
            y = headerRow(s.columns, colW, y);
            doc.font('Helvetica').fontSize(7.5);
          }
          if (i % 2 === 1) doc.rect(left, y - 2.5, totalW, 13).fill('#F2F6FA');
          doc.fillColor(INK);
          let x = left;
          s.columns.forEach((c, j) => {
            const v = r[c.key];
            doc.text(v == null ? '' : String(v), x + 3, y, { width: colW[j] - 6, height: 10, ellipsis: true, lineBreak: false });
            x += colW[j];
          });
          y += 13;
        });
        y += 16;
      }

      // ── Pied de page (toutes pages) ──
      const range = doc.bufferedPageRange();
      const genere = new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.font('Helvetica').fontSize(7).fillColor('#999').text(
          `Généré le ${genere} — E&M OpS · page ${i + 1}/${range.count}`,
          36, doc.page.height - 28, { width: doc.page.width - 72, align: 'center', lineBreak: false }
        );
      }
      doc.end();
    } catch (err) { reject(err); }
  });
}
