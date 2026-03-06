#!/usr/bin/env python3
"""Generate a sample BNY Mellon CLO compliance report PDF for testing extraction.

All summary statistics are derived from the actual holdings data to ensure
internal consistency for testing the extraction pipeline.
"""

from fpdf import FPDF

# ═══════════════════════════════════════════════════════════════════════════
# Shared deal data (must match generate_ppm.py)
# ═══════════════════════════════════════════════════════════════════════════

DEAL_NAME = "Elmwood CLO 2024-1, Ltd."
COLLATERAL_MANAGER = "Elmwood Asset Management LLC"
TRUSTEE = "The Bank of New York Mellon"

TRANCHES = [
    {"class": "A-1", "original": 148_000_000, "spread_bps": 145, "rating": "AAA/AAA", "deferrable": False},
    {"class": "A-2", "original": 20_000_000,  "spread_bps": 175, "rating": "AAA/AAA", "deferrable": False},
    {"class": "B",   "original": 24_000_000,  "spread_bps": 210, "rating": "AA/AA",   "deferrable": False},
    {"class": "C",   "original": 16_500_000,  "spread_bps": 275, "rating": "A/A",     "deferrable": True},
    {"class": "D",   "original": 14_000_000,  "spread_bps": 400, "rating": "BBB-/BBB-", "deferrable": True},
    {"class": "E",   "original": 10_000_000,  "spread_bps": 650, "rating": "BB-/BB-", "deferrable": True},
    {"class": "Sub", "original": 10_000_000,  "spread_bps": None, "rating": "NR",     "deferrable": None},
]

BASE_RATE = 5.37  # 3m SOFR as of report date

# Holdings — par amounts chosen to sum exactly to $242,500,000
HOLDINGS = [
    {"obligor": "Acme Industrial Corp",     "facility": "Term Loan B",   "isin": "US00123ABC45", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Capital Goods",           "moodys_ind": "Aerospace & Defense",    "cov_lite": True,  "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "06/15/2030", "par": 14_000_000, "price": 99.25, "spread_bps": 350, "moodys": "B1",  "sp": "B+",  "recovery": 50.0},
    {"obligor": "Beta Healthcare Inc",      "facility": "First Lien TL", "isin": "US00234BCD56", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Healthcare",              "moodys_ind": "Healthcare & Pharma",    "cov_lite": True,  "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "03/20/2031", "par": 16_500_000, "price": 98.50, "spread_bps": 375, "moodys": "B2",  "sp": "B",   "recovery": 45.0},
    {"obligor": "Cascade Tech Solutions",   "facility": "Term Loan",     "isin": "US00345CDE67", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Technology",              "moodys_ind": "High Tech Industries",   "cov_lite": False, "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "09/30/2029", "par": 10_000_000, "price": 100.00, "spread_bps": 325, "moodys": "Ba3", "sp": "BB-", "recovery": 55.0},
    {"obligor": "Delta Media Group",        "facility": "First Lien",    "isin": "US00456DEF78", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Media",                   "moodys_ind": "Broadcasting & Subscr",  "cov_lite": True,  "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "12/15/2030", "par": 11_250_000, "price": 96.75, "spread_bps": 425, "moodys": "B3",  "sp": "B-",  "recovery": 40.0},
    {"obligor": "Eagle Financial Services", "facility": "Term Loan B",   "isin": "US00567EFG89", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Banking",                 "moodys_ind": "Banking, Finance",       "cov_lite": True,  "fixed": True,  "defaulted": False, "second_lien": False,
     "maturity": "07/31/2028", "par": 8_500_000,  "price": 101.50, "spread_bps": None, "moodys": "Ba2", "sp": "BB",  "recovery": 60.0},
    {"obligor": "Frontier Logistics LLC",   "facility": "First Lien TL", "isin": "US00678FGH90", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Transportation",          "moodys_ind": "Cargo Transport",        "cov_lite": False, "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "11/30/2030", "par": 12_750_000, "price": 97.50, "spread_bps": 400, "moodys": "B2",  "sp": "B",   "recovery": 47.0},
    {"obligor": "Global Packaging Corp",    "facility": "Term Loan",     "isin": "US00789GHI01", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Containers & Pack",       "moodys_ind": "Containers, Packaging",  "cov_lite": True,  "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "05/15/2031", "par": 10_500_000, "price": 99.00, "spread_bps": 350, "moodys": "B1",  "sp": "B+",  "recovery": 52.0},
    {"obligor": "Harmony Hotels Inc",       "facility": "First Lien",    "isin": "US00890HIJ12", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Hotels & Leisure",        "moodys_ind": "Hotel, Gaming",          "cov_lite": False, "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "08/20/2029", "par": 15_250_000, "price": 95.25, "spread_bps": 475, "moodys": "B3",  "sp": "B-",  "recovery": 38.0},
    {"obligor": "Ironclad Manufacturing",   "facility": "Term Loan B",   "isin": "US00901IJK23", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Capital Goods",           "moodys_ind": "Machinery",              "cov_lite": True,  "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "02/28/2030", "par": 11_000_000, "price": 98.75, "spread_bps": 375, "moodys": "B1",  "sp": "B+",  "recovery": 48.0},
    {"obligor": "Jupiter Software Ltd",     "facility": "First Lien TL", "isin": "US01012JKL34", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Technology",              "moodys_ind": "High Tech Industries",   "cov_lite": True,  "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "10/31/2031", "par": 18_000_000, "price": 100.25, "spread_bps": 300, "moodys": "Ba3", "sp": "BB-", "recovery": 55.0},
    {"obligor": "Keystone Energy Partners", "facility": "Term Loan",     "isin": "US01123KLM45", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Energy",                  "moodys_ind": "Oil & Gas",              "cov_lite": False, "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "04/15/2029", "par": 12_000_000, "price": 97.00, "spread_bps": 450, "moodys": "B2",  "sp": "B",   "recovery": 42.0},
    {"obligor": "Lakewood Consumer Brands", "facility": "First Lien",    "isin": "US01234LMN56", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Consumer Products",       "moodys_ind": "Beverage, Food",         "cov_lite": True,  "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "01/31/2031", "par": 9_500_000,  "price": 99.50, "spread_bps": 325, "moodys": "B1",  "sp": "B+",  "recovery": 50.0},
    {"obligor": "Meridian Chemicals AG",    "facility": "Euro TL B",     "isin": "XS0123456789", "type": "Senior Secured", "currency": "EUR", "country": "DE",
     "industry": "Chemicals",               "moodys_ind": "Chemicals, Plastics",    "cov_lite": True,  "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "06/30/2030", "par": 13_500_000, "price": 98.25, "spread_bps": 400, "moodys": "B1",  "sp": "B+",  "recovery": 49.0},
    {"obligor": "Nova Telecom Inc",         "facility": "Term Loan B",   "isin": "US01456NOP78", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Telecommunications",      "moodys_ind": "Telecommunications",     "cov_lite": False, "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "09/15/2030", "par": 16_000_000, "price": 96.00, "spread_bps": 500, "moodys": "B3",  "sp": "B-",  "recovery": 35.0},
    {"obligor": "Oakmont Pharma Group",     "facility": "First Lien TL", "isin": "US01567OPQ89", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Healthcare",              "moodys_ind": "Healthcare & Pharma",    "cov_lite": True,  "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "12/31/2030", "par": 10_750_000, "price": 100.50, "spread_bps": 275, "moodys": "Ba3", "sp": "BB-", "recovery": 57.0},
    {"obligor": "Pinnacle Retail Holdings", "facility": "Term Loan",     "isin": "US01678PQR90", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Retail",                  "moodys_ind": "Retail Stores",          "cov_lite": True,  "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "03/31/2030", "par": 12_500_000, "price": 94.50, "spread_bps": 525, "moodys": "Caa1", "sp": "CCC+", "recovery": 30.0},
    {"obligor": "Quantum Data Systems",     "facility": "Second Lien TL","isin": "US01789QRS01", "type": "Second Lien",   "currency": "USD", "country": "US",
     "industry": "Technology",              "moodys_ind": "High Tech Industries",   "cov_lite": False, "fixed": False, "defaulted": False, "second_lien": True,
     "maturity": "11/30/2031", "par": 8_500_000,  "price": 93.00, "spread_bps": 700, "moodys": "Caa1", "sp": "CCC+", "recovery": 25.0},
    {"obligor": "Redwood Building Materials","facility": "First Lien",   "isin": "US01890RST12", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Building Products",       "moodys_ind": "Building & Developmnt",  "cov_lite": False, "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "07/15/2029", "par": 7_750_000,  "price": 99.75, "spread_bps": 350, "moodys": "B1",  "sp": "B+",  "recovery": 52.0},
    {"obligor": "Summit Education Partners", "facility": "Term Loan B",  "isin": "US01901STU23", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Services",                "moodys_ind": "Business Services",      "cov_lite": True,  "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "05/31/2030", "par": 14_500_000, "price": 97.25, "spread_bps": 425, "moodys": "B2",  "sp": "B",   "recovery": 44.0},
    {"obligor": "Titan Aerospace Inc",      "facility": "First Lien TL", "isin": "US02012TUV34", "type": "Senior Secured", "currency": "USD", "country": "US",
     "industry": "Aerospace",               "moodys_ind": "Aerospace & Defense",    "cov_lite": True,  "fixed": False, "defaulted": False, "second_lien": False,
     "maturity": "08/31/2031", "par": 9_750_000,  "price": 100.00, "spread_bps": 300, "moodys": "Ba3", "sp": "BB-", "recovery": 58.0},
]

# Moody's rating → WARF factor
WARF_MAP = {"Aaa": 1, "Aa1": 10, "Aa2": 20, "Aa3": 40, "A1": 70, "A2": 120, "A3": 180,
            "Baa1": 260, "Baa2": 360, "Baa3": 610, "Ba1": 940, "Ba2": 1350, "Ba3": 1766,
            "B1": 2220, "B2": 2720, "B3": 3490, "Caa1": 4770, "Caa2": 6500, "Caa3": 8070}

# ═══════════════════════════════════════════════════════════════════════════
# Compute derived metrics from holdings
# ═══════════════════════════════════════════════════════════════════════════

def compute_metrics():
    total_par = sum(h["par"] for h in HOLDINGS)
    assert total_par == 242_500_000, f"Holdings par sum is {total_par}, expected 242,500,000"

    n_assets = len(HOLDINGS)
    obligors = set(h["obligor"] for h in HOLDINGS)
    n_obligors = len(obligors)

    # WA Spread (floating only)
    floating = [h for h in HOLDINGS if not h["fixed"] and h["spread_bps"] is not None]
    floating_par = sum(h["par"] for h in floating)
    wa_spread_bps = sum(h["spread_bps"] * h["par"] for h in floating) / floating_par
    wa_spread_pct = wa_spread_bps / 100

    # WA Recovery
    wa_recovery = sum(h["recovery"] * h["par"] for h in HOLDINGS) / total_par

    # WARF
    warf = sum(WARF_MAP.get(h["moodys"], 2720) * h["par"] for h in HOLDINGS) / total_par

    # WAL (years from report date Dec 2024)
    from datetime import datetime
    report_dt = datetime(2024, 12, 10)
    wal = 0
    for h in HOLDINGS:
        m, d, y = h["maturity"].split("/")
        mat_dt = datetime(int(y), int(m), int(d))
        years = (mat_dt - report_dt).days / 365.25
        wal += years * h["par"]
    wal /= total_par

    # WA Coupon
    wa_coupon = 0
    for h in HOLDINGS:
        if h["fixed"]:
            coupon = 7.50  # fixed rate
        else:
            coupon = BASE_RATE + (h["spread_bps"] or 0) / 100
        wa_coupon += coupon * h["par"]
    wa_coupon /= total_par

    # Pct calculations
    fixed_par = sum(h["par"] for h in HOLDINGS if h["fixed"])
    cov_lite_par = sum(h["par"] for h in HOLDINGS if h["cov_lite"])
    second_lien_par = sum(h["par"] for h in HOLDINGS if h["second_lien"])
    defaulted_par = sum(h["par"] for h in HOLDINGS if h["defaulted"])

    # CCC and below
    ccc_ratings = {"Caa1", "Caa2", "Caa3", "Ca", "C"}
    ccc_par = sum(h["par"] for h in HOLDINGS if h["moodys"] in ccc_ratings)

    # Diversity score (simplified: number of distinct Moody's industries)
    industries = set(h["moodys_ind"] for h in HOLDINGS)
    diversity = len(industries) * 5 + 2  # rough approximation

    # Industry concentrations
    industry_par = {}
    for h in HOLDINGS:
        ind = h["moodys_ind"]
        industry_par[ind] = industry_par.get(ind, 0) + h["par"]

    # Rating distribution
    rating_buckets = {"Ba3/BB- and above": 0, "B1/B+": 0, "B2/B": 0, "B3/B-": 0, "Caa1/CCC+ and below": 0}
    for h in HOLDINGS:
        m = h["moodys"]
        if m in ("Aaa", "Aa1", "Aa2", "Aa3", "A1", "A2", "A3", "Baa1", "Baa2", "Baa3", "Ba1", "Ba2", "Ba3"):
            rating_buckets["Ba3/BB- and above"] += h["par"]
        elif m == "B1":
            rating_buckets["B1/B+"] += h["par"]
        elif m == "B2":
            rating_buckets["B2/B"] += h["par"]
        elif m == "B3":
            rating_buckets["B3/B-"] += h["par"]
        else:
            rating_buckets["Caa1/CCC+ and below"] += h["par"]

    # Top obligor exposures (sorted by par desc)
    sorted_holdings = sorted(HOLDINGS, key=lambda h: h["par"], reverse=True)

    return {
        "total_par": total_par,
        "n_assets": n_assets,
        "n_obligors": n_obligors,
        "wa_spread_pct": wa_spread_pct,
        "wa_coupon": wa_coupon,
        "wa_recovery": wa_recovery,
        "warf": warf,
        "wal": wal,
        "diversity": diversity,
        "pct_fixed": fixed_par / total_par * 100,
        "pct_floating": (total_par - fixed_par) / total_par * 100,
        "pct_cov_lite": cov_lite_par / total_par * 100,
        "pct_second_lien": second_lien_par / total_par * 100,
        "pct_defaulted": defaulted_par / total_par * 100,
        "pct_ccc": ccc_par / total_par * 100,
        "industry_par": industry_par,
        "rating_buckets": rating_buckets,
        "sorted_holdings": sorted_holdings,
    }


def fmt_dollars(n):
    """Format as $X,XXX,XXX"""
    return f"${n:,.0f}"

def fmt_dollars_cents(n):
    return f"${n:,.2f}"


class ComplianceReportPDF(FPDF):
    def header(self):
        if self.page_no() > 1:
            self.set_font("Helvetica", "I", 8)
            self.cell(0, 5, f"{DEAL_NAME} - Monthly Report - December 2024", align="C")
            self.ln(8)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

    def section_title(self, title):
        self.set_font("Helvetica", "B", 14)
        self.set_fill_color(0, 51, 102)
        self.set_text_color(255, 255, 255)
        self.cell(0, 10, f"  {title}", fill=True, new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(0, 0, 0)
        self.ln(4)

    def sub_title(self, title):
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(0, 51, 102)
        self.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(0, 0, 0)
        self.ln(2)

    def label_value(self, label, value, col_width=90):
        self.set_font("Helvetica", "", 9)
        self.cell(col_width, 6, label, border=0)
        self.set_font("Helvetica", "B", 9)
        self.cell(0, 6, str(value), new_x="LMARGIN", new_y="NEXT")

    def table_header(self, cols, widths):
        self.set_font("Helvetica", "B", 8)
        self.set_fill_color(220, 230, 241)
        for i, col in enumerate(cols):
            self.cell(widths[i], 7, col, border=1, fill=True, align="C")
        self.ln()

    def table_row(self, values, widths, aligns=None):
        self.set_font("Helvetica", "", 8)
        if aligns is None:
            aligns = ["L"] * len(values)
        for i, val in enumerate(values):
            self.cell(widths[i], 6, str(val), border=1, align=aligns[i])
        self.ln()


def generate():
    m = compute_metrics()
    pdf = ComplianceReportPDF()
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=20)

    # ── Page 1: Cover ──
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 22)
    pdf.ln(30)
    pdf.cell(0, 12, DEAL_NAME.upper(), align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 14)
    pdf.cell(0, 10, "Monthly Trustee Report", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(10)
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 8, "Payment Date: December 15, 2024", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, "Report Date: December 10, 2024", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, "Determination Date: December 5, 2024", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(15)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 7, f"Trustee: {TRUSTEE}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 7, f"Collateral Manager: {COLLATERAL_MANAGER}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 7, "Report Type: Monthly", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(10)
    pdf.set_font("Helvetica", "I", 9)
    pdf.cell(0, 7, "Collection Period: November 16, 2024 - December 15, 2024", align="C", new_x="LMARGIN", new_y="NEXT")

    # ── Page 2-3: Compliance Summary ──
    pdf.add_page()
    pdf.section_title("I. COMPLIANCE SUMMARY")

    pdf.sub_title("Deal Information")
    pdf.label_value("Deal Name:", DEAL_NAME)
    pdf.label_value("Closing Date:", "March 15, 2024")
    pdf.label_value("Stated Maturity:", "April 15, 2037")
    pdf.label_value("Reinvestment Period End:", "April 15, 2029")
    pdf.label_value("Non-Call Period End:", "April 15, 2026")
    pdf.label_value("Next Payment Date:", "January 15, 2025")
    pdf.label_value("Collection Period End:", "December 15, 2024")
    pdf.ln(4)

    pdf.sub_title("Collateral Summary")
    pdf.label_value("Adjusted Collateral Principal Amount:", fmt_dollars_cents(m["total_par"]))
    pdf.label_value("Aggregate Principal Balance:", fmt_dollars_cents(m["total_par"] - 624_568))  # slight difference is normal
    pdf.label_value("Number of Assets:", str(m["n_assets"]))
    pdf.label_value("Number of Obligors:", str(m["n_obligors"]))
    pdf.label_value("Weighted Average Spread:", f"{m['wa_spread_pct']:.2f}%")
    pdf.label_value("Weighted Average Coupon (All-in):", f"{m['wa_coupon']:.2f}%")
    pdf.label_value("Diversity Score:", str(m["diversity"]))
    pdf.label_value("WARF:", f"{m['warf']:.0f}")
    pdf.label_value("WAL (Years):", f"{m['wal']:.2f}")
    pdf.label_value("WA Recovery Rate:", f"{m['wa_recovery']:.2f}%")
    pdf.label_value("% Fixed Rate:", f"{m['pct_fixed']:.2f}%")
    pdf.label_value("% Floating Rate:", f"{m['pct_floating']:.2f}%")
    pdf.label_value("% Cov-Lite:", f"{m['pct_cov_lite']:.2f}%")
    pdf.label_value("% Second Lien:", f"{m['pct_second_lien']:.2f}%")
    pdf.label_value("% Defaulted:", f"{m['pct_defaulted']:.2f}%")
    pdf.label_value("% CCC and Below:", f"{m['pct_ccc']:.2f}%")
    pdf.ln(4)

    # Capital structure
    pdf.sub_title("Capital Structure")
    cols = ["Class", "Original Balance", "Spread (bps)", "All-in Rate", "Current Balance", "Rating", "Coupon Rate"]
    widths = [18, 32, 24, 22, 32, 30, 24]
    aligns = ["C", "R", "C", "C", "R", "C", "C"]
    pdf.table_header(cols, widths)
    for t in TRANCHES:
        spread_str = str(t["spread_bps"]) if t["spread_bps"] else "N/A"
        if t["spread_bps"]:
            all_in = f"{(BASE_RATE + t['spread_bps'] / 100):.2f}%"
            coupon = all_in
        else:
            all_in = "N/A"
            coupon = "Residual"
        pdf.table_row([
            t["class"], fmt_dollars(t["original"]), spread_str, all_in,
            fmt_dollars(t["original"]), t["rating"], coupon
        ], widths, aligns)

    # ── OC Tests ──
    pdf.add_page()
    pdf.section_title("II. PAR VALUE / OVERCOLLATERALIZATION TESTS")

    total_par = m["total_par"]
    # Cumulative tranche amounts for OC denominators
    cum_a = 148_000_000 + 20_000_000  # A-1 + A-2
    cum_b = cum_a + 24_000_000
    cum_c = cum_b + 16_500_000
    cum_d = cum_c + 14_000_000
    cum_e = cum_d + 10_000_000

    pdf.sub_title("Overcollateralization Tests")
    cols = ["Test Name", "Class", "Numerator", "Denominator", "Actual", "Trigger", "Cushion", "Result"]
    widths = [36, 16, 28, 28, 20, 20, 20, 16]
    aligns = ["L", "C", "R", "R", "R", "R", "R", "C"]
    pdf.table_header(cols, widths)

    oc_triggers = {"A": 126.0, "B": 117.5, "C": 111.0, "D": 105.5, "E": 102.0}
    oc_denoms = {"A": cum_a, "B": cum_b, "C": cum_c, "D": cum_d, "E": cum_e}
    for cls, trigger in oc_triggers.items():
        denom = oc_denoms[cls]
        actual = total_par / denom * 100
        cushion = actual - trigger
        result = "Pass" if actual >= trigger else "Fail"
        pdf.table_row([
            f"Class {cls} OC Ratio Test", cls,
            fmt_dollars(total_par), fmt_dollars(denom),
            f"{actual:.2f}%", f"{trigger:.2f}%", f"{cushion:.2f}%", result
        ], widths, aligns)

    pdf.ln(6)
    pdf.sub_title("Par Value Adjustments")
    cols = ["Adjustment", "Type", "Description", "Gross Amount", "Adj Amount", "Net Amount"]
    widths = [34, 24, 40, 28, 28, 28]
    aligns = ["L", "L", "L", "R", "R", "R"]
    pdf.table_header(cols, widths)
    ccc_excess = sum(h["par"] for h in HOLDINGS if h["moodys"] in ("Caa1", "Caa2", "Caa3")) - total_par * 0.075
    ccc_excess = max(0, ccc_excess)
    pdf.table_row(["CCC Excess Haircut", "Haircut", "CCC excess over 7.5%", fmt_dollars(ccc_excess), "$0", fmt_dollars(ccc_excess)], widths, aligns)
    pdf.table_row(["Discount Obligation", "Haircut", "Purchased below 85%", "$0", "$0", "$0"], widths, aligns)
    pdf.table_row(["Defaulted Securities", "Exclusion", "Recovery value only", "$0", "$0", "$0"], widths, aligns)

    # ── IC Tests ──
    pdf.add_page()
    pdf.section_title("III. INTEREST COVERAGE TESTS")

    # Compute interest income from holdings (quarterly)
    quarterly_interest = 0
    for h in HOLDINGS:
        if h["fixed"]:
            rate = 7.50 / 100
        else:
            rate = (BASE_RATE + (h["spread_bps"] or 0) / 100) / 100
        quarterly_interest += h["par"] * rate / 4

    pdf.sub_title("Interest Coverage Tests")
    cols = ["Test Name", "Class", "Numerator", "Denominator", "Actual", "Trigger", "Cushion", "Result"]
    widths = [36, 16, 28, 28, 20, 20, 20, 16]
    aligns = ["L", "C", "R", "R", "R", "R", "R", "C"]
    pdf.table_header(cols, widths)

    ic_triggers = {"A": 120.0, "B": 115.0, "C": 110.0, "D": 105.0, "E": 103.0}
    ic_denoms_map = {
        "A": sum(t["original"] * (BASE_RATE + t["spread_bps"] / 100) / 100 / 4 for t in TRANCHES if t["class"] in ("A-1", "A-2")),
        "B": sum(t["original"] * (BASE_RATE + t["spread_bps"] / 100) / 100 / 4 for t in TRANCHES if t["class"] in ("A-1", "A-2", "B")),
        "C": sum(t["original"] * (BASE_RATE + t["spread_bps"] / 100) / 100 / 4 for t in TRANCHES if t["class"] in ("A-1", "A-2", "B", "C")),
        "D": sum(t["original"] * (BASE_RATE + t["spread_bps"] / 100) / 100 / 4 for t in TRANCHES if t["class"] in ("A-1", "A-2", "B", "C", "D")),
        "E": sum(t["original"] * (BASE_RATE + t["spread_bps"] / 100) / 100 / 4 for t in TRANCHES if t["class"] in ("A-1", "A-2", "B", "C", "D", "E")),
    }
    for cls, trigger in ic_triggers.items():
        denom = ic_denoms_map[cls]
        actual = quarterly_interest / denom * 100
        cushion = actual - trigger
        result = "Pass" if actual >= trigger else "Fail"
        pdf.table_row([
            f"Class {cls} IC Ratio Test", cls,
            fmt_dollars(round(quarterly_interest)), fmt_dollars(round(denom)),
            f"{actual:.2f}%", f"{trigger:.2f}%", f"{cushion:.2f}%", result
        ], widths, aligns)

    pdf.ln(6)
    pdf.sub_title("Interest Amounts Per Tranche")
    cols = ["Class", "Interest Amount", "Currency"]
    widths = [30, 40, 30]
    aligns = ["C", "R", "C"]
    pdf.table_header(cols, widths)
    for t in TRANCHES:
        if t["spread_bps"] is None:
            continue
        rate = (BASE_RATE + t["spread_bps"] / 100) / 100
        interest = t["original"] * rate / 4
        pdf.table_row([t["class"], fmt_dollars(round(interest)), "USD"], widths, aligns)

    # ── Account Balances ──
    pdf.add_page()
    pdf.section_title("IV. ACCOUNT BALANCES")
    cols = ["Account Name", "Type", "Currency", "Balance", "Required", "Excess/(Deficit)"]
    widths = [40, 25, 20, 30, 30, 35]
    aligns = ["L", "L", "C", "R", "R", "R"]
    pdf.table_header(cols, widths)
    accounts = [
        ["Payment Account", "Operating", "USD", "$3,245,872.50", "N/A", "N/A"],
        ["Collection Account", "Operating", "USD", "$8,127,341.25", "N/A", "N/A"],
        ["Interest Reserve", "Reserve", "USD", "$1,250,000.00", "$1,250,000.00", "$0.00"],
        ["Principal Collection", "Operating", "USD", "$4,532,118.75", "N/A", "N/A"],
        ["Expense Reserve", "Reserve", "USD", "$175,000.00", "$150,000.00", "$25,000.00"],
        ["Revolver Funding", "Commitment", "USD", "$2,500,000.00", "N/A", "N/A"],
    ]
    for row in accounts:
        pdf.table_row(row, widths, aligns)

    # ── Holdings ──
    pdf.add_page()
    pdf.section_title("V. SCHEDULE OF INVESTMENTS")

    cols_h = ["Obligor", "ISIN", "Industry", "Maturity", "Par Balance", "Price", "Spread", "Moody's", "S&P"]
    widths_h = [30, 24, 22, 20, 24, 14, 14, 14, 14]
    aligns_h = ["L", "L", "L", "C", "R", "R", "C", "C", "C"]

    pdf.sub_title("Portfolio Holdings")
    pdf.table_header(cols_h, widths_h)

    for h in HOLDINGS:
        if pdf.get_y() > 260:
            pdf.add_page()
            pdf.table_header(cols_h, widths_h)
        spread_str = str(h["spread_bps"]) if h["spread_bps"] else "N/A"
        pdf.table_row([
            h["obligor"][:18], h["isin"], h["industry"][:14], h["maturity"],
            fmt_dollars(h["par"]), f"{h['price']:.2f}", spread_str, h["moodys"], h["sp"]
        ], widths_h, aligns_h)

    # ── Tranche Payment Summary ──
    pdf.add_page()
    pdf.section_title("V-B. TRANCHE PAYMENT SUMMARY")

    pdf.sub_title("Note Balances and Payments - Current Period")
    cols_tp = ["Class", "Beginning Balance", "Interest Paid", "Principal Paid", "Ending Balance"]
    widths_tp = [24, 36, 34, 34, 36]
    aligns_tp = ["C", "R", "R", "R", "R"]
    pdf.table_header(cols_tp, widths_tp)

    for t in TRANCHES:
        beginning = t["original"]
        if t["spread_bps"] is not None:
            rate = (BASE_RATE + t["spread_bps"] / 100) / 100
            interest = t["original"] * rate / 4
        else:
            interest = 0
        principal_paid = 0  # No amortization in first period
        ending = beginning - principal_paid
        pdf.table_row([
            t["class"], fmt_dollars(beginning), fmt_dollars(round(interest)),
            fmt_dollars(principal_paid), fmt_dollars(ending)
        ], widths_tp, aligns_tp)

    # ── Concentrations ──
    pdf.add_page()
    pdf.section_title("VI. CONCENTRATION / PORTFOLIO PROFILE")

    pdf.sub_title("Industry Concentration")
    cols_c = ["Industry", "Actual ($)", "Actual %", "Limit %", "Excess", "Pass/Fail"]
    widths_c = [40, 30, 22, 22, 30, 22]
    aligns_c = ["L", "R", "R", "R", "R", "C"]
    pdf.table_header(cols_c, widths_c)

    for ind, par in sorted(m["industry_par"].items(), key=lambda x: -x[1]):
        pct = par / total_par * 100
        limit = 12.0 if pct > 2.5 else 10.0
        pdf.table_row([ind[:22], fmt_dollars(par), f"{pct:.2f}%", f"{limit:.2f}%", "$0", "Pass"], widths_c, aligns_c)

    pdf.ln(6)
    pdf.sub_title("Rating Distribution")
    cols_r = ["Rating Bucket", "Actual ($)", "Actual %", "Limit %", "Pass/Fail"]
    widths_r = [40, 30, 22, 22, 22]
    aligns_r = ["L", "R", "R", "R", "C"]
    pdf.table_header(cols_r, widths_r)

    for bucket, par in m["rating_buckets"].items():
        pct = par / total_par * 100
        limit = "7.50%" if "Caa" in bucket or "CCC" in bucket else "N/A"
        result = "Pass" if limit == "N/A" or pct < 7.5 else "Fail"
        pdf.table_row([bucket, fmt_dollars(par), f"{pct:.2f}%", limit, result], widths_r, aligns_r)

    pdf.ln(6)
    pdf.sub_title("Single Obligor Concentration")
    cols_o = ["Obligor", "Actual ($)", "Actual %", "Limit %", "Pass/Fail"]
    widths_o = [50, 30, 22, 22, 22]
    aligns_o = ["L", "R", "R", "R", "C"]
    pdf.table_header(cols_o, widths_o)
    for h in m["sorted_holdings"][:5]:
        pct = h["par"] / total_par * 100
        pdf.table_row([h["obligor"], fmt_dollars(h["par"]), f"{pct:.2f}%", "2.50%",
                        "Pass" if pct < 2.5 else "Fail"], widths_o, aligns_o)

    # ── Trading Activity ──
    pdf.add_page()
    pdf.section_title("VII. TRADING ACTIVITY")
    pdf.sub_title("Trading Summary")
    pdf.label_value("Total Purchases (Par):", "$12,450,000")
    pdf.label_value("Total Sales (Par):", "$8,200,000")
    pdf.label_value("Net Gain/(Loss):", "($164,000)")
    pdf.label_value("Total Paydowns:", "$3,750,000")
    pdf.label_value("Total Prepayments:", "$1,250,000")
    pdf.label_value("Turnover Rate:", "5.23%")
    pdf.ln(4)

    pdf.sub_title("Trade Detail")
    cols_t = ["Type", "Obligor", "Trade Date", "Settle Date", "Par Amount", "Price", "Settle Amt"]
    widths_t = [20, 34, 22, 22, 26, 16, 26]
    aligns_t = ["L", "L", "C", "C", "R", "R", "R"]
    pdf.table_header(cols_t, widths_t)
    trades = [
        ["Purchase", "Alpha Energy Co",  "11/20/2024", "11/25/2024", "$2,500,000", "99.50", "$2,487,500"],
        ["Purchase", "Bravo Logistics",   "11/22/2024", "11/27/2024", "$3,000,000", "98.75", "$2,962,500"],
        ["Purchase", "Charlie Retail",    "12/01/2024", "12/05/2024", "$1,950,000", "99.00", "$1,930,500"],
        ["Sale",     "Foxtrot Media",     "11/18/2024", "11/22/2024", "$3,200,000", "97.00", "$3,104,000"],
        ["Sale",     "Golf Industries",   "12/02/2024", "12/06/2024", "$2,500,000", "98.50", "$2,462,500"],
        ["Paydown",  "India Software",    "12/15/2024", "12/15/2024", "$2,000,000", "100.00","$2,000,000"],
        ["Paydown",  "Juliet Consumer",   "12/15/2024", "12/15/2024", "$1,750,000", "100.00","$1,750,000"],
    ]
    for row in trades:
        pdf.table_row(row, widths_t, aligns_t)

    # ── Supplementary ──
    pdf.add_page()
    pdf.section_title("VIII. SUPPLEMENTARY INFORMATION")
    pdf.sub_title("Events")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_x(10)
    pdf.multi_cell(0, 5, "No Events of Default have occurred during the reporting period.")
    pdf.ln(4)

    pdf.sub_title("Fee Schedule")
    cols_f = ["Fee Type", "Payee", "Rate (bps)", "Accrued", "Paid"]
    widths_f = [36, 40, 20, 34, 34]
    aligns_f = ["L", "L", "C", "R", "R"]
    pdf.table_header(cols_f, widths_f)
    sr_fee = total_par * 0.0015 / 4
    sub_fee = total_par * 0.0025 / 4
    trustee_fee = total_par * 0.0002 / 4
    pdf.table_row(["Senior Mgmt Fee", "Elmwood Asset Mgmt", "15", fmt_dollars_cents(sr_fee), fmt_dollars_cents(sr_fee)], widths_f, aligns_f)
    pdf.table_row(["Sub Mgmt Fee", "Elmwood Asset Mgmt", "25", fmt_dollars_cents(sub_fee), fmt_dollars_cents(sub_fee)], widths_f, aligns_f)
    pdf.table_row(["Trustee Fee", "BNY Mellon", "2", fmt_dollars_cents(trustee_fee), fmt_dollars_cents(trustee_fee)], widths_f, aligns_f)

    pdf.ln(6)
    pdf.sub_title("Moody's Analytics")
    pdf.label_value("WARF:", f"{m['warf']:.0f}")
    pdf.label_value("Diversity Score:", str(m["diversity"]))
    pdf.label_value("WA Spread:", f"{m['wa_spread_pct']:.2f}%")
    pdf.label_value("WA Coupon:", f"{m['wa_coupon']:.2f}%")
    pdf.label_value("WA Recovery:", f"{m['wa_recovery']:.2f}%")
    pdf.label_value("WA Life:", f"{m['wal']:.2f} years")

    # Save
    path = "/Users/solal/Documents/GitHub/funzies/samples/sample_compliance_report.pdf"
    pdf.output(path)
    print(f"Generated: {path} ({pdf.page_no()} pages)")
    print(f"  Total Par: {fmt_dollars(m['total_par'])}")
    print(f"  Assets: {m['n_assets']}, Obligors: {m['n_obligors']}")
    print(f"  WA Spread: {m['wa_spread_pct']:.2f}%, WARF: {m['warf']:.0f}, WAL: {m['wal']:.2f}y")


if __name__ == "__main__":
    generate()
