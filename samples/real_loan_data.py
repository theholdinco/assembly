#!/usr/bin/env python3
"""Real leveraged loan issuers for CLO sample data generation.

Companies are drawn from the broadly syndicated leveraged loan market
(S&P/LSTA Leveraged Loan Index constituents and comparable issuers).
All data points are representative of typical market terms.
"""

import random
from datetime import date, timedelta

# Moody's 33-industry classification used in CLO compliance
MOODYS_INDUSTRIES = [
    "Aerospace & Defense",
    "Automotive",
    "Banking, Finance, Insurance & Real Estate",
    "Beverage, Food & Tobacco",
    "Broadcasting & Subscription",
    "Buildings & Real Estate",
    "Capital Equipment",
    "Chemicals, Plastics & Rubber",
    "Containers, Packaging & Glass",
    "Diversified/Conglomerate Manufacturing",
    "Diversified/Conglomerate Service",
    "Ecology",
    "Electronics",
    "Finance",
    "Forestry Products",
    "Grocery",
    "Healthcare & Pharmaceuticals",
    "High Tech Industries",
    "Hotel, Gaming & Leisure",
    "Insurance",
    "Leisure, Amusement, Entertainment",
    "Machinery",
    "Mining, Steel, Iron & Non-Precious Metals",
    "Oil & Gas",
    "Personal & Non-Durable Consumer Products",
    "Personal, Food & Miscellaneous Services",
    "Printing & Publishing",
    "Retail Stores",
    "Telecommunications",
    "Textiles & Leather",
    "Transportation: Cargo",
    "Transportation: Consumer",
    "Utilities",
]

# Moody's rating -> WARF factor
WARF_MAP = {
    "Aaa": 1, "Aa1": 10, "Aa2": 20, "Aa3": 40,
    "A1": 70, "A2": 120, "A3": 180,
    "Baa1": 260, "Baa2": 360, "Baa3": 610,
    "Ba1": 940, "Ba2": 1350, "Ba3": 1766,
    "B1": 2220, "B2": 2720, "B3": 3490,
    "Caa1": 4770, "Caa2": 6500, "Caa3": 8070,
    "Ca": 10000, "C": 10000,
}

# SP equivalent for each Moody's rating
MOODYS_TO_SP = {
    "Ba1": "BB+", "Ba2": "BB", "Ba3": "BB-",
    "B1": "B+", "B2": "B", "B3": "B-",
    "Caa1": "CCC+", "Caa2": "CCC", "Caa3": "CCC-",
}

# ═══════════════════════════════════════════════════════════════════════════
# Real leveraged loan issuers — representative of BSL CLO portfolios
# Each tuple: (obligor, facility, industry, moodys, spread_bps, is_cov_lite)
# ═══════════════════════════════════════════════════════════════════════════

_RAW_ISSUERS = [
    # Aerospace & Defense
    ("TransDigm Group Inc", "Term Loan I", "Aerospace & Defense", "B1", 325, True),
    ("Arcline FM Holdings LLC", "Term Loan B", "Aerospace & Defense", "B2", 400, True),
    ("Peraton Corp", "Term Loan B", "Aerospace & Defense", "B2", 375, True),
    ("Amentum Government Services", "Term Loan B", "Aerospace & Defense", "B1", 350, True),
    ("Cobham Advanced Electronic Solutions", "Term Loan", "Aerospace & Defense", "B2", 375, True),
    ("Kaman Aerospace Corp", "Term Loan B", "Aerospace & Defense", "Ba3", 300, True),
    ("Spirit AeroSystems Inc", "Term Loan B", "Aerospace & Defense", "B3", 425, False),
    ("Ducommun Inc", "Term Loan B", "Aerospace & Defense", "Ba3", 300, True),

    # Automotive
    ("Clarios Global LP", "Term Loan B", "Automotive", "B1", 350, True),
    ("Dealer Tire Holdings LLC", "Term Loan B", "Automotive", "B2", 400, True),
    ("Mavis Tire Express Services", "Term Loan B", "Automotive", "B2", 375, True),
    ("Wand NewCo 3 Inc", "Term Loan B", "Automotive", "B3", 400, True),
    ("BBB Industries LLC", "Term Loan B", "Automotive", "B2", 375, True),
    ("Holley Inc", "Term Loan B", "Automotive", "B2", 350, True),

    # Banking, Finance, Insurance
    ("Deerfield Dakota Holding LLC", "Term Loan B", "Banking, Finance, Insurance & Real Estate", "B2", 375, True),
    ("Citadel Securities LP", "Term Loan B", "Banking, Finance, Insurance & Real Estate", "Ba2", 275, True),
    ("Asurion LLC", "Term Loan B-11", "Banking, Finance, Insurance & Real Estate", "B1", 325, True),
    ("Hub International Ltd", "Term Loan B", "Banking, Finance, Insurance & Real Estate", "B2", 375, True),
    ("Acrisure LLC", "Term Loan B", "Banking, Finance, Insurance & Real Estate", "B2", 400, True),
    ("Alliant Holdings Intermediate LLC", "Term Loan B", "Banking, Finance, Insurance & Real Estate", "B2", 350, True),
    ("NFP Corp", "Term Loan B", "Banking, Finance, Insurance & Real Estate", "B3", 325, True),
    ("Ryan Specialty Group LLC", "Term Loan B", "Banking, Finance, Insurance & Real Estate", "Ba3", 300, True),
    ("AmWINS Group Inc", "Term Loan B", "Banking, Finance, Insurance & Real Estate", "Ba3", 275, True),
    ("Truist Insurance Holdings", "Term Loan B", "Banking, Finance, Insurance & Real Estate", "Ba3", 300, True),

    # Beverage, Food & Tobacco
    ("Bellring Brands Inc", "Term Loan B", "Beverage, Food & Tobacco", "Ba3", 275, True),
    ("Hearthside Food Solutions LLC", "Term Loan B", "Beverage, Food & Tobacco", "B3", 425, True),
    ("Shearer's Foods LLC", "Term Loan B", "Beverage, Food & Tobacco", "B2", 375, True),
    ("Froneri International Ltd", "Term Loan B", "Beverage, Food & Tobacco", "B2", 350, True),
    ("Triton Water Holdings Inc", "Term Loan B", "Beverage, Food & Tobacco", "B2", 375, True),
    ("Chobani Global Holdings LLC", "Term Loan B", "Beverage, Food & Tobacco", "B1", 325, True),
    ("Hostess Brands LLC", "Term Loan B", "Beverage, Food & Tobacco", "Ba3", 275, True),
    ("Sovos Brands Inc", "Term Loan B", "Beverage, Food & Tobacco", "B1", 350, True),

    # Broadcasting & Subscription
    ("iHeartCommunications Inc", "Term Loan B", "Broadcasting & Subscription", "B2", 375, False),
    ("Cumulus Media Inc", "Term Loan B", "Broadcasting & Subscription", "B3", 475, False),
    ("Nexstar Media Inc", "Term Loan B", "Broadcasting & Subscription", "Ba3", 275, True),
    ("DIRECTV Financing LLC", "Term Loan", "Broadcasting & Subscription", "B1", 375, True),
    ("McGraw-Hill Education Inc", "Term Loan B", "Broadcasting & Subscription", "B1", 350, True),
    ("Cengage Learning Inc", "Term Loan B", "Broadcasting & Subscription", "B1", 375, True),

    # Buildings & Real Estate
    ("RE/MAX International Inc", "Term Loan B", "Buildings & Real Estate", "Ba3", 300, True),
    ("Cushman & Wakefield US Borrower LLC", "Term Loan B", "Buildings & Real Estate", "Ba3", 325, True),
    ("SRS Distribution Inc", "Term Loan B", "Buildings & Real Estate", "B1", 350, True),
    ("LBM Acquisition LLC", "Term Loan B", "Buildings & Real Estate", "B3", 425, True),
    ("Installed Building Products Inc", "Term Loan B", "Buildings & Real Estate", "Ba3", 275, True),
    ("APi Group DE Inc", "Term Loan B", "Buildings & Real Estate", "Ba3", 275, True),

    # Capital Equipment
    ("Vertical US Newco Inc", "Term Loan B", "Capital Equipment", "B2", 375, True),
    ("Gardner Denver Inc", "Term Loan B", "Capital Equipment", "Ba3", 275, True),
    ("Filtration Group Corp", "Term Loan B", "Capital Equipment", "B2", 350, True),
    ("Chart Industries Inc", "Term Loan B", "Capital Equipment", "Ba3", 300, True),
    ("CPM Holdings Inc", "Term Loan B", "Capital Equipment", "B2", 400, True),

    # Chemicals, Plastics & Rubber
    ("Kraton Polymers LLC", "Term Loan B", "Chemicals, Plastics & Rubber", "B2", 375, True),
    ("Nouryon Finance BV", "Term Loan B", "Chemicals, Plastics & Rubber", "B1", 350, True),
    ("Ineos US Finance LLC", "Term Loan B", "Chemicals, Plastics & Rubber", "Ba3", 300, True),
    ("Starfruit US Holdco LLC", "Term Loan B", "Chemicals, Plastics & Rubber", "B2", 375, True),
    ("Messer Industries GmbH", "Term Loan B", "Chemicals, Plastics & Rubber", "Ba3", 275, True),
    ("Olympus Water US Holding Corp", "Term Loan B", "Chemicals, Plastics & Rubber", "B3", 425, True),
    ("W.R. Grace & Co", "Term Loan B", "Chemicals, Plastics & Rubber", "Ba3", 325, True),

    # Containers, Packaging & Glass
    ("Reynolds Group Holdings Inc", "Term Loan B", "Containers, Packaging & Glass", "B2", 350, True),
    ("Graham Packaging Co Inc", "Term Loan B", "Containers, Packaging & Glass", "B2", 375, True),
    ("Trident TPI Holdings Inc", "Term Loan B", "Containers, Packaging & Glass", "B2", 400, True),
    ("Pactiv Evergreen Group", "Term Loan B", "Containers, Packaging & Glass", "B1", 350, True),
    ("Berlin Packaging LLC", "Term Loan B", "Containers, Packaging & Glass", "B2", 375, True),
    ("ProAmpac PG Borrower LLC", "Term Loan B", "Containers, Packaging & Glass", "B3", 425, True),

    # Diversified/Conglomerate Service
    ("Aramark Services Inc", "Term Loan B", "Diversified/Conglomerate Service", "Ba3", 275, True),
    ("Garda World Security Corp", "Term Loan B", "Diversified/Conglomerate Service", "B2", 400, True),
    ("Allied Universal Holdco LLC", "Term Loan B", "Diversified/Conglomerate Service", "B1", 375, True),
    ("Brink's Company", "Term Loan B", "Diversified/Conglomerate Service", "Ba3", 275, True),
    ("GFL Environmental Inc", "Term Loan B", "Diversified/Conglomerate Service", "Ba3", 275, True),
    ("Clean Harbors Inc", "Term Loan B", "Diversified/Conglomerate Service", "Ba3", 275, True),
    ("Covanta Holding Corp", "Term Loan B", "Diversified/Conglomerate Service", "B1", 325, True),
    ("Stericycle Inc", "Term Loan B", "Diversified/Conglomerate Service", "Ba3", 275, True),

    # Electronics
    ("Coherent Corp", "Term Loan B", "Electronics", "Ba3", 300, True),
    ("Sensata Technologies Inc", "Term Loan B", "Electronics", "Ba3", 275, True),
    ("Amphenol Corp", "Term Loan B", "Electronics", "Ba3", 250, True),
    ("Roper Technologies Inc", "Term Loan B", "Electronics", "Ba3", 250, True),

    # Healthcare & Pharmaceuticals
    ("Bausch Health Companies Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "B3", 525, False),
    ("Endo International PLC", "Term Loan B", "Healthcare & Pharmaceuticals", "Caa1", 575, False),
    ("Athenahealth Group Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "B2", 350, True),
    ("Medline Borrower LP", "Term Loan B", "Healthcare & Pharmaceuticals", "B1", 300, True),
    ("PharMerica Corp", "Term Loan B", "Healthcare & Pharmaceuticals", "B2", 375, True),
    ("Lifescan Global Corp", "Term Loan", "Healthcare & Pharmaceuticals", "B3", 500, False),
    ("Iqvia Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "Ba3", 275, True),
    ("Avantor Funding Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "Ba3", 275, True),
    ("Catalent Pharma Solutions Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "Ba3", 300, True),
    ("Nuvance Health", "Term Loan B", "Healthcare & Pharmaceuticals", "B1", 350, True),
    ("Change Healthcare Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "B1", 350, True),
    ("Surgery Center Holdings Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "B2", 375, True),
    ("Team Health Holdings Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "Caa1", 525, False),
    ("ModivCare Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "B1", 350, True),
    ("Global Medical Response Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "B3", 450, True),
    ("Select Medical Corp", "Term Loan B", "Healthcare & Pharmaceuticals", "Ba3", 300, True),

    # High Tech Industries
    ("McAfee Corp", "Term Loan B", "High Tech Industries", "B2", 375, True),
    ("SolarWinds Holdings Inc", "Term Loan B", "High Tech Industries", "B1", 350, True),
    ("Informatica Inc", "Term Loan B", "High Tech Industries", "Ba3", 275, True),
    ("Epicor Software Corp", "Term Loan B", "High Tech Industries", "B2", 375, True),
    ("Proofpoint Inc", "Term Loan B", "High Tech Industries", "B1", 350, True),
    ("Finastra USA Inc", "Term Loan B", "High Tech Industries", "B3", 450, True),
    ("Barracuda Networks Inc", "Term Loan B", "High Tech Industries", "B3", 450, True),
    ("Sophos Group Ltd", "Term Loan B", "High Tech Industries", "B2", 375, True),
    ("GoTo Group Inc", "Term Loan B", "High Tech Industries", "B3", 475, False),
    ("Ivanti Software Inc", "Term Loan B", "High Tech Industries", "B3", 425, True),
    ("Magenta Buyer LLC", "Term Loan B", "High Tech Industries", "Caa1", 550, False),
    ("Hyland Software Inc", "Term Loan B", "High Tech Industries", "B2", 375, True),
    ("BMC Software Inc", "Term Loan B", "High Tech Industries", "B1", 350, True),
    ("Veritas US Inc", "Term Loan B", "High Tech Industries", "B3", 500, False),
    ("Planview Parent Inc", "Term Loan B", "High Tech Industries", "B3", 400, True),
    ("UKG Inc", "Term Loan B", "High Tech Industries", "B1", 325, True),
    ("Datto Inc", "Term Loan B", "High Tech Industries", "B1", 350, True),
    ("ConnectWise LLC", "Term Loan B", "High Tech Industries", "B2", 375, True),
    ("DCert Buyer Inc", "Term Loan B", "High Tech Industries", "B2", 400, True),
    ("Cloudera Inc", "Term Loan B", "High Tech Industries", "B1", 375, True),
    ("Ping Identity Holding Corp", "Term Loan B", "High Tech Industries", "B2", 375, True),

    # Hotel, Gaming & Leisure
    ("Caesars Entertainment Inc", "Term Loan B", "Hotel, Gaming & Leisure", "B1", 325, True),
    ("Station Casinos LLC", "Term Loan B", "Hotel, Gaming & Leisure", "Ba3", 275, True),
    ("Hilton Grand Vacations Borrower LLC", "Term Loan B", "Hotel, Gaming & Leisure", "Ba3", 300, True),
    ("Carnival Corp", "Term Loan B", "Hotel, Gaming & Leisure", "B1", 325, True),
    ("SeaWorld Parks & Entertainment", "Term Loan B", "Hotel, Gaming & Leisure", "Ba3", 300, True),
    ("Great Canadian Gaming Corp", "Term Loan B", "Hotel, Gaming & Leisure", "B2", 375, True),
    ("Playa Hotels & Resorts NV", "Term Loan B", "Hotel, Gaming & Leisure", "B2", 375, True),
    ("Cedar Fair LP", "Term Loan B", "Hotel, Gaming & Leisure", "Ba3", 275, True),

    # Leisure, Amusement, Entertainment
    ("UFC Holdings LLC", "Term Loan B", "Leisure, Amusement, Entertainment", "Ba3", 300, True),
    ("Fitness International LLC", "Term Loan B", "Leisure, Amusement, Entertainment", "B2", 375, False),
    ("AMC Entertainment Holdings Inc", "Term Loan B", "Leisure, Amusement, Entertainment", "Caa1", 550, False),
    ("Peloton Interactive Inc", "Term Loan B", "Leisure, Amusement, Entertainment", "B3", 475, True),
    ("Cinemark Holdings Inc", "Term Loan B", "Leisure, Amusement, Entertainment", "B1", 325, True),
    ("Topgolf Callaway Brands Corp", "Term Loan B", "Leisure, Amusement, Entertainment", "Ba3", 325, True),

    # Machinery
    ("Welbilt Inc", "Term Loan B", "Machinery", "Ba3", 275, True),
    ("Haynes International Inc", "Term Loan B", "Machinery", "Ba3", 325, True),
    ("Gates Global LLC", "Term Loan B", "Machinery", "B1", 325, True),
    ("Jason Industries Inc", "Term Loan B", "Machinery", "B3", 450, True),

    # Mining, Steel, Iron
    ("Arcosa Inc", "Term Loan B", "Mining, Steel, Iron & Non-Precious Metals", "Ba3", 275, True),
    ("SunCoke Energy Inc", "Term Loan B", "Mining, Steel, Iron & Non-Precious Metals", "B1", 400, True),
    ("Novelis Inc", "Term Loan B", "Mining, Steel, Iron & Non-Precious Metals", "Ba3", 275, True),

    # Oil & Gas
    ("Delek US Holdings Inc", "Term Loan B", "Oil & Gas", "B1", 375, True),
    ("Citgo Petroleum Corp", "Term Loan B", "Oil & Gas", "Ba3", 325, True),
    ("Endeavor Energy Resources LP", "Term Loan B", "Oil & Gas", "Ba3", 275, True),
    ("Prairie ECI Acquiror LP", "Term Loan B", "Oil & Gas", "B2", 400, True),
    ("BJ Services LLC", "Term Loan B", "Oil & Gas", "B3", 475, False),

    # Personal & Non-Durable Consumer Products
    ("Revlon Consumer Products Corp", "Term Loan B", "Personal & Non-Durable Consumer Products", "Caa1", 575, False),
    ("Prestige Brands Holdings Inc", "Term Loan B", "Personal & Non-Durable Consumer Products", "Ba3", 275, True),
    ("Edgewell Personal Care Co", "Term Loan B", "Personal & Non-Durable Consumer Products", "Ba3", 275, True),
    ("Reynolds Consumer Products", "Term Loan B", "Personal & Non-Durable Consumer Products", "B1", 325, True),
    ("Spectrum Brands Inc", "Term Loan B", "Personal & Non-Durable Consumer Products", "B1", 350, True),
    ("Energizer Holdings Inc", "Term Loan B", "Personal & Non-Durable Consumer Products", "B1", 325, True),

    # Personal, Food & Miscellaneous Services
    ("Aramark Uniform & Career Apparel", "Term Loan B", "Personal, Food & Miscellaneous Services", "Ba3", 275, True),
    ("ServiceMaster Co LLC", "Term Loan B", "Personal, Food & Miscellaneous Services", "B1", 325, True),
    ("Advantage Solutions Inc", "Term Loan B", "Personal, Food & Miscellaneous Services", "B2", 375, True),
    ("TruGreen LP", "Term Loan B", "Personal, Food & Miscellaneous Services", "B2", 375, True),
    ("Wand NewCo 3 Inc (Weber)", "Term Loan", "Personal, Food & Miscellaneous Services", "B3", 425, True),

    # Printing & Publishing
    ("Ancestry.com Operations Inc", "Term Loan B", "Printing & Publishing", "B2", 375, True),
    ("Dotdash Meredith Inc", "Term Loan B", "Printing & Publishing", "B1", 350, True),
    ("R.R. Donnelley & Sons Co", "Term Loan B", "Printing & Publishing", "B2", 425, False),

    # Retail Stores
    ("PetSmart LLC", "Term Loan B", "Retail Stores", "B1", 375, True),
    ("Michaels Companies Inc", "Term Loan B", "Retail Stores", "B3", 425, True),
    ("Petco Health and Wellness Co Inc", "Term Loan B", "Retail Stores", "B2", 400, True),
    ("Burlington Coat Factory Warehouse", "Term Loan B", "Retail Stores", "Ba3", 275, True),
    ("Dollar Tree Inc", "Term Loan B", "Retail Stores", "Ba3", 275, True),
    ("Leslie's Poolmart Inc", "Term Loan B", "Retail Stores", "B2", 375, True),
    ("At Home Group Inc", "Term Loan B", "Retail Stores", "B3", 450, False),
    ("Staples Inc", "Term Loan B", "Retail Stores", "B2", 425, True),
    ("Harbor Freight Tools USA Inc", "Term Loan B", "Retail Stores", "B1", 325, True),

    # Telecommunications
    ("Zayo Group Holdings Inc", "Term Loan B", "Telecommunications", "B2", 375, True),
    ("Windstream Services LLC", "Term Loan B", "Telecommunications", "B2", 425, False),
    ("Lumen Technologies Inc", "Term Loan B", "Telecommunications", "B1", 375, True),
    ("Consolidated Communications Inc", "Term Loan B", "Telecommunications", "B2", 375, True),
    ("Cablevision Lightpath Inc", "Term Loan B", "Telecommunications", "B2", 400, True),
    ("Altice France SA", "Term Loan B", "Telecommunications", "B3", 500, True),
    ("CommScope Inc", "Term Loan B", "Telecommunications", "B2", 350, True),
    ("GTT Communications Inc", "Term Loan B", "Telecommunications", "Caa1", 525, False),
    ("Frontier Communications Corp", "Term Loan B", "Telecommunications", "B1", 375, True),
    ("Uniti Group LP", "Term Loan B", "Telecommunications", "B2", 400, True),

    # Transportation: Cargo
    ("XPO Logistics Inc", "Term Loan B", "Transportation: Cargo", "Ba3", 275, True),
    ("Ryder System Inc", "Term Loan B", "Transportation: Cargo", "Ba3", 250, True),
    ("Kenan Advantage Group Inc", "Term Loan B", "Transportation: Cargo", "B2", 400, True),
    ("Pilot Travel Centers LLC", "Term Loan B", "Transportation: Cargo", "Ba3", 275, True),
    ("Echo Global Logistics Inc", "Term Loan B", "Transportation: Cargo", "B1", 325, True),

    # Transportation: Consumer
    ("American Airlines Inc", "Term Loan B", "Transportation: Consumer", "B1", 350, True),
    ("United Airlines Inc", "Term Loan B", "Transportation: Consumer", "Ba3", 300, True),
    ("Delta Air Lines Inc", "Term Loan B", "Transportation: Consumer", "Ba3", 275, True),

    # Utilities
    ("Calpine Corp", "Term Loan B", "Utilities", "B1", 325, True),
    ("Vistra Operations Co LLC", "Term Loan B", "Utilities", "Ba3", 275, True),
    ("Talen Energy Supply LLC", "Term Loan B", "Utilities", "B1", 375, True),
    ("NRG Energy Inc", "Term Loan B", "Utilities", "Ba3", 275, True),
    ("PG&E Corp", "Term Loan B", "Utilities", "Ba3", 300, True),

    # Additional issuers to reach 250+
    ("Solera Holdings Inc", "Term Loan B", "High Tech Industries", "B2", 400, True),
    ("SS&C Technologies Inc", "Term Loan B", "High Tech Industries", "Ba3", 275, True),
    ("Infor Inc", "Term Loan B", "High Tech Industries", "B1", 350, True),
    ("Genesys Telecommunications Labs", "Term Loan B", "High Tech Industries", "B2", 375, True),
    ("Greeneden US Holdings II LLC", "Term Loan B", "High Tech Industries", "B2", 400, True),
    ("Playtika Holding Corp", "Term Loan B", "High Tech Industries", "B1", 325, True),
    ("MeridianLink Inc", "Term Loan B", "High Tech Industries", "B1", 350, True),
    ("Open Text Corp", "Term Loan B", "High Tech Industries", "Ba3", 275, True),
    ("Rocket Software Inc", "Term Loan B", "High Tech Industries", "B2", 425, True),
    ("Project Alpha Intermediate Holding", "Term Loan B", "High Tech Industries", "B2", 375, True),

    ("Rite Aid Corp", "Term Loan B", "Retail Stores", "Caa1", 550, False),
    ("Petsmart Inc", "Second Lien TL", "Retail Stores", "Caa1", 575, False),
    ("Jo-Ann Stores Holdings Inc", "Term Loan B", "Retail Stores", "B3", 475, False),
    ("Agiliti Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "B1", 325, True),
    ("Charlotte Tilbury Holdings Ltd", "Term Loan B", "Personal & Non-Durable Consumer Products", "B2", 375, True),
    ("Belron Finance US LLC", "Term Loan B", "Automotive", "Ba3", 275, True),
    ("Driven Brands Holdings Inc", "Term Loan B", "Automotive", "B1", 350, True),
    ("TricorBraun Holdings Inc", "Term Loan B", "Containers, Packaging & Glass", "B2", 400, True),
    ("Pregis TopCo LLC", "Term Loan B", "Containers, Packaging & Glass", "B2", 375, True),
    ("Summit Materials LLC", "Term Loan B", "Mining, Steel, Iron & Non-Precious Metals", "Ba3", 275, True),
    ("U.S. Silica Holdings Inc", "Term Loan B", "Mining, Steel, Iron & Non-Precious Metals", "B1", 375, True),
    ("EnPro Industries Inc", "Term Loan B", "Capital Equipment", "Ba3", 275, True),
    ("Rexnord Corp", "Term Loan B", "Capital Equipment", "Ba3", 275, True),
    ("AI Aqua Merger Sub Inc", "Term Loan B", "Diversified/Conglomerate Service", "B2", 400, True),
    ("Sedgwick Claims Management Services", "Term Loan B", "Banking, Finance, Insurance & Real Estate", "B2", 375, True),
    ("USI Insurance Services LLC", "Term Loan B", "Banking, Finance, Insurance & Real Estate", "B2", 375, True),
    ("AssuredPartners Inc", "Term Loan B", "Banking, Finance, Insurance & Real Estate", "B3", 425, True),
    ("OneMain Finance Corp", "Term Loan B", "Banking, Finance, Insurance & Real Estate", "Ba3", 275, True),
    ("Aretec Group Inc", "Term Loan B", "Banking, Finance, Insurance & Real Estate", "B2", 375, True),
    ("Jane Street Group LLC", "Term Loan B", "Banking, Finance, Insurance & Real Estate", "Ba3", 275, True),
    ("Apex Group Treasury LLC", "Term Loan B", "Banking, Finance, Insurance & Real Estate", "B2", 350, True),
    ("Applied Systems Inc", "Term Loan B", "High Tech Industries", "B2", 350, True),
    ("CCC Intelligent Solutions Inc", "Term Loan B", "High Tech Industries", "Ba3", 300, True),
    ("Polaris Newco LLC", "Term Loan B", "High Tech Industries", "B2", 400, True),
    ("RealPage Inc", "Term Loan B", "High Tech Industries", "B1", 350, True),
    ("Cornerstone OnDemand Inc", "Term Loan B", "High Tech Industries", "B1", 375, True),
    ("Gainwell Acquisition Corp", "Term Loan B", "Healthcare & Pharmaceuticals", "B3", 450, True),
    ("Parexel International Corp", "Term Loan B", "Healthcare & Pharmaceuticals", "B1", 350, True),
    ("PRA Health Sciences Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "Ba3", 300, True),
    ("Kindred Healthcare LLC", "Term Loan B", "Healthcare & Pharmaceuticals", "B2", 400, True),
    ("LifePoint Health Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "B1", 375, True),
    ("RegionalCare Hospital Partners", "Term Loan B", "Healthcare & Pharmaceuticals", "B2", 425, True),
    ("Gentiva Health Services Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "B1", 350, True),
    ("Envision Healthcare Corp", "Term Loan B", "Healthcare & Pharmaceuticals", "Caa1", 550, False),
    ("DaVita Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "Ba3", 275, True),
    ("Phoenix Guarantor Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "B2", 375, True),

    # Additional to reach 250+
    ("Mileage Plus Holdings LLC", "Term Loan B", "Transportation: Consumer", "Ba3", 325, True),
    ("Hertz Corp", "Term Loan B", "Transportation: Consumer", "B1", 375, True),
    ("National Mentor Holdings Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "B2", 400, True),
    ("Perspecta Inc", "Term Loan B", "Aerospace & Defense", "Ba3", 275, True),
    ("Dun & Bradstreet Corp", "Term Loan B", "Diversified/Conglomerate Service", "Ba3", 300, True),
    ("Nielsen Finance LLC", "Term Loan B", "Diversified/Conglomerate Service", "Ba3", 300, True),
    ("CSC Holdings LLC", "Term Loan B", "Telecommunications", "Ba3", 325, True),
    ("WideOpenWest Finance LLC", "Term Loan B", "Telecommunications", "B2", 400, True),
    ("Virgin Media Bristol LLC", "Term Loan B", "Telecommunications", "B1", 350, True),
    ("Numericable Group SA", "Term Loan B", "Telecommunications", "B1", 375, True),
    ("LogMeIn Inc", "Term Loan B", "High Tech Industries", "B2", 400, True),
    ("Blackhawk Network Holdings Inc", "Term Loan B", "High Tech Industries", "B1", 350, True),
    ("Camelot Finance SA", "Term Loan B", "High Tech Industries", "B2", 375, True),
    ("Quest Software US Holdings Inc", "Term Loan B", "High Tech Industries", "B3", 450, True),
    ("Blue Yonder Group Inc", "Term Loan B", "High Tech Industries", "B2", 400, True),
    ("Apttus Corp", "Term Loan B", "High Tech Industries", "B3", 425, True),
    ("Kronos Acquisition Holdings Inc", "Term Loan B", "Chemicals, Plastics & Rubber", "B3", 425, True),
    ("Univar Solutions Inc", "Term Loan B", "Chemicals, Plastics & Rubber", "Ba3", 275, True),
    ("Olin Corp", "Term Loan B", "Chemicals, Plastics & Rubber", "Ba3", 300, True),
    ("Quorum Health Corp", "Term Loan B", "Healthcare & Pharmaceuticals", "B3", 475, False),
    ("Press Ganey Holdings Inc", "Term Loan B", "Healthcare & Pharmaceuticals", "B2", 375, True),
]

# Ensure we have enough issuers
assert len(_RAW_ISSUERS) >= 250, f"Need 250+ issuers, have {len(_RAW_ISSUERS)}"


def _generate_isin(index: int, country: str = "US") -> str:
    """Generate a plausible ISIN. US loans get US prefix, others get XS."""
    prefix = "US" if country == "US" else "XS"
    num_part = f"{40000 + index * 37:010d}"
    # Simple check digit
    check = (index * 7 + 3) % 10
    return f"{prefix}{num_part}{check}"


def _generate_maturity(seed: int) -> str:
    """Generate a maturity date between 2027 and 2032."""
    random.seed(seed)
    base = date(2027, 1, 15)
    offset = random.randint(0, 365 * 5)
    mat = base + timedelta(days=offset)
    # Round to 15th or last day of month
    if mat.day <= 15:
        mat = mat.replace(day=15)
    else:
        # Last day
        import calendar
        mat = mat.replace(day=calendar.monthrange(mat.year, mat.month)[1])
    return mat.strftime("%m/%d/%Y")


def _generate_price(rating: str, spread: int, seed: int) -> float:
    """Generate a market price based on credit quality."""
    random.seed(seed)
    base_prices = {
        "Ba1": 100.75, "Ba2": 100.50, "Ba3": 100.25,
        "B1": 99.75, "B2": 99.00, "B3": 97.50,
        "Caa1": 94.00, "Caa2": 88.00, "Caa3": 80.00,
    }
    base = base_prices.get(rating, 99.00)
    jitter = random.uniform(-1.5, 1.5)
    return round(max(75.0, min(102.0, base + jitter)), 2)


def _generate_recovery(rating: str, is_second_lien: bool, seed: int) -> float:
    """Generate a Moody's recovery rate estimate."""
    random.seed(seed)
    if is_second_lien:
        return round(random.uniform(20.0, 35.0), 1)
    base = {"Ba1": 62, "Ba2": 60, "Ba3": 58, "B1": 55, "B2": 50, "B3": 45,
            "Caa1": 38, "Caa2": 30, "Caa3": 22}.get(rating, 48)
    return round(base + random.uniform(-5.0, 5.0), 1)


def _generate_par(total_target: int, count: int, seed: int) -> list[int]:
    """Generate par amounts that sum to target. Uses Dirichlet-like distribution."""
    random.seed(seed)
    # Generate random weights with some concentration
    weights = [random.paretovariate(1.5) for _ in range(count)]
    total_w = sum(weights)
    # Scale to target, round to nearest 250k
    pars = []
    running = 0
    for i, w in enumerate(weights):
        if i == count - 1:
            par = total_target - running
        else:
            par = round(w / total_w * total_target / 250_000) * 250_000
            par = max(500_000, min(8_000_000, par))
        pars.append(par)
        running += par
    # Adjust last to hit target exactly
    diff = total_target - sum(pars)
    pars[-1] += diff
    return pars


def build_holdings(count: int, total_par: int, seed: int = 42) -> list[dict]:
    """Build a list of realistic holdings from real issuers.

    Args:
        count: number of holdings (e.g. 120 for compliance report)
        total_par: target total par amount
        seed: random seed for reproducibility
    """
    random.seed(seed)
    selected = random.sample(_RAW_ISSUERS, count)
    pars = _generate_par(total_par, count, seed + 1)

    holdings = []
    for i, ((obligor, facility, industry, moodys, spread, cov_lite), par) in enumerate(
        zip(selected, pars)
    ):
        is_second_lien = "Second Lien" in facility
        is_fixed = random.random() < 0.04  # ~4% fixed rate
        is_defaulted = moodys in ("Caa2", "Caa3") and random.random() < 0.3
        sp = MOODYS_TO_SP.get(moodys, "B")
        country = "DE" if "GmbH" in obligor or "BV" in obligor or "AG" in obligor else "US"
        if country == "DE" and random.random() < 0.3:
            country = random.choice(["GB", "FR", "NL"])
        currency = "EUR" if country in ("DE", "FR", "NL") else "USD"

        h = {
            "obligor": obligor,
            "facility": facility,
            "isin": _generate_isin(i, country),
            "type": "Second Lien" if is_second_lien else "Senior Secured",
            "currency": currency,
            "country": country,
            "industry": industry.split(",")[0].strip() if "," in industry else industry,
            "moodys_ind": industry,
            "cov_lite": cov_lite and not is_second_lien,
            "fixed": is_fixed,
            "defaulted": is_defaulted,
            "second_lien": is_second_lien,
            "maturity": _generate_maturity(seed + i),
            "par": par,
            "price": _generate_price(moodys, spread, seed + i + 1000),
            "spread_bps": None if is_fixed else spread,
            "moodys": moodys,
            "sp": sp,
            "recovery": _generate_recovery(moodys, is_second_lien, seed + i + 2000),
        }
        holdings.append(h)

    return holdings


def build_buy_list(count: int, seed: int = 99) -> list[dict]:
    """Build a buy list of available loans in the market.

    Returns dicts matching the BuyListItem schema fields.
    """
    random.seed(seed)
    selected = random.sample(_RAW_ISSUERS, count)

    items = []
    for i, (obligor, facility, industry, moodys, spread, cov_lite) in enumerate(selected):
        random.seed(seed + i)
        sp = MOODYS_TO_SP.get(moodys, "B")
        is_second_lien = "Second Lien" in facility
        price = _generate_price(moodys, spread, seed + i + 3000)
        recovery = _generate_recovery(moodys, is_second_lien, seed + i + 4000)

        # Generate realistic facility size ($100M - $3B)
        size_tier = random.choice([250, 350, 500, 750, 1000, 1500, 2000])
        facility_size = size_tier * 1_000_000 + random.randint(-50, 50) * 1_000_000
        facility_size = max(100_000_000, facility_size)

        # Leverage based on rating
        base_leverage = {"Ba1": 4.0, "Ba2": 4.5, "Ba3": 5.0, "B1": 5.5, "B2": 6.0,
                         "B3": 6.5, "Caa1": 7.5, "Caa2": 8.5}.get(moodys, 6.0)
        leverage = round(base_leverage + random.uniform(-0.5, 0.5), 1)

        # Interest coverage inverse of leverage
        ic = round(random.uniform(1.5, 3.5) if moodys.startswith("B") else random.uniform(1.0, 2.0), 1)

        # Average life
        avg_life = round(random.uniform(3.0, 6.5), 1)

        mat = _generate_maturity(seed + i + 5000)
        # Convert MM/DD/YYYY to YYYY-MM-DD for buy list
        parts = mat.split("/")
        mat_iso = f"{parts[2]}-{parts[0]}-{parts[1]}"

        sector = industry.split(",")[0].strip() if "," in industry else industry

        items.append({
            "obligorName": obligor,
            "facilityName": facility,
            "sector": sector,
            "moodysRating": moodys,
            "spRating": sp,
            "spreadBps": spread,
            "referenceRate": "SOFR",
            "price": price,
            "maturityDate": mat_iso,
            "facilitySize": facility_size,
            "leverage": leverage,
            "interestCoverage": ic,
            "isCovLite": cov_lite and not is_second_lien,
            "averageLifeYears": avg_life,
            "recoveryRate": recovery,
            "notes": None,
        })

    return items
