---
name: cost-seg-report
description: >
  Generates IRS MACRS cost segregation study reports from structured property
  and line-item data. Produces professional, print-ready HTML reports with
  executive summary, category breakdowns, detailed schedules, and narrative
  tax-savings analysis.
---

# Cost Segregation Report Generator

## Overview

You generate professional cost segregation study reports. The caller sends
structured JSON data; you produce a self-contained HTML report saved to
`/output/report.html`.

## Input Format

You will receive a JSON object with these keys:

| Key | Type | Description |
|-----|------|-------------|
| `project_name` | string | Name of the cost segregation project |
| `study_date` | string / null | Date of the study (ISO format) |
| `generated_at` | string | Timestamp of report generation |
| `property` | object | Property details (name, address, city, state, zip, type, total_cost, acquisition_date) |
| `line_items` | array | Classified line items (see below) |
| `bonus_rate` | float | Current bonus depreciation rate (e.g. 0.20 for 20%) |
| `categories` | object | IRS MACRS category definitions |

Each `line_item` has:
- `description` — text description of the cost
- `amount` — dollar amount (float)
- `category_id` — MACRS category key (e.g. `personal_property_5yr`)
- `category_label` — human label (e.g. "Personal Property – 5-year")
- `recovery_period` — years (5, 7, 15, 39, or null)
- `bonus_eligible` — boolean
- `year1_deduction` — pre-calculated year-1 deduction
- `confidence` — AI classification confidence (0.0–1.0)
- `ai_notes` — rationale for the classification
- `user_edited` — boolean, whether the user overrode AI classification

## Required Report Sections

Generate the report with these sections **in order**:

### 1. Header
- Report title: "Cost Segregation Study"
- Property name and study date
- Generation timestamp and project name

### 2. Executive Summary
Write a **2-3 paragraph narrative** that:
- Summarizes the total property cost basis analyzed
- Highlights the total year-1 deductions available through cost segregation
- Compares this to what straight-line 39-year depreciation would yield
- Quantifies the **additional first-year tax deductions** gained
- Mentions the current bonus depreciation rate and its impact
- Notes the number of line items classified and any items needing review

### 3. Property Overview
A 3-column card layout showing:
- Property name and address
- Total depreciable basis (sum of all line item amounts)
- Year-1 deductions available (colored green) with comparison to straight-line

### 4. Classification Summary Table
Table with columns: Category | Recovery Period | Bonus Eligible | Amount | % of Total | Year-1 Deduction
- Sort by amount descending
- Include a totals footer row

### 5. Detailed Line Items Table
Table with columns: Description | Category | Amount | Recovery | Year-1 Deduction | Confidence
- Show `[edited]` badge for user-edited items in indigo color
- Color-code confidence indicators:
  - ≥ 80%: green (#22c55e)
  - ≥ 60%: amber (#f59e0b)
  - < 60%: red (#ef4444)
- Include totals footer row

### 6. Disclaimer
Standard tax advisory disclaimer citing:
- Rev. Proc. 87-56
- IRC §168
- §1245/§1250
- CARES Act 2020 QIP correction
- Current bonus depreciation phase-down rate
- Note that report does not constitute legal or tax advice

## Styling Requirements

- **Self-contained**: All CSS inline in `<style>` tags, no external resources
- **Typography**: Georgia/serif for body text; clean, professional appearance
- **Layout**: max-width 960px, centered, 48px/40px padding
- **Tables**: Full-width, collapsed borders, zebra striping, hover effects
- **Numbers**: Right-aligned, tabular-nums, dollar amounts with `$` and commas
- **Print-friendly**: Clean rendering when printed
- **Header**: 3px bottom border in #1a1a1a
- **Section headings**: 13px, uppercase, letter-spaced, with bottom border
- **Cards/boxes**: Light background (#f9f9f8), 1px border (#e5e7eb), 8px radius
- **Footer stamp**: Right-aligned, muted color, showing platform name and date

## Output

Save the complete HTML file to `/output/report.html`.
Do NOT include any other output, explanations, or commentary outside the file.
