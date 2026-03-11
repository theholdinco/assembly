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
        "obligorName", "facilityName", "sector", "moodysRating", "spRating",
        "spreadBps", "referenceRate", "price", "maturityDate", "facilitySize",
        "leverage", "interestCoverage", "isCovLite", "averageLifeYears", "recoveryRate",
    ]

    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for item in items:
            row = {k: item[k] for k in fieldnames}
            # Format booleans as TRUE/FALSE for CSV clarity
            row["isCovLite"] = "TRUE" if row["isCovLite"] else "FALSE"
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
