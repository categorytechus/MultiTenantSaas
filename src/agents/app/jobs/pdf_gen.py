import io
from typing import Any
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._saved_page_states: list[dict[str, Any]] = []

    def showPage(self) -> None:
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            # Only draw headers/footers on pages after the cover page
            if self._pageNumber > 1:
                self.saveState()
                # Running Header
                self.setFont("Helvetica-Bold", 8)
                self.setFillColor(colors.HexColor("#2C3E50"))
                self.drawString(54, 745, "Detailed Line Item Classifications")
                self.setStrokeColor(colors.HexColor("#BDC3C7"))
                self.setLineWidth(0.5)
                self.line(54, 737, 558, 737)

                # Running Footer
                self.setFont("Helvetica", 8)
                self.setFillColor(colors.HexColor("#7F8C8D"))
                self.drawString(54, 40, "Cost Segregation Study Report")
                self.drawRightString(558, 40, f"Page {self._pageNumber} of {num_pages}")
                self.restoreState()
            super().showPage()
        super().save()

class PDFGenerator:
    def generate_report(
        self,
        project_name: str,
        study_date: str,
        property_details: dict[str, Any],
        line_items: list[dict[str, Any]],
        summary: dict[str, Any],
    ) -> bytes:
        pdf_buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            pdf_buffer,
            pagesize=letter,
            leftMargin=54,
            rightMargin=54,
            topMargin=72,
            bottomMargin=72
        )

        styles = getSampleStyleSheet()

        # Define custom premium styles
        body_style = ParagraphStyle(
            'CustomBody',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=10,
            leading=14,
            textColor=colors.HexColor("#333333")
        )

        bold_body_style = ParagraphStyle(
            'CustomBoldBody',
            parent=body_style,
            fontName='Helvetica-Bold'
        )

        section_heading = ParagraphStyle(
            'CustomSectionHeading',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=14,
            leading=18,
            textColor=colors.HexColor("#1A237E"),
            spaceBefore=15,
            spaceAfter=10
        )

        # 1. Page 1 Content: Cover & Executive Summary
        story = []

        # Dark header banner
        header_data = [
            [Paragraph("COST SEGREGATION STUDY REPORT", ParagraphStyle('H1', fontName='Helvetica-Bold', fontSize=20, leading=24, textColor=colors.white))],
            [Paragraph(f"Project: {project_name}", ParagraphStyle('H2', fontName='Helvetica', fontSize=12, leading=16, textColor=colors.white))],
            [Paragraph(f"Prepared on: {study_date}", ParagraphStyle('H3', fontName='Helvetica', fontSize=10, leading=14, textColor=colors.HexColor("#E0E0E0")))]
        ]
        header_table = Table(header_data, colWidths=[504])
        header_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#0D47A1")),  # Dark Premium Blue
            ('TOPPADDING', (0, 0), (-1, -1), 20),
            ('BOTTOMPADDING', (0, -1), (-1, -1), 20),
            ('LEFTPADDING', (0, 0), (-1, -1), 24),
            ('RIGHTPADDING', (0, 0), (-1, -1), 24),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        story.append(header_table)
        story.append(Spacer(1, 20))

        # Property details block
        addr = property_details.get("address") or "N/A"
        city = property_details.get("city") or ""
        state = property_details.get("state") or ""
        zip_code = property_details.get("zip_code") or ""
        full_addr = f"{addr}, {city} {state} {zip_code}".strip(", ") or "N/A"
        prop_type = property_details.get("property_type") or "commercial"
        basis = property_details.get("total_cost") or 0.0

        prop_data = [
            [Paragraph("<b>Property details</b>", ParagraphStyle('PH', fontName='Helvetica-Bold', fontSize=12, leading=14, textColor=colors.HexColor("#0D47A1"))), ""],
            [Paragraph("Address:", bold_body_style), Paragraph(full_addr, body_style)],
            [Paragraph("Property Type:", bold_body_style), Paragraph(prop_type.upper(), body_style)],
            [Paragraph("Placed-in-Service:", bold_body_style), Paragraph(property_details.get('acquisition_date') or 'N/A', body_style)],
            [Paragraph("Total Cost Basis:", bold_body_style), Paragraph(f"<b>${basis:,.2f}</b>", body_style)],
        ]
        prop_table = Table(prop_data, colWidths=[120, 384])
        prop_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#F8F9FA")),
            ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#E9ECEF")),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LEFTPADDING', (0, 0), (-1, -1), 15),
            ('RIGHTPADDING', (0, 0), (-1, -1), 15),
            ('SPAN', (0, 0), (1, 0)),
            ('BOTTOMPADDING', (0, 0), (1, 0), 10),
            ('TOPPADDING', (0, 0), (1, 0), 12),
        ]))
        story.append(prop_table)
        story.append(Spacer(1, 20))

        # Summary figures & accelerated savings
        story.append(Paragraph("Executive Summary & Tax Savings", section_heading))
        
        total_seg = summary.get("total_cost") or 0.0
        total_y1 = summary.get("total_year1") or 0.0
        tax_savings = max(0.0, total_y1 - (total_seg * 0.02564))

        card_data = [
            [
                Paragraph("Total Depreciable Basis", ParagraphStyle('C1', parent=body_style, fontSize=8, leading=10, textColor=colors.HexColor("#155724"), alignment=1)),
                "",
                Paragraph("Year-1 Deductions", ParagraphStyle('C2', parent=body_style, fontSize=8, leading=10, textColor=colors.HexColor("#155724"), alignment=1)),
                "",
                Paragraph("Accelerated Year-1 Savings", ParagraphStyle('C3', parent=body_style, fontSize=8, leading=10, textColor=colors.HexColor("#721C24"), alignment=1))
            ],
            [
                Paragraph(f"<b>${total_seg:,.2f}</b>", ParagraphStyle('V1', parent=body_style, fontSize=12, leading=14, textColor=colors.HexColor("#155724"), alignment=1)),
                "",
                Paragraph(f"<b>${total_y1:,.2f}</b>", ParagraphStyle('V2', parent=body_style, fontSize=12, leading=14, textColor=colors.HexColor("#155724"), alignment=1)),
                "",
                Paragraph(f"<b>${tax_savings:,.2f}</b>", ParagraphStyle('V3', parent=body_style, fontSize=12, leading=14, textColor=colors.HexColor("#721C24"), alignment=1))
            ]
        ]
        card_table = Table(card_data, colWidths=[154, 21, 154, 21, 154])
        card_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, 1), colors.HexColor("#D4EDDA")),
            ('BOX', (0, 0), (0, 1), 1, colors.HexColor("#C3E6CB")),
            ('BACKGROUND', (2, 0), (2, 1), colors.HexColor("#D4EDDA")),
            ('BOX', (2, 0), (2, 1), 1, colors.HexColor("#C3E6CB")),
            ('BACKGROUND', (4, 0), (4, 1), colors.HexColor("#F8D7DA")),
            ('BOX', (4, 0), (4, 1), 1, colors.HexColor("#F5C6CB")),
            ('TOPPADDING', (0, 0), (-1, -1), 12),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(card_table)
        story.append(Spacer(1, 30))

        # Footer notes
        footer_style = ParagraphStyle('CoverFooter', fontName='Helvetica', fontSize=8, leading=10, textColor=colors.HexColor("#7F8C8D"))
        story.append(Paragraph("Note: Year-1 deductions calculate a 20% bonus depreciation phase-down for tax year 2026.", footer_style))
        story.append(Spacer(1, 4))
        story.append(Paragraph("This report is generated dynamically by the Cost Segregation Agent.", footer_style))
        story.append(Spacer(1, 4))
        story.append(Paragraph("Page 1", ParagraphStyle('Page1Num', parent=footer_style, alignment=2)))

        # Break to next page for table schedules
        story.append(PageBreak())

        # 2. Page 2 Content: Detailed Schedules Table
        table_data = [
            [
                Paragraph("<b>Description</b>", ParagraphStyle('TH1', fontName='Helvetica-Bold', fontSize=9, leading=11, textColor=colors.HexColor("#212529"))),
                Paragraph("<b>MACRS Category</b>", ParagraphStyle('TH2', fontName='Helvetica-Bold', fontSize=9, leading=11, textColor=colors.HexColor("#212529"))),
                Paragraph("<b>Cost Basis</b>", ParagraphStyle('TH3', fontName='Helvetica-Bold', fontSize=9, leading=11, textColor=colors.HexColor("#212529"))),
                Paragraph("<b>Class Life</b>", ParagraphStyle('TH4', fontName='Helvetica-Bold', fontSize=9, leading=11, textColor=colors.HexColor("#212529"))),
                Paragraph("<b>Year-1 Ded.</b>", ParagraphStyle('TH5', fontName='Helvetica-Bold', fontSize=9, leading=11, textColor=colors.HexColor("#212529"))),
            ]
        ]

        for item in line_items:
            desc = item.get("description") or "Line Item"
            cat_label = item.get("category_label") or item.get("category_id") or "needs_review"
            cost = item.get("cost") or 0.0
            rp = item.get("recovery_period")
            rp_str = f"{rp} yr" if rp else "N/A"
            y1 = item.get("year1_deduction")
            y1_str = f"${y1:,.2f}" if y1 is not None else "—"

            table_data.append([
                Paragraph(desc, ParagraphStyle('TD1', fontName='Helvetica', fontSize=8, leading=10, textColor=colors.HexColor("#333333"))),
                Paragraph(cat_label, ParagraphStyle('TD2', fontName='Helvetica', fontSize=8, leading=10, textColor=colors.HexColor("#495057"))),
                Paragraph(f"${cost:,.2f}", ParagraphStyle('TD3', fontName='Helvetica', fontSize=8, leading=10, textColor=colors.HexColor("#333333"))),
                Paragraph(rp_str, ParagraphStyle('TD4', fontName='Helvetica', fontSize=8, leading=10, textColor=colors.HexColor("#495057"))),
                Paragraph(f"<b>{y1_str}</b>", ParagraphStyle('TD5', fontName='Helvetica-Bold', fontSize=8, leading=10, textColor=colors.HexColor("#155724"))),
            ])

        t_style = [
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#E9ECEF")),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('GRID', (0, 0), (-1, 0), 0.5, colors.HexColor("#CED4DA")),
            ('LINEBELOW', (0, -1), (-1, -1), 0.5, colors.HexColor("#DEE2E6")),
        ]

        # Alternate row backgrounds
        for idx in range(1, len(table_data)):
            if idx % 2 == 1:
                t_style.append(('BACKGROUND', (0, idx), (-1, idx), colors.HexColor("#F8F9FA")))
            else:
                t_style.append(('BACKGROUND', (0, idx), (-1, idx), colors.white))

        sched_table = Table(table_data, colWidths=[180, 140, 70, 50, 64])
        sched_table.setStyle(TableStyle(t_style))
        
        story.append(sched_table)

        # Build document using the NumberedCanvas
        doc.build(story, canvasmaker=NumberedCanvas)
        
        return pdf_buffer.getvalue()
