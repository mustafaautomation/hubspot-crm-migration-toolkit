# Northline East → HubSpot

> Portfolio demo, not client work. Records are synthetic. Domains use the reserved .example TLD. No real personal data.

- Mode: `live`
- Source: `salesforce`
- Target: `in-memory HubSpot API (same client as a developer sandbox)`
- Run: `f0309168-cdcd-4d2a-b7c7-b56d6fb7c2e5`
- Started: 2026-11-25T08:20:16.442Z
- Duration: 56 ms
- Mutating API calls: 19
- Command: `hubspot-migrate run --config mappings/salesforce.yaml --input samples/salesforce --live`

## Totals

| Object | Source | Valid | Invalid | Duplicates | Created | Updated | Skipped | Failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| companies | 28 | 26 | 2 | 1 | 25 | 0 | 1 | 2 |
| contacts | 37 | 34 | 3 | 1 | 33 | 0 | 1 | 3 |
| deals | 42 | 40 | 2 | 1 | 39 | 0 | 1 | 2 |

## Associations

| Link | Planned | Created | Skipped | Failed |
| --- | ---: | ---: | ---: | ---: |
| contact → company | 33 | 33 | 0 | 0 |
| deal → company | 39 | 38 | 1 | 0 |
| deal → contact | 39 | 39 | 0 | 0 |

## Reconciliation

Read-back matched the records this run intended to land.

| Object | Expected | Read back | Missing |
| --- | ---: | ---: | --- |
| companies | 25 | 25 | — |
| contacts | 33 | 33 | — |
| deals | 39 | 39 | — |

| Link | Expected | Verified | Missing |
| --- | ---: | ---: | --- |
| contact → company | 33 | 33 | — |
| deal → company | 38 | 38 | — |
| deal → contact | 39 | 39 | — |

## Pipelines

### Sales → Northline Sales (`1007`)

| Source stage | HubSpot stage | Probability | Stage id |
| --- | --- | ---: | --- |
| New Lead | New Lead | 0.1 | 1008 |
| Qualified | Qualified | 0.2 | 1009 |
| Discovery | Discovery | 0.4 | 1010 |
| Proposal | Proposal | 0.6 | 1011 |
| Negotiation | Negotiation | 0.8 | 1012 |
| Closed Won | Closed Won | 1.0 | 1013 |
| Closed Lost | Closed Lost | 0.0 | 1014 |

### Renewals → Northline Renewals (`1015`)

| Source stage | HubSpot stage | Probability | Stage id |
| --- | --- | ---: | --- |
| Identified | Identified | 0.2 | 1016 |
| Quoted | Quoted | 0.5 | 1017 |
| Negotiation | Negotiation | 0.8 | 1018 |
| Renewed | Renewed | 1.0 | 1019 |
| Churned | Churned | 0.0 | 1020 |

## Validation errors

| Object | Row | Source id | Field | Message |
| --- | ---: | --- | --- | --- |
| companies | 27 | 001NS000000ABAD | industry | invalid value "Astrology" |
| companies | 28 | 001NS000000ANON | name | required value is missing |
| contacts | 34 | 003NS000000CBAD | email | invalid email "not-an-email" |
| contacts | 35 | 003NS000000CNOL | lastname | required value is missing |
| contacts | 37 | 003NS000000CEMP | firstname | required value is missing |
| contacts | 37 | 003NS000000CEMP | email | required value is missing |
| deals | 39 | 006NS000000OBAD | dealstage | unmapped stage "Verbal Yes" for pipeline "Sales" |
| deals | 41 | 006NS000000ODAT | closedate | invalid date "yesterday" |

## Warnings

| Object | Row | Source id | Field | Message |
| --- | ---: | --- | --- | --- |
| companies | 29 | 001NS000000ADOM | domain | invalid domain "not a domain" |
| companies | 29 | 001NS000000ADOM | phone | invalid phone "call the office" |
| companies | 29 | 001NS000000ADOM | hubspot_owner_id | no HubSpot owner matches "Former Rep" |
| contacts | 37 | 003NS000000CEMP | phone | invalid phone "555-0100" |
| contacts | 38 | 003NS000000CPHN | phone | invalid phone "call the front desk" |
| contacts | 38 | 003NS000000CPHN | hubspot_owner_id | no HubSpot owner matches "Former Rep" |
| deals | 41 | 006NS000000ODAT | amount | invalid number "TBD" |

## Actions

### companies

| Row | Source id | Action | Record | Reason |
| ---: | --- | --- | --- | --- |
| 2 | 001NS000000A001 | create | Northwind Robotics |  |
| 3 | 001NS000000A002 | create | Cedar & Pine Studio |  |
| 4 | 001NS000000A003 | create | Brightpath Logistics |  |
| 5 | 001NS000000A004 | create | Harborline Clinics |  |
| 6 | 001NS000000A005 | create | Quay Street Capital |  |
| 7 | 001NS000000A006 | create | Lumen Field Analytics |  |
| 8 | 001NS000000A007 | create | Copperline Manufacturing |  |
| 9 | 001NS000000A008 | create | Kindred Learning |  |
| 10 | 001NS000000A009 | create | Sable Route Freight |  |
| 11 | 001NS000000A010 | create | Marlowe Legal Ops |  |
| 12 | 001NS000000A011 | create | Finch & Howe Advisors |  |
| 13 | 001NS000000A012 | create | Arclight Media |  |
| 14 | 001NS000000A013 | create | Plover Health |  |
| 15 | 001NS000000A014 | create | Redcedar Insurance |  |
| 16 | 001NS000000A015 | create | Paperplane HR |  |
| 17 | 001NS000000A016 | create | Southshore Clinics |  |
| 18 | 001NS000000A017 | create | Oakmont Schools |  |
| 19 | 001NS000000A018 | create | Blueharbor Mutual |  |
| 20 | 001NS000000A019 | create | Nimbus Retail Cloud |  |
| 21 | 001NS000000A020 | create | Westferry Consulting |  |
| 22 | 001NS000000A021 | create | Larkspur Devices |  |
| 23 | 001NS000000A022 | create | Ironwood Components |  |
| 24 | 001NS000000A023 | create | Summit Ledger |  |
| 25 | 001NS000000A024 | create | Lantern Freight |  |
| 26 | 001NS000000ADUP | skip | Northwind Robotics (stale import) | duplicate domain in source; kept 001NS000000A001 |
| 27 | 001NS000000ABAD | fail | Astrology Insights Desk | invalid value "Astrology" |
| 28 | 001NS000000ANON | fail | 001NS000000ANON | required value is missing |
| 29 | 001NS000000ADOM | create | Broken Website Co |  |

### contacts

| Row | Source id | Action | Record | Reason |
| ---: | --- | --- | --- | --- |
| 2 | 003NS000000C001 | create | Amina Shah |  |
| 3 | 003NS000000C002 | create | Jules Nazir |  |
| 4 | 003NS000000C003 | create | Beatrice Cole |  |
| 5 | 003NS000000C004 | create | Chris Dalton |  |
| 6 | 003NS000000C005 | create | Diane Okada |  |
| 7 | 003NS000000C006 | create | Maya Moreau |  |
| 8 | 003NS000000C007 | create | Evan Brooks |  |
| 9 | 003NS000000C008 | create | Farah Nazir |  |
| 10 | 003NS000000C009 | create | Gabriel Soto |  |
| 11 | 003NS000000C010 | create | Quentin Berg |  |
| 12 | 003NS000000C011 | create | Helen Park |  |
| 13 | 003NS000000C012 | create | Ivan Moreau |  |
| 14 | 003NS000000C013 | create | Jules Carter |  |
| 15 | 003NS000000C014 | create | Tessa Raman |  |
| 16 | 003NS000000C015 | create | Keiko Mori |  |
| 17 | 003NS000000C016 | create | Leo Berg |  |
| 18 | 003NS000000C017 | create | Maya Srinivasan |  |
| 19 | 003NS000000C018 | create | Willa Grant |  |
| 20 | 003NS000000C019 | create | Noah Keller |  |
| 21 | 003NS000000C020 | create | Priya Raman |  |
| 22 | 003NS000000C021 | create | Quentin Walsh |  |
| 23 | 003NS000000C022 | create | Andre Lang |  |
| 24 | 003NS000000C023 | create | Rosa Delgado |  |
| 25 | 003NS000000C024 | create | Silas Grant |  |
| 26 | 003NS000000C025 | create | Tessa Nguyen |  |
| 27 | 003NS000000C026 | create | Derek Mercer |  |
| 28 | 003NS000000C027 | create | Uma Kapoor |  |
| 29 | 003NS000000C028 | create | Victor Lang |  |
| 30 | 003NS000000C029 | create | Willa Hart |  |
| 31 | 003NS000000C030 | create | Chris Holm |  |
| 32 | 003NS000000C031 | create | Yasmin Darwish |  |
| 33 | 003NS000000C032 | create | Zoe Mercer |  |
| 34 | 003NS000000CBAD | fail | Pat Notreal | invalid email "not-an-email" |
| 35 | 003NS000000CNOL | fail | Sam | required value is missing |
| 36 | 003NS000000CDUP | skip | Amina Shah | duplicate email in source; kept 003NS000000C001 |
| 37 | 003NS000000CEMP | fail | Cho | required value is missing; required value is missing |
| 38 | 003NS000000CPHN | create | Riley Guest |  |

### deals

| Row | Source id | Action | Record | Reason |
| ---: | --- | --- | --- | --- |
| 2 | 006NS000000D001 | create | Northwind Robotics - Platform |  |
| 3 | 006NS000000D002 | create | Northwind Robotics - Renewal 2026 |  |
| 4 | 006NS000000D003 | create | Cedar & Pine Studio - Platform |  |
| 5 | 006NS000000D004 | create | Cedar & Pine Studio - Renewal 2026 |  |
| 6 | 006NS000000D005 | create | Brightpath Logistics - Platform |  |
| 7 | 006NS000000D006 | create | Harborline Clinics - Platform |  |
| 8 | 006NS000000D007 | create | Harborline Clinics - Renewal 2026 |  |
| 9 | 006NS000000D008 | create | Quay Street Capital - Platform |  |
| 10 | 006NS000000D009 | create | Lumen Field Analytics - Platform |  |
| 11 | 006NS000000D010 | create | Lumen Field Analytics - Renewal 2026 |  |
| 12 | 006NS000000D011 | create | Copperline Manufacturing - Platform |  |
| 13 | 006NS000000D012 | create | Kindred Learning - Platform |  |
| 14 | 006NS000000D013 | create | Kindred Learning - Renewal 2026 |  |
| 15 | 006NS000000D014 | create | Sable Route Freight - Platform |  |
| 16 | 006NS000000D015 | create | Marlowe Legal Ops - Platform |  |
| 17 | 006NS000000D016 | create | Finch & Howe Advisors - Platform |  |
| 18 | 006NS000000D017 | create | Finch & Howe Advisors - Renewal 2026 |  |
| 19 | 006NS000000D018 | create | Arclight Media - Platform |  |
| 20 | 006NS000000D019 | create | Plover Health - Platform |  |
| 21 | 006NS000000D020 | create | Plover Health - Renewal 2026 |  |
| 22 | 006NS000000D021 | create | Redcedar Insurance - Platform |  |
| 23 | 006NS000000D022 | create | Paperplane HR - Platform |  |
| 24 | 006NS000000D023 | create | Paperplane HR - Renewal 2026 |  |
| 25 | 006NS000000D024 | create | Southshore Clinics - Platform |  |
| 26 | 006NS000000D025 | create | Oakmont Schools - Platform |  |
| 27 | 006NS000000D026 | create | Oakmont Schools - Renewal 2026 |  |
| 28 | 006NS000000D027 | create | Blueharbor Mutual - Platform |  |
| 29 | 006NS000000D028 | create | Nimbus Retail Cloud - Platform |  |
| 30 | 006NS000000D029 | create | Nimbus Retail Cloud - Renewal 2026 |  |
| 31 | 006NS000000D030 | create | Westferry Consulting - Platform |  |
| 32 | 006NS000000D031 | create | Larkspur Devices - Platform |  |
| 33 | 006NS000000D032 | create | Larkspur Devices - Renewal 2026 |  |
| 34 | 006NS000000D033 | create | Ironwood Components - Platform |  |
| 35 | 006NS000000D034 | create | Summit Ledger - Platform |  |
| 36 | 006NS000000D035 | create | Summit Ledger - Renewal 2026 |  |
| 37 | 006NS000000D036 | create | Lantern Freight - Platform |  |
| 38 | 006NS000000OORP | create | Missing Account - Platform |  |
| 39 | 006NS000000OBAD | fail | Verbal Commit - Platform | unmapped stage "Verbal Yes" for pipeline "Sales" |
| 40 | 006NS000000D001 | skip | Northwind Robotics - duplicate opportunity row | duplicate source id in source; kept 006NS000000D001 |
| 41 | 006NS000000ODAT | fail | Bad Close Date - Platform | invalid date "yesterday" |
| 42 | 006NS000000DLOW | create | Case folded stage - Platform |  |
| 43 | 006NS000000ODUP | create | Points at duplicate Northwind site |  |

## Notes

- 2 rows kept legacy_owner and did not set hubspot_owner_id because no owner matched.
