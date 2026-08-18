import jsPDF from "jspdf";

interface CustomerCred {
  number: string;
  name: string;
  tempPassword: string;
}

interface PdfOptions {
  userName: string;
  userNumber: string;
  customers: CustomerCred[];
}

export function generateCustomerListPdf({ userName, userNumber, customers }: PdfOptions): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const colW = (pageW - margin * 2) / 3;
  const rowH = 8;
  let y = margin;

  const ensureSpace = (h: number) => {
    if (y + h > pageH - margin) {
      doc.addPage();
      y = margin;
      drawTableHeader();
    }
  };

  const drawTableHeader = () => {
    doc.setFillColor(245, 246, 248);
    doc.rect(margin, y, pageW - margin * 2, rowH, "F");
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 110, 120);
    doc.text("NAAM", margin + 3, y + 5.5);
    doc.text("NUMMER", margin + colW + 3, y + 5.5);
    doc.text("WACHTWOORD", margin + colW * 2 + 3, y + 5.5);
    y += rowH;
  };

  // Header
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(20, 25, 35);
  doc.text("Klantaccounts", margin, y + 4);
  y += 10;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 100, 115);
  doc.text(`Gekoppeld aan: ${userName} (nr. ${userNumber})`, margin, y);
  y += 5;
  doc.text(`Aantal klanten: ${customers.length}`, margin, y);
  y += 5;
  const dateStr = new Date().toLocaleString("nl-NL", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  doc.text(`Aangemaakt op: ${dateStr}`, margin, y);
  y += 7;

  // Security notice
  doc.setFillColor(255, 248, 235);
  doc.roundedRect(margin, y, pageW - margin * 2, 12, 1.5, 1.5, "F");
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(180, 90, 20);
  doc.text("BELANGRIJK", margin + 4, y + 5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120, 80, 30);
  doc.text(
    "Deze wachtwoorden zijn eenmalig zichtbaar. Bewaar dit document veilig.",
    margin + 4,
    y + 9,
  );
  y += 16;

  // Table header + rows
  drawTableHeader();
  doc.setFont("helvetica", "normal");

  customers.forEach((c, i) => {
    ensureSpace(rowH);
    if (i % 2 === 1) {
      doc.setFillColor(250, 251, 252);
      doc.rect(margin, y, pageW - margin * 2, rowH, "F");
    }
    doc.setFontSize(9);
    doc.setTextColor(20, 25, 35);
    doc.text(c.name, margin + 3, y + 5.5);
    doc.setTextColor(60, 70, 85);
    doc.text(c.number, margin + colW + 3, y + 5.5);
    doc.setTextColor(60, 70, 85);
    doc.text(c.tempPassword, margin + colW * 2 + 3, y + 5.5);
    y += rowH;
  });

  // Footer on each page
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(160, 165, 175);
    doc.text(
      `Pagina ${p} van ${pageCount}`,
      pageW / 2,
      pageH - 8,
      { align: "center" },
    );
  }

  doc.save(`klantaccounts-${userNumber}.pdf`);
}
