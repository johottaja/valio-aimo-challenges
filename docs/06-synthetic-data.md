# Synthetic data exploration

Source: Valio Aimo Junction 2026 challenge portal, downloaded during this ideation session. The portal describes the data as synthetic, incomplete and for this challenge only. The following counts describe the downloaded snapshot, not Aimo's real production catalog. [Open the visual overview](../synthetic-data-overview.svg).

## Files and coverage

- Product JSON: **17,546** records, with **648** distinct values of `vendorName` in this snapshot. The schema says category names are not included; product unit codes may require interpretation; product data quality varies.
- Delivery reliability CSV: **4,425** product IDs match the catalog (25.2%). The portal describes this as historical delivered quantities versus ordered quantities, from 0 to 1. Of these rows, 150 are below 0.80; 141 are 0.80–<0.90; 273 are 0.90–<0.95; 1,371 are 0.95–<1.00; and 2,490 equal 1.00. This does not describe current availability or future delivery guarantees.
- Carbon CSV: **11,033** matching product IDs (62.9%). Values represent average kg CO₂-equivalent per kg for a product group, not a measurement for an individual SKU. The dataset median is 2.11 kg CO₂-eq/kg among available rows; this is not a representative average purchase footprint.
- **7,205** product records (41.1%) have a non-empty classification group named `allergen`. Presence alone does not establish complete coverage of allergens or safety; absence is not proof of a product's safety. `nonAllergen` is a separate group and cannot be inferred from absence.
- **189** product records contain a non-empty `substitutions` field. Its presence is not proof that a substitute satisfies a customer's needs.

Country-of-origin field counts in this snapshot: FI 7,849; DE 1,029; IT 977; SE 874; CN 741; NL 659; FR 599. These are stated fields, not independent verification of origin.

## Design implications

Use stable product IDs to join files. Keep missing attributes explicitly unknown. Use structured evidence for strict requirements, and ask for clarification or review when needed. Convert pack size and units only with reliable data; lot-size rules must be respected. Category codes lack category names in the data. Reliability is historical and only covers a minority of products. Avoid ranking missing values as zero or assuming a perfect result. Carbon estimates need clear units and group-level caveats.

## Data and credential handling

The source datasets were downloaded locally and are not included here. Check the organizer's terms before redistribution; the schema explicitly limits use to the event. Access the challenge portal and API with organizer-provided credentials; do not store passwords or API keys in the repository. The portal documents mock pricing and availability APIs. Confirm their exact behavior and whether any order endpoint exists before implementation.
