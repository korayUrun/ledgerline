import PDFDocument from "pdfkit";
import type { ContractDocument } from "./contract.js";

// A fixed creation date: pdfkit derives the PDF's file ID from it, so with a fixed
// date the same document always produces byte-identical PDF files. That keeps git
// diffs clean and lets a test check that the committed dataset is up to date.
const FIXED_CREATION_DATE = new Date("2026-01-01T00:00:00Z");

// Lays the contract out on Letter pages with the built-in Helvetica font (no font
// files to embed). pdfkit wraps lines and adds pages by itself, so long contracts
// span several pages, which makes the "page" in an evidence quote meaningful.
export function renderPdf(document: ContractDocument): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: "LETTER",
    margin: 72,
    info: {
      Title: document.title,
      Producer: "Ledgerline eval generator",
      Creator: "Ledgerline eval generator",
      CreationDate: FIXED_CREATION_DATE,
    },
  });

  // pdfkit is a stream: collect the chunks and join them when it ends.
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });

  pdf.font("Helvetica-Bold").fontSize(16).text(document.title, { align: "center" });
  pdf.moveDown();
  pdf.font("Helvetica").fontSize(11);
  for (const paragraph of document.intro) {
    pdf.text(paragraph, { align: "justify" }).moveDown(0.6);
  }
  for (const section of document.sections) {
    pdf.moveDown(0.4);
    pdf.font("Helvetica-Bold").fontSize(12).text(`${section.number}. ${section.heading}`);
    pdf.font("Helvetica").fontSize(11).moveDown(0.3);
    for (const paragraph of section.paragraphs) {
      pdf.text(paragraph, { align: "justify" }).moveDown(0.5);
    }
  }
  pdf.moveDown(2);
  for (const line of document.signatures) {
    pdf.text(`${line}    Signature: ____________________`).moveDown(1.2);
  }

  pdf.end();
  return done;
}
