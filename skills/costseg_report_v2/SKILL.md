---
name: costseg_report_v2
description: >
  Generates IRS MACRS cost segregation study reports from structured property
  and line-item data. Produces professional reports in HTML code with
  executive summary, category breakdowns, detailed schedules, and narrative
  tax-savings analysis.
---

# Cost Segregation Report Generator

## Overview

You generate professional cost segregation study reports. The caller sends
structured JSON data; you produce a self-contained HTML report.

## CRITICAL: Output Method

You MUST use the code execution tool to write the final HTML file to disk.
Do NOT output HTML inline in your chat response.

Always write the report using the `$OUTPUT_DIR` environment variable:

```python
import os
output_dir = os.environ.get("OUTPUT_DIR", "/output")
os.makedirs(output_dir, exist_ok=True)
with open(os.path.join(output_dir, "report.html"), "w") as f:
    f.write(html_content)
```

You MUST write to `$OUTPUT_DIR`, not `/output/`. Only files in `$OUTPUT_DIR` are
returned via the Files API.

Do NOT include any explanations or commentary outside the file.

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
| `summary` | object | Pre-computed totals: `total_cost`, `total_year1` |

Each `line_item` has:
- `description` — text description of the cost
- `cost` — dollar amount (float)
- `category_id` — MACRS category key (see table below)
- `category_label` — human label (e.g. "Personal Property – 5-year")
- `recovery_period` — years (5, 7, 15, 39, or null)
- `bonus_eligible` — boolean
- `year1_deduction` — pre-calculated year-1 deduction
- `confidence` — AI classification confidence (0.0–1.0), if available
- `ai_notes` — rationale for the classification, if available
- `user_edited` — boolean, whether the user overrode AI classification

### IRS MACRS Categories Reference

| `category_id` | Label | Recovery Period | Depreciable | Bonus Eligible |
|---|---|---|---|---|
| `land` | Land | N/A | No | No |
| `personal_property_5yr` | Personal Property – 5-year | 5 yr | Yes | Yes |
| `personal_property_7yr` | Personal Property – 7-year | 7 yr | Yes | Yes |
| `land_improvements_15yr` | Land Improvements – 15-year | 15 yr | Yes | Yes |
| `qualified_improvement_property_15yr` | Qualified Improvement Property (QIP) – 15-year | 15 yr | Yes | Yes |
| `building_39yr` | Building – Section 1250 (39-year) | 39 yr | Yes | No |
| `needs_review` | Needs Review | N/A | N/A | No |
| `excluded` | Excluded – Not Depreciable | N/A | No | No |

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

### 6. Multi-Year Depreciation Schedule

Compute and display the full MACRS GDS depreciation schedule for each depreciable line item.

**MACRS GDS half-year convention rates to use:**

| Recovery Period | Year 1 | Year 2 | Year 3 | Year 4 | Year 5 | Year 6 | Year 7 | Year 8+ |
|---|---|---|---|---|---|---|---|---|
| 5-year | 20.00% | 32.00% | 19.20% | 11.52% | 11.52% | 5.76% | — | — |
| 7-year | 14.29% | 24.49% | 17.49% | 12.49% | 8.93% | 8.92% | 8.93% | 4.46% |
| 15-year | 5.00% | 9.50% | 8.55% | 7.70% | 6.93% | 6.23% | 5.90% | varies |
| 39-year | 2.564% each year (1/39) | | | | | | | |

**Calculation logic per item:**
- `bonus_amount = cost × bonus_rate` if `bonus_eligible` is true, else 0
- `depreciable_basis = cost − bonus_amount`
- `year_N_deduction = depreciable_basis × GDS_rate_N` (plus `bonus_amount` in Year 1)

**Display format:** A rolled-up table by **category** (not per-item) showing total deductions by year, columns: Year | 5-yr Prop | 7-yr Prop | 15-yr Prop | 39-yr Building | Total. Show years 1–10 and a "Remaining" row. Bold the Year 1 row.

Exclude `land`, `excluded`, and `needs_review` categories.

### 7. Disclaimer
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

Save the complete HTML file to `$OUTPUT_DIR/report.html` (using the `OUTPUT_DIR` environment variable).
Do NOT include any other output, explanations, or commentary outside the file.
