#!/usr/bin/env python3
"""Generate a realistic 200-loan buy list CSV for CLO testing.

Output matches the BuyListItem schema used by the CLO product:
  obligorName, facilityName, sector, moodysRating, spRating,
  spreadBps, referenceRate, price, maturityDate, facilitySize,
  leverage, interestCoverage, isCovLite, averageLifeYears, recoveryRate
"""

import csv
import os
from real_loan_data import build_buy_list

NUM_LOANS = 200


def main():
    items = build_buy_list(NUM_LOANS, seed=99)

    out_path = os.path.join(os.path.dirname(__file__), "sample_buy_list.csv")

    fieldnames = [
        "obligor_name", "facility_name", "sector", "moodys_rating", "sp_rating",
        "spread_bps", "reference_rate", "price", "maturity_date", "facility_size",
        "leverage", "interest_coverage", "cov_lite", "average_life", "recovery_rate",
    ]

    # Map from internal keys to CSV column names
    key_to_col = {
        "obligorName": "obligor_name",
        "facilityName": "facility_name",
        "sector": "sector",
        "moodysRating": "moodys_rating",
        "spRating": "sp_rating",
        "spreadBps": "spread_bps",
        "referenceRate": "reference_rate",
        "price": "price",
        "maturityDate": "maturity_date",
        "facilitySize": "facility_size",
        "leverage": "leverage",
        "interestCoverage": "interest_coverage",
        "isCovLite": "cov_lite",
        "averageLifeYears": "average_life",
        "recoveryRate": "recovery_rate",
    }

    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for item in items:
            row = {}
            for internal_key, col_name in key_to_col.items():
                val = item[internal_key]
                if internal_key == "isCovLite":
                    val = "TRUE" if val else "FALSE"
                row[col_name] = val
            writer.writerow(row)

    print(f"Generated: {out_path}")
    print(f"  Loans: {len(items)}")

    # Summary stats
    ratings = {}
    sectors = set()
    for item in items:
        r = item["moodysRating"]
        ratings[r] = ratings.get(r, 0) + 1
        sectors.add(item["sector"])

    avg_spread = sum(item["spreadBps"] for item in items) / len(items)
    avg_price = sum(item["price"] for item in items) / len(items)
    cov_lite_pct = sum(1 for item in items if item["isCovLite"]) / len(items) * 100

    print(f"  Sectors: {len(sectors)}")
    print(f"  Avg Spread: {avg_spread:.0f} bps")
    print(f"  Avg Price: {avg_price:.2f}")
    print(f"  Cov-Lite: {cov_lite_pct:.1f}%")
    print(f"  Rating distribution:")
    for r in sorted(ratings.keys()):
        print(f"    {r}: {ratings[r]}")


if __name__ == "__main__":
    main()
