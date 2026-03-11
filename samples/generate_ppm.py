#!/usr/bin/env python3
"""Generate a sample CLO Private Placement Memorandum (PPM) PDF for testing extraction."""

from fpdf import FPDF

class PpmPDF(FPDF):
    def header(self):
        if self.page_no() > 2:
            self.set_font("Helvetica", "I", 8)
            self.cell(0, 5, "Elmwood CLO 2024-1, Ltd. - Private Placement Memorandum", align="C")
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

    def body_text(self, text):
        self.set_font("Helvetica", "", 9)
        self.multi_cell(0, 5, text)
        self.ln(2)

    def bullet(self, text):
        self.set_font("Helvetica", "", 9)
        x = self.get_x()
        self.cell(8, 5, "-")
        self.multi_cell(0, 5, text)
        self.ln(1)

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
    pdf = PpmPDF()
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=20)

    # =========================================================================
    # COVER PAGE
    # =========================================================================
    pdf.add_page()
    pdf.ln(25)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, "CONFIDENTIAL", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(10)
    pdf.set_font("Helvetica", "B", 24)
    pdf.cell(0, 14, "ELMWOOD CLO 2024-1, LTD.", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(5)
    pdf.set_font("Helvetica", "", 12)
    pdf.cell(0, 8, "(a Cayman Islands exempted company with limited liability)", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(10)
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, "PRIVATE PLACEMENT MEMORANDUM", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(10)

    pdf.set_font("Helvetica", "", 10)
    notes = [
        "USD 240,000,000 Class A-1 Senior Secured Floating Rate Notes due 2037",
        "USD 20,000,000 Class A-2 Senior Secured Floating Rate Notes due 2037",
        "USD 32,000,000 Class B Senior Secured Floating Rate Notes due 2037",
        "USD 24,000,000 Class C Secured Deferrable Floating Rate Notes due 2037",
        "USD 20,000,000 Class D Secured Deferrable Floating Rate Notes due 2037",
        "USD 14,000,000 Class E Secured Deferrable Floating Rate Notes due 2037",
        "USD 50,000,000 Subordinated Notes due 2037",
    ]
    for n in notes:
        pdf.cell(0, 7, n, align="C", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(10)
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 6, "Dated: March 1, 2024", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, "Arranger: Morgan Stanley & Co. LLC", align="C", new_x="LMARGIN", new_y="NEXT")

    # =========================================================================
    # TABLE OF CONTENTS
    # =========================================================================
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "TABLE OF CONTENTS", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    toc = [
        ("I.", "Transaction Overview", 3),
        ("II.", "Capital Structure", 4),
        ("III.", "Coverage Tests", 6),
        ("IV.", "Eligibility Criteria", 7),
        ("V.", "Portfolio Constraints", 9),
        ("VI.", "Priority of Payments (Waterfall)", 11),
        ("VII.", "Fees and Expenses", 13),
        ("VIII.", "Key Dates", 14),
        ("IX.", "Key Parties", 15),
        ("X.", "Redemption Provisions", 16),
        ("XI.", "Hedging", 17),
    ]
    for num, title, page in toc:
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(10, 7, num)
        pdf.cell(120, 7, title)
        pdf.cell(0, 7, str(page), align="R", new_x="LMARGIN", new_y="NEXT")

    # =========================================================================
    # I. TRANSACTION OVERVIEW
    # =========================================================================
    pdf.add_page()
    pdf.section_title("I. TRANSACTION OVERVIEW")

    pdf.label_value("Deal Name:", "Elmwood CLO 2024-1, Ltd.")
    pdf.label_value("Issuer Legal Name:", "Elmwood CLO 2024-1, Ltd.")
    pdf.label_value("Co-Issuer:", "Elmwood CLO 2024-1, LLC")
    pdf.label_value("Collateral Manager:", "Elmwood Asset Management LLC")
    pdf.label_value("Jurisdiction:", "Cayman Islands")
    pdf.label_value("Entity Type:", "Exempted company with limited liability")
    pdf.label_value("Governing Law:", "New York / Cayman Islands")
    pdf.label_value("Currency:", "USD")
    pdf.label_value("Listing Exchange:", "Irish Stock Exchange (Euronext Dublin)")
    pdf.ln(4)

    pdf.body_text(
        "Elmwood CLO 2024-1, Ltd. (the 'Issuer') is a Cayman Islands exempted company with limited liability "
        "formed for the purpose of acquiring a diversified portfolio of broadly syndicated senior secured loans "
        "and issuing multiple tranches of secured and subordinated notes. The Issuer will be managed by "
        "Elmwood Asset Management LLC (the 'Collateral Manager'), a registered investment adviser under the "
        "Investment Advisers Act of 1940."
    )

    pdf.body_text(
        "The transaction is structured as a cash flow CLO with a five-year reinvestment period, during which "
        "the Collateral Manager may actively trade the portfolio subject to the reinvestment criteria and "
        "portfolio constraints described herein. Following the end of the reinvestment period, the Collateral "
        "Manager's ability to reinvest is limited to credit risk and credit improved sales."
    )

    # =========================================================================
    # II. CAPITAL STRUCTURE
    # =========================================================================
    pdf.add_page()
    pdf.section_title("II. CAPITAL STRUCTURE")

    pdf.sub_title("Notes Summary")

    cols = ["Class", "Designation", "Principal Amount", "Rate Type", "Ref Rate", "Spread (bps)", "Rating (S&P)", "Rating (Fitch)", "Deferrable", "Maturity"]
    widths = [12, 36, 24, 16, 18, 16, 16, 16, 16, 18]
    aligns = ["C", "L", "R", "C", "C", "C", "C", "C", "C", "C"]
    pdf.table_header(cols, widths)

    tranches = [
        ["A-1", "Sr Sec Fltg Rate", "$240,000,000", "Floating", "SOFR", "145", "AAA", "AAA", "No", "04/15/2037"],
        ["A-2", "Sr Sec Fltg Rate", "$20,000,000", "Floating", "SOFR", "175", "AAA", "AAA", "No", "04/15/2037"],
        ["B", "Sr Sec Fltg Rate", "$32,000,000", "Floating", "SOFR", "210", "AA", "AA", "No", "04/15/2037"],
        ["C", "Sec Def Fltg Rate", "$24,000,000", "Floating", "SOFR", "275", "A", "A", "Yes", "04/15/2037"],
        ["D", "Sec Def Fltg Rate", "$20,000,000", "Floating", "SOFR", "400", "BBB-", "BBB-", "Yes", "04/15/2037"],
        ["E", "Sec Def Fltg Rate", "$14,000,000", "Floating", "SOFR", "650", "BB-", "BB-", "Yes", "04/15/2037"],
        ["Sub", "Subordinated", "$50,000,000", "N/A", "N/A", "N/A", "NR", "NR", "N/A", "04/15/2037"],
    ]
    for row in tranches:
        pdf.table_row(row, widths, aligns)

    pdf.ln(6)
    pdf.sub_title("Deal Sizing")
    pdf.label_value("Target Par Amount:", "$400,000,000")
    pdf.label_value("Total Rated Notes:", "$350,000,000")
    pdf.label_value("Total Subordinated Notes:", "$50,000,000")
    pdf.label_value("Total Deal Size:", "$400,000,000")
    pdf.label_value("Equity % of Deal:", "12.50%")

    pdf.ln(4)
    pdf.body_text(
        "The Class A-1 Notes, Class A-2 Notes, and Class B Notes (the 'Senior Notes') are non-deferrable "
        "and will bear interest at a floating rate equal to 3-month Term SOFR plus the applicable spread. "
        "The Class C Notes, Class D Notes, and Class E Notes (the 'Mezzanine Notes') are deferrable and "
        "may defer interest payments to the extent funds are insufficient in the waterfall."
    )

    pdf.body_text(
        "The Subordinated Notes represent the equity tranche of the transaction and are entitled to "
        "residual cash flows after all senior and mezzanine obligations have been satisfied."
    )

    # =========================================================================
    # III. COVERAGE TESTS
    # =========================================================================
    pdf.add_page()
    pdf.section_title("III. COVERAGE TESTS")

    pdf.sub_title("Overcollateralization Tests")
    pdf.body_text(
        "The following overcollateralization ratio tests must be satisfied on each determination date. "
        "Failure to satisfy any OC test will result in the diversion of interest and principal proceeds "
        "to redeem the most senior class of notes until the test is cured."
    )

    cols_oc = ["Class", "Par Value Ratio Trigger", "Interest Coverage Ratio Trigger"]
    widths_oc = [30, 50, 50]
    aligns_oc = ["C", "C", "C"]
    pdf.table_header(cols_oc, widths_oc)

    oc_entries = [
        ["A (A-1 + A-2)", "126.00%", "120.00%"],
        ["B", "117.50%", "115.00%"],
        ["C", "111.00%", "110.00%"],
        ["D", "105.50%", "105.00%"],
        ["E", "102.00%", "103.00%"],
    ]
    for row in oc_entries:
        pdf.table_row(row, widths_oc, aligns_oc)

    pdf.ln(6)
    pdf.sub_title("Reinvestment Overcollateralization Test")
    pdf.label_value("Trigger Level:", "105.80%")
    pdf.label_value("Applies During:", "Reinvestment Period only")
    pdf.label_value("Diversion Amount:", "Up to 50% of excess interest proceeds to acquire additional collateral")

    pdf.ln(4)
    pdf.body_text(
        "If the Reinvestment OC Test is not satisfied on any determination date during the reinvestment "
        "period, up to 50% of available excess interest proceeds (after payment of all fees and expenses "
        "and scheduled interest on all classes of notes) shall be applied to the purchase of additional "
        "collateral obligations."
    )

    # =========================================================================
    # IV. ELIGIBILITY CRITERIA
    # =========================================================================
    pdf.add_page()
    pdf.section_title("IV. ELIGIBILITY CRITERIA")

    pdf.sub_title("Collateral Obligation Eligibility Criteria")
    pdf.body_text(
        "Each collateral obligation acquired by the Issuer must satisfy all of the following criteria at "
        "the time of acquisition:"
    )

    criteria = [
        "The obligation is a senior secured loan or senior secured bond denominated in USD, EUR, or GBP.",
        "The obligation has a minimum par amount of $1,000,000 (or currency equivalent).",
        "The obligation has a Moody's rating of at least Caa2 and an S&P rating of at least CCC.",
        "The obligation is not a structured finance obligation, synthetic security, or equity interest.",
        "The obligor is domiciled in an OECD country or an approved non-OECD jurisdiction.",
        "The obligation has a maximum stated maturity not exceeding 8 years from the closing date.",
        "The obligation pays interest at least semi-annually.",
        "The obligation is not a zero-coupon bond, PIK-only security, or DIP loan.",
        "The obligation is freely transferable without consent of the obligor.",
        "The obligation is not subject to margin regulation or ERISA restrictions.",
        "The obligation's spread (or fixed coupon) is at least 200 basis points per annum.",
        "The obligation does not have a purchase price exceeding 105% of par.",
    ]
    for c in criteria:
        pdf.bullet(c)

    pdf.ln(4)
    pdf.sub_title("Reinvestment Criteria")
    pdf.label_value("During Reinvestment Period:", "Full reinvestment permitted subject to eligibility criteria and portfolio constraints")
    pdf.label_value("Post-Reinvestment:", "Limited to credit risk sales, credit improved sales, and unscheduled principal proceeds")
    pdf.label_value("Substitute Requirements:", "Replacement asset must satisfy eligibility criteria and not cause any portfolio constraint breach")

    # =========================================================================
    # V. PORTFOLIO CONSTRAINTS
    # =========================================================================
    pdf.add_page()
    pdf.section_title("V. PORTFOLIO CONSTRAINTS")

    pdf.sub_title("Collateral Quality Tests")
    pdf.body_text(
        "The portfolio must satisfy the following collateral quality tests at all times. Any trade that "
        "would cause a test to fail (or further fail) is not permitted."
    )

    cols_cq = ["Test Name", "Agency", "Limit"]
    widths_cq = [60, 30, 40]
    aligns_cq = ["L", "C", "C"]
    pdf.table_header(cols_cq, widths_cq)

    cq_tests = [
        ["Minimum Weighted Average Spread", "N/A", ">= 3.50%"],
        ["Maximum WARF", "Moody's", "<= 3000"],
        ["Minimum Weighted Average Recovery Rate", "Moody's", ">= 45.00%"],
        ["Minimum Diversity Score", "Moody's", ">= 55"],
        ["Maximum Weighted Average Life", "N/A", "<= 5.50 years"],
        ["Minimum Weighted Average Coupon", "N/A", ">= 7.00%"],
    ]
    for row in cq_tests:
        pdf.table_row(row, widths_cq, aligns_cq)

    pdf.ln(6)
    pdf.sub_title("Portfolio Profile Tests")
    pdf.body_text("The portfolio must satisfy the following concentration and profile limits:")

    cols_pp = ["Test", "Min", "Max", "Notes"]
    widths_pp = [60, 20, 20, 60]
    aligns_pp = ["L", "C", "C", "L"]
    pdf.table_header(cols_pp, widths_pp)

    pp_tests = [
        ["(a) Single Industry", "N/A", "12.0%", "Max exposure to any Moody's industry"],
        ["(b) Single Obligor", "N/A", "2.5%", "Max exposure to any single obligor"],
        ["(c) CCC and Below", "N/A", "7.5%", "Max Caa1/CCC+ and below rated"],
        ["(d) Fixed Rate Assets", "N/A", "10.0%", "Max fixed rate obligations"],
        ["(e) Second Lien Loans", "N/A", "5.0%", "Max second lien secured loans"],
        ["(f) Cov-Lite Loans", "N/A", "80.0%", "Max covenant-lite loans"],
        ["(g) Non-USD Denominated", "N/A", "15.0%", "Max non-USD denominated assets"],
        ["(h) Revolving/DD Loans", "N/A", "7.5%", "Max revolving and delayed draw"],
        ["(i) Senior Secured Bonds", "N/A", "20.0%", "Max senior secured bonds"],
        ["(j) Discount Obligations", "N/A", "5.0%", "Purchased below 80% of par"],
        ["(k) Minimum Number of Obligors", "80", "N/A", "Min distinct obligors"],
    ]
    for row in pp_tests:
        pdf.table_row(row, widths_pp, aligns_pp)

    # =========================================================================
    # VI. WATERFALL
    # =========================================================================
    pdf.add_page()
    pdf.section_title("VI. PRIORITY OF PAYMENTS (WATERFALL)")

    pdf.sub_title("Interest Waterfall")
    pdf.body_text("On each payment date, available interest proceeds shall be applied in the following order of priority:")

    interest_steps = [
        "(1) Payment of taxes and governmental fees owed by the Issuer",
        "(2) Payment of the Trustee Fee, Administration Fee, and other senior administrative expenses (up to $250,000 per annum)",
        "(3) Payment of the Senior Collateral Management Fee (15 bps per annum on collateral principal amount)",
        "(4) Payment of interest on Class A-1 Notes (SOFR + 145 bps)",
        "(5) Payment of interest on Class A-2 Notes (SOFR + 175 bps)",
        "(6) If the Class A OC Test or Class A IC Test is not satisfied, application to redeem Class A Notes",
        "(7) Payment of interest on Class B Notes (SOFR + 210 bps)",
        "(8) If the Class B OC Test or Class B IC Test is not satisfied, application to redeem Class A and Class B Notes",
        "(9) Payment of interest on Class C Notes (SOFR + 275 bps)",
        "(10) If the Class C OC Test or Class C IC Test is not satisfied, application to redeem Class A, B, and C Notes",
        "(11) Payment of interest on Class D Notes (SOFR + 400 bps)",
        "(12) If the Class D OC Test or Class D IC Test is not satisfied, application to redeem Class A, B, C, and D Notes",
        "(13) Payment of interest on Class E Notes (SOFR + 650 bps)",
        "(14) If the Class E OC Test or Class E IC Test is not satisfied, application to redeem Class A, B, C, D, and E Notes",
        "(15) Payment of the Subordinated Collateral Management Fee (25 bps per annum)",
        "(16) Payment of Incentive Collateral Management Fee (20% of residual above 12% IRR threshold)",
        "(17) Remainder to Subordinated Notes as residual distributions",
    ]
    for step in interest_steps:
        pdf.bullet(step)

    pdf.add_page()
    pdf.sub_title("Principal Waterfall")
    pdf.body_text("On each payment date, available principal proceeds shall be applied in the following order of priority:")

    principal_steps = [
        "(1) During the reinvestment period: reinvestment in additional collateral obligations (subject to portfolio constraints)",
        "(2) Payment to cure any failed coverage test (OC or IC) by redeeming the most senior outstanding class",
        "(3) After the reinvestment period: sequential redemption of notes in order of seniority (A-1, A-2, B, C, D, E)",
        "(4) Any remaining principal proceeds to Subordinated Notes",
    ]
    for step in principal_steps:
        pdf.bullet(step)

    pdf.ln(4)
    pdf.sub_title("Post-Acceleration Waterfall")
    pdf.body_text(
        "Following an Event of Default and acceleration, all available proceeds (both interest and principal) "
        "shall be applied sequentially: first to pay Trustee and administrative fees, then to redeem each "
        "class of notes in order of seniority until paid in full, and finally to Subordinated Notes."
    )

    # =========================================================================
    # VII. FEES AND EXPENSES
    # =========================================================================
    pdf.add_page()
    pdf.section_title("VII. FEES AND EXPENSES")

    pdf.sub_title("Collateral Management Fees")
    cols_f = ["Fee Name", "Rate", "Basis", "Description"]
    widths_f = [40, 16, 40, 70]
    aligns_f = ["L", "C", "L", "L"]
    pdf.table_header(cols_f, widths_f)

    fees = [
        ["Senior Mgmt Fee", "15 bps", "per annum on collateral", "Paid quarterly, senior in waterfall"],
        ["Sub Mgmt Fee", "25 bps", "per annum on collateral", "Paid quarterly, junior to notes"],
        ["Incentive Fee", "20.0%", "of residual above hurdle", "Above 12% IRR to equity holders"],
        ["Trustee Fee", "2.0 bps", "per annum on collateral", "Paid to BNY Mellon quarterly"],
        ["Admin Fee", "2.0 bps", "per annum on collateral", "Administration services"],
    ]
    for row in fees:
        pdf.table_row(row, widths_f, aligns_f)

    pdf.ln(6)
    pdf.sub_title("Accounts")
    cols_a = ["Account Name", "Purpose"]
    widths_a = [50, 100]
    aligns_a = ["L", "L"]
    pdf.table_header(cols_a, widths_a)

    accts = [
        ["Payment Account", "Distribution of interest and principal to noteholders"],
        ["Collection Account", "Collection of interest and principal from collateral"],
        ["Principal Collection", "Segregated account for principal proceeds"],
        ["Interest Reserve", "Reserve for interest shortfalls ($2,150,000 initial)"],
        ["Expense Reserve", "Reserve for senior expenses ($250,000 initial)"],
        ["Revolver Funding", "Funding commitments for revolving loans"],
        ["Custodial Account", "Custody of collateral obligations"],
    ]
    for row in accts:
        pdf.table_row(row, widths_a, aligns_a)

    # =========================================================================
    # VIII. KEY DATES
    # =========================================================================
    pdf.add_page()
    pdf.section_title("VIII. KEY DATES")

    pdf.label_value("Original Issue Date (Closing Date):", "March 15, 2024")
    pdf.label_value("Stated Maturity (Legal Final Maturity):", "April 15, 2037")
    pdf.label_value("Non-Call Period End (First Optional Redemption):", "April 15, 2026")
    pdf.label_value("Reinvestment Period End:", "April 15, 2029")
    pdf.label_value("First Payment Date (First Distribution Date):", "July 15, 2024")
    pdf.label_value("Payment Frequency:", "Quarterly")
    pdf.ln(4)

    pdf.body_text(
        "The Stated Maturity Date represents the legal final maturity of all classes of notes. The expected "
        "maturity of the notes is significantly shorter than the stated maturity, as principal proceeds from "
        "prepayments and amortization will be applied to redeem the notes."
    )
    pdf.body_text(
        "The Non-Call Period End Date is the first date on which the Subordinated Noteholders may direct an "
        "optional redemption of all outstanding rated notes. No optional redemption may occur prior to this date."
    )
    pdf.body_text(
        "The Reinvestment Period End Date is the last date on which the Collateral Manager may reinvest "
        "principal proceeds in additional collateral obligations. After this date, principal proceeds must "
        "be applied to redeem notes sequentially."
    )

    # =========================================================================
    # IX. KEY PARTIES
    # =========================================================================
    pdf.add_page()
    pdf.section_title("IX. KEY PARTIES")

    pdf.sub_title("Transaction Parties")
    cols_p = ["Role", "Entity"]
    widths_p = [50, 110]
    aligns_p = ["L", "L"]
    pdf.table_header(cols_p, widths_p)

    parties = [
        ["Issuer", "Elmwood CLO 2024-1, Ltd."],
        ["Co-Issuer", "Elmwood CLO 2024-1, LLC"],
        ["Collateral Manager", "Elmwood Asset Management LLC"],
        ["Trustee", "The Bank of New York Mellon"],
        ["Account Bank", "The Bank of New York Mellon"],
        ["Paying Agent", "The Bank of New York Mellon, London Branch"],
        ["Calculation Agent", "The Bank of New York Mellon"],
        ["Arranger", "Morgan Stanley & Co. LLC"],
        ["Placement Agent", "Morgan Stanley & Co. LLC"],
        ["Legal Counsel (Issuer)", "Cadwalader, Wickersham & Taft LLP"],
        ["Legal Counsel (Arranger)", "Dechert LLP"],
        ["Rating Agencies", "S&P Global Ratings / Fitch Ratings"],
    ]
    for row in parties:
        pdf.table_row(row, widths_p, aligns_p)

    pdf.ln(6)
    pdf.sub_title("Collateral Manager Details")
    pdf.label_value("Name:", "Elmwood Asset Management LLC")
    pdf.label_value("Parent Company:", "Elmwood Capital Group, Inc.")
    pdf.label_value("SEC Registration:", "Registered Investment Adviser (RIA) under the Investment Advisers Act of 1940")
    pdf.label_value("AUM:", "Approximately $8.5 billion (as of December 31, 2023)")
    pdf.label_value("CLO Experience:", "12 CLO transactions managed since 2015")
    pdf.ln(4)

    pdf.sub_title("Replacement Mechanism")
    pdf.body_text(
        "The Collateral Manager may be replaced upon (i) an Event of Default by the Collateral Manager, "
        "(ii) termination by a majority of Subordinated Noteholders following a Key Person Event, or "
        "(iii) voluntary resignation by the Collateral Manager with 90 days' written notice. A replacement "
        "Collateral Manager must be approved by a majority of each class of noteholders and must have "
        "CLO management experience and AUM of at least $3 billion."
    )

    # =========================================================================
    # X. REDEMPTION PROVISIONS
    # =========================================================================
    pdf.add_page()
    pdf.section_title("X. REDEMPTION PROVISIONS")

    pdf.sub_title("Optional Redemption")
    pdf.body_text(
        "On or after the Non-Call Period End Date (April 15, 2026), the Subordinated Noteholders (by a "
        "majority vote) may direct an optional redemption of all outstanding Secured Notes in whole but "
        "not in part, provided that all accrued and unpaid interest, deferred interest, and principal on "
        "all classes of Secured Notes can be paid in full."
    )

    pdf.sub_title("Mandatory Redemption")
    pdf.body_text(
        "A mandatory redemption shall occur if (i) the Collateral Manager is terminated and no replacement "
        "is appointed within 90 days, or (ii) certain tax events occur that would require the Issuer to "
        "withhold taxes on payments to noteholders."
    )

    pdf.sub_title("Special Redemption")
    pdf.body_text(
        "After the end of the Reinvestment Period, if the aggregate principal balance of the portfolio "
        "declines below 30% of the original target par amount, the Trustee shall apply all available "
        "proceeds to redeem the notes sequentially (a 'clean-up call')."
    )

    pdf.sub_title("Tax Redemption")
    pdf.body_text(
        "If a Tax Event occurs requiring gross-up payments, the Issuer may redeem all outstanding notes "
        "at par plus accrued interest."
    )

    pdf.ln(4)
    pdf.sub_title("Events of Default")
    cols_e = ["Event", "Description"]
    widths_e = [40, 120]
    aligns_e = ["L", "L"]
    pdf.table_header(cols_e, widths_e)

    events = [
        ["Payment Default", "Failure to pay interest on Class A/B Notes within 5 business days"],
        ["OC Test Failure", "Class A or Class B OC Test fails for 2 consecutive payment dates"],
        ["Bankruptcy", "Issuer becomes subject to bankruptcy or insolvency proceedings"],
        ["Breach of Covenants", "Material breach of indenture covenants not cured within 30 days"],
        ["Collateral Shortfall", "Portfolio principal balance falls below $80,000,000"],
    ]
    for row in events:
        pdf.table_row(row, widths_e, aligns_e)

    # =========================================================================
    # XI. HEDGING
    # =========================================================================
    pdf.add_page()
    pdf.section_title("XI. HEDGING")

    pdf.label_value("Currency Hedge Required:", "Yes (for non-USD denominated assets)")
    pdf.label_value("Hedge Types:", "Interest rate swaps, cross-currency swaps, forward contracts")
    pdf.label_value("Counterparty Rating Requirement:", "Minimum A2/A by Moody's/S&P")
    pdf.label_value("Replacement Timeline:", "30 days following counterparty downgrade below required rating")
    pdf.label_value("Maximum Currency Hedge %:", "15% of portfolio par (matching non-USD asset limit)")
    pdf.ln(4)

    pdf.body_text(
        "The Issuer may enter into hedging arrangements to mitigate interest rate and currency risk. "
        "All hedge counterparties must satisfy minimum rating requirements. If a counterparty is downgraded "
        "below the required rating, the Issuer must either obtain a replacement counterparty or require "
        "the downgraded counterparty to post collateral within 30 days."
    )

    pdf.body_text(
        "All hedging costs are senior in the waterfall and paid from available interest proceeds before "
        "payment of any management fees or interest on the notes."
    )

    # =========================================================================
    # DISCLAIMER PAGE
    # =========================================================================
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 10, "IMPORTANT NOTICES", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    pdf.set_font("Helvetica", "", 8)
    pdf.multi_cell(0, 4,
        "THIS PRIVATE PLACEMENT MEMORANDUM IS FOR INFORMATIONAL PURPOSES ONLY AND DOES NOT CONSTITUTE "
        "AN OFFER TO SELL OR A SOLICITATION OF AN OFFER TO BUY ANY SECURITIES. THE NOTES HAVE NOT BEEN "
        "AND WILL NOT BE REGISTERED UNDER THE SECURITIES ACT OF 1933, AS AMENDED, AND MAY NOT BE OFFERED "
        "OR SOLD IN THE UNITED STATES EXCEPT PURSUANT TO AN EXEMPTION FROM, OR IN A TRANSACTION NOT "
        "SUBJECT TO, THE REGISTRATION REQUIREMENTS THEREOF.\n\n"
        "THIS IS A SAMPLE DOCUMENT GENERATED FOR TESTING PURPOSES ONLY. ALL NAMES, ENTITIES, FIGURES, "
        "AND DATA CONTAINED HEREIN ARE ENTIRELY FICTITIOUS AND DO NOT REPRESENT ANY REAL TRANSACTION, "
        "ENTITY, OR FINANCIAL INSTRUMENT."
    )

    # Save
    import os
    path = os.path.join(os.path.dirname(__file__), "sample_ppm.pdf")
    pdf.output(path)
    print(f"Generated: {path} ({pdf.page_no()} pages)")


if __name__ == "__main__":
    generate()
