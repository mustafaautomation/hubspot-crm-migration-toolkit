import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toCsv } from "../src/csv.js";

/**
 * Deterministic synthetic CRM exports for Northline, a fictional
 * revenue-intelligence vendor. Every domain is on the reserved .example TLD.
 * Phone numbers use the fictional 555-01xx range. Nothing here is a real person.
 */

interface Company {
  name: string;
  domain: string;
  industry: string;
  city: string;
  state: string;
  country: string;
  type: "Prospect" | "Customer" | "Partner" | "Former Customer";
  owner: string;
  employees: number;
  description: string;
}

interface Person {
  company: number;
  first: string;
  last: string;
  title: string;
  lifecycle: string;
  source: string;
  owner: string;
  phoneStyle?: number;
}

const SALES = ["New Lead", "Qualified", "Discovery", "Proposal", "Negotiation", "Closed Won", "Closed Lost"];
const RENEWALS = ["Identified", "Quoted", "Negotiation", "Renewed", "Churned"];
const AMOUNTS = [18000, 24000, 36000, 42000, 48000, 64000, 72000, 96000, 120000, 144000];
const TITLES = [
  "VP Revenue Operations",
  "Director of Sales",
  "Head of RevOps",
  "CRO",
  "Sales Operations Manager",
  "VP Sales",
  "Director of Marketing Operations",
  "RevOps Lead",
];
const SOURCES = ["Inbound", "Outbound", "Partner", "Event", "Website"];
const FIRST = [
  "Amina", "Beatrice", "Chris", "Diane", "Evan", "Farah", "Gabriel", "Helen", "Ivan", "Jules",
  "Keiko", "Leo", "Maya", "Noah", "Priya", "Quentin", "Rosa", "Silas", "Tessa", "Uma",
  "Victor", "Willa", "Yasmin", "Zoe", "Andre", "Bianca", "Camille", "Derek",
];
const LAST = [
  "Shah", "Cole", "Dalton", "Okada", "Brooks", "Nazir", "Soto", "Park", "Moreau", "Carter",
  "Mori", "Berg", "Srinivasan", "Keller", "Raman", "Walsh", "Delgado", "Grant", "Nguyen", "Kapoor",
  "Lang", "Hart", "Darwish", "Mercer", "Flores", "Dubois", "Holm", "Vasquez",
];

const EAST: Company[] = [
  co("Northwind Robotics", "northwindrobotics.example", "Manufacturing", "Austin", "TX", "Customer", "Avery Chen", 420, "Inspection robots for regional plants."),
  co("Cedar & Pine Studio", "cedarandpine.example", "Media", "Portland", "OR", "Customer", "Jordan Hale", 85, "Brand studio for outdoor retailers."),
  co("Brightpath Logistics", "brightpathlogistics.example", "Logistics", "Chicago", "IL", "Prospect", "Riley Okonkwo", 610, "Regional LTL carrier covering the Midwest."),
  co("Harborline Clinics", "harborlineclinics.example", "Healthcare", "Boston", "MA", "Customer", "Avery Chen", 240, "Outpatient specialty clinics."),
  co("Quay Street Capital", "quaystreet.example", "Financial Services", "New York", "NY", "Prospect", "Jordan Hale", 150, "Middle-market private credit."),
  co("Lumen Field Analytics", "lumenfield.example", "Software", "Seattle", "WA", "Customer", "Riley Okonkwo", 190, "Product analytics for B2B SaaS."),
  co("Copperline Manufacturing", "copperline.example", "Manufacturing", "Detroit", "MI", "Prospect", "Avery Chen", 880, "Precision metal components."),
  co("Kindred Learning", "kindredlearning.example", "Education", "Minneapolis", "MN", "Customer", "Samir Patel", 310, "Corporate learning programs."),
  co("Sable Route Freight", "sableroute.example", "Logistics", "Atlanta", "GA", "Prospect", "Riley Okonkwo", 540, "Dedicated fleet for grocery shippers."),
  co("Marlowe Legal Ops", "marlowegal.example", "Professional Services", "Washington", "DC", "Prospect", "Jordan Hale", 70, "Legal operations consultancy."),
  co("Finch & Howe Advisors", "finchhowe.example", "Professional Services", "Chicago", "IL", "Customer", "Avery Chen", 95, "CFO advisory for founder-led firms."),
  co("Arclight Media", "arclightmedia.example", "Media", "Los Angeles", "CA", "Prospect", "Jordan Hale", 140, "B2B podcast network."),
  co("Plover Health", "ploverhealth.example", "Healthcare", "Raleigh", "NC", "Customer", "Samir Patel", 260, "Home infusion services."),
  co("Redcedar Insurance", "redcedar.example", "Insurance", "Charlotte", "NC", "Prospect", "Riley Okonkwo", 430, "Commercial package carrier."),
  co("Paperplane HR", "paperplanehr.example", "Software", "Austin", "TX", "Customer", "Avery Chen", 210, "HRIS for multi-state employers."),
  co("Southshore Clinics", "southshoreclinics.example", "Healthcare", "Miami", "FL", "Prospect", "Jordan Hale", 180, "Orthopedic group."),
  co("Oakmont Schools", "oakmontschools.example", "Education", "Columbus", "OH", "Customer", "Samir Patel", 720, "Regional independent school network."),
  co("Blueharbor Mutual", "blueharbor.example", "Insurance", "Hartford", "CT", "Prospect", "Riley Okonkwo", 390, "Mutual insurer for trades."),
  co("Nimbus Retail Cloud", "nimbusretail.example", "Software", "San Francisco", "CA", "Customer", "Avery Chen", 160, "Inventory planning for specialty retail."),
  co("Westferry Consulting", "westferry.example", "Professional Services", "Boston", "MA", "Partner", "Jordan Hale", 55, "Implementation partner for revenue tools."),
  co("Larkspur Devices", "larkspurdevices.example", "Healthcare", "Cambridge", "MA", "Customer", "Riley Okonkwo", 300, "Diagnostic device manufacturer."),
  co("Ironwood Components", "ironwoodcomponents.example", "Manufacturing", "Cleveland", "OH", "Prospect", "Avery Chen", 640, "Industrial valve supplier."),
  co("Summit Ledger", "summitledger.example", "Financial Services", "Denver", "CO", "Customer", "Jordan Hale", 125, "Outsourced controllership."),
  co("Lantern Freight", "lanternfreight.example", "Logistics", "Kansas City", "MO", "Prospect", "Riley Okonkwo", 410, "Final-mile for medical devices."),
];

const WEST: Company[] = [
  co("Halcyon Devices", "halcyondevices.example", "Manufacturing", "San Jose", "CA", "Customer", "Morgan Ellis", 275, "Contract manufacturer for climate sensors."),
  co("Driftglass Travel", "driftglass.example", "Media", "San Diego", "CA", "Prospect", "Quinn Alvarez", 60, "Corporate offsite studio."),
  co("Portico Payments", "porticopayments.example", "Financial Services", "Phoenix", "AZ", "Customer", "Morgan Ellis", 340, "Embedded payments for vertical SaaS."),
  co("Meadow & Rye", "meadowrye.example", "Professional Services", "Madison", "WI", "Partner", "Quinn Alvarez", 40, "Boutique RevOps consultancy."),
  co("Aster Labs", "asterlabs.example", "Healthcare", "San Diego", "CA", "Prospect", "Avery Chen", 210, "Clinical lab network."),
  co("Foundry North", "foundrynorth.example", "Manufacturing", "Milwaukee", "WI", "Customer", "Morgan Ellis", 510, "Custom castings."),
  co("Clearwater Civic", "clearwatercivic.example", "Education", "Boise", "ID", "Prospect", "Jordan Hale", 90, "Civic education nonprofit."),
  co("Silverthread Security", "silverthread.example", "Software", "Arlington", "VA", "Customer", "Riley Okonkwo", 180, "Vendor risk software."),
  co("Highrail Energy", "highrailenergy.example", "Manufacturing", "Houston", "TX", "Prospect", "Morgan Ellis", 760, "Grid equipment distributor."),
  co("Coral & Co", "coralandco.example", "Media", "Miami", "FL", "Partner", "Quinn Alvarez", 35, "Agency partner placing Northline."),
  co("Pathway Clinics", "pathwayclinics.example", "Healthcare", "Phoenix", "AZ", "Customer", "Samir Patel", 290, "Urgent care group."),
  co("Kite & Cable", "kitecable.example", "Logistics", "Memphis", "TN", "Prospect", "Morgan Ellis", 450, "Specialized freight brokerage."),
  co("Fieldnote Agriculture", "fieldnoteag.example", "Manufacturing", "Des Moines", "IA", "Customer", "Jordan Hale", 230, "Farm equipment telematics."),
  co("Brightmonth Learning", "brightmonth.example", "Education", "Nashville", "TN", "Prospect", "Quinn Alvarez", 140, "Apprenticeship platform."),
  co("Vantage Kiln", "vantagekiln.example", "Manufacturing", "Pittsburgh", "PA", "Partner", "Morgan Ellis", 95, "Referral partner in industrial sales."),
  co("Helio Metering", "heliometering.example", "Software", "Denver", "CO", "Customer", "Avery Chen", 155, "Utility metering analytics."),
];

const PARTNER: Company[] = [
  co("Greyfriars Analytics", "greyfriars.example", "Software", "London", "", "Customer", "Jordan Hale", 120, "UK analytics consultancy. Fictional London office."),
  co("Northline Canada Desk", "northlinecanada.example", "Software", "Toronto", "ON", "Customer", "Samir Patel", 45, "Fictional Canadian services desk."),
  co("Paper Lantern Agency", "paperlantern.example", "Professional Services", "Austin", "TX", "Partner", "Quinn Alvarez", 28, "Demand-gen agency."),
  co("Bricklane Clinics", "bricklaneclinics.example", "Healthcare", "Manchester", "", "Prospect", "Riley Okonkwo", 200, "Fictional UK clinic group."),
  co("Sable & Birch", "sablebirch.example", "Financial Services", "Edinburgh", "", "Prospect", "Jordan Hale", 80, "Fictional wealth advisory."),
  co("Red Kite Manufacturing", "redkite.example", "Manufacturing", "Sheffield", "", "Customer", "Morgan Ellis", 360, "Fictional precision engineering firm."),
  co("Harbor School Group", "harborschool.example", "Education", "Dublin", "", "Prospect", "Samir Patel", 250, "Fictional school group."),
  co("Lowcountry Freight", "lowcountryfreight.example", "Logistics", "Charleston", "SC", "Customer", "Riley Okonkwo", 190, "Port drayage carrier."),
  co("Kindling HR", "kindlinghr.example", "Software", "Remote", "", "Prospect", "Avery Chen", 70, "People-ops software for agencies."),
  co("Opal Mutual", "opalmutual.example", "Insurance", "Des Moines", "IA", "Customer", "Jordan Hale", 480, "Regional mutual."),
  co("Cedarhouse Legal", "cedarhouse.example", "Professional Services", "Denver", "CO", "Partner", "Quinn Alvarez", 50, "Law-firm operations partner."),
  co("Mesa Diagnostics", "mesadiagnostics.example", "Healthcare", "Albuquerque", "NM", "Prospect", "Samir Patel", 140, "Reference lab."),
  co("Northspan Components", "northspan.example", "Manufacturing", "Green Bay", "WI", "Customer", "Morgan Ellis", 305, "Packaging components."),
  co("Lumen Parish Media", "lumenparish.example", "Media", "New Orleans", "LA", "Prospect", "Jordan Hale", 40, "Independent publisher."),
];

function co(
  name: string,
  domain: string,
  industry: string,
  city: string,
  state: string,
  type: Company["type"],
  owner: string,
  employees: number,
  description: string,
  country = "United States",
): Company {
  return { name, domain, industry, city, state, country, type, owner, employees, description };
}

function main(): void {
  writeSalesforce();
  writePipedrive();
  writeZoho();
  process.stdout.write("wrote samples/salesforce, samples/pipedrive, samples/zoho\n");
}

function writeSalesforce(): void {
  const dir = mkdir("samples/salesforce");
  const companies = EAST.map((company, index) => ({ ...company, id: `001NS000000A${pad(index + 1)}` }));
  const people = peopleFor(companies, 0).map((person, index) => ({ ...person, id: `003NS000000C${pad(index + 1)}` }));
  const deals = dealsFor(companies, people, "Sales", "Renewals", SALES, RENEWALS).map((deal, index) => ({
    ...deal,
    id: `006NS000000D${pad(index + 1)}`,
  }));
  const northwind = companies[0];
  const amina = people[0];
  const firstDeal = deals[0];

  const accountRows = companies.map((company, index) => [
    company.id,
    company.name,
    website(company.domain, index),
    company.industry,
    phone(index, index),
    company.city,
    company.state,
    company.country,
    company.type,
    company.owner,
    String(company.employees),
    company.description,
  ]);
  accountRows.push(
    ["001NS000000ADUP", "Northwind Robotics (stale import)", `https://WWW.${northwind.domain}/about`, "Manufacturing", "(512) 555-0142 x12", "Austin", "TX", "United States", "Customer", "Avery Chen", "420", "Duplicate website of the Austin robotics account."],
    ["001NS000000ABAD", "Astrology Insights Desk", "astrologyinsights.example", "Astrology", "512.555.0177", "Austin", "TX", "United States", "Prospect", "Avery Chen", "12", "Unmapped industry enum."],
    ["001NS000000ANON", "", "missingname.example", "Software", "5125550104", "Austin", "TX", "United States", "Prospect", "Avery Chen", "20", "Account name was blank in the export."],
    ["001NS000000ADOM", "Broken Website Co", "not a domain", "Software", "call the office", "Austin", "TX", "United States", "Prospect", "Former Rep", "15", "Website and phone do not parse."],
  );

  const contactRows = people.map((person) => [
    person.id,
    companies[person.company].id,
    person.first,
    person.last,
    email(person, companies[person.company].domain),
    person.title,
    phone(person.company + 3, person.company),
    phone(person.company + 11, person.company + 1),
    person.source,
    person.lifecycle,
    person.owner,
  ]);
  contactRows[0][4] = "  Amina.Shah@NorthwindRobotics.EXAMPLE ";
  contactRows.push(
    ["003NS000000CBAD", northwind.id, "Pat", "Notreal", "not-an-email", "Intern", "5125550101", "", "Inbound", "Lead", "Avery Chen"],
    ["003NS000000CNOL", northwind.id, "Sam", "", "sam.noname@northwindrobotics.example", "Analyst", "(512) 555-0108", "", "Outbound", "SQL", "Avery Chen"],
    ["003NS000000CDUP", northwind.id, "Amina", "Shah", "AMINA.SHAH@northwindrobotics.example", "VP Revenue Operations", "512.555.0100", "", "Inbound", "Customer", "Jordan Hale"],
    ["003NS000000CEMP", northwind.id, "", "Cho", "", "Contractor", "555-0100", "", "Event", "Lead", "Avery Chen"],
    ["003NS000000CPHN", companies[2].id, "Riley", "Guest", "riley.guest@brightpathlogistics.example", "Coordinator", "call the front desk", "", "Website", "Lead", "Former Rep"],
  );

  const dealRows = deals.map((deal, index) => [
    deal.id,
    deal.name,
    companies[deal.company].id,
    people[deal.person].id,
    deal.stage,
    deal.pipeline,
    money(deal.amount, index),
    closeDate(index),
    deal.type,
    deal.owner,
  ]);
  dealRows.push(
    ["006NS000000OORP", "Missing Account - Platform", "001NS000000AMISS", amina.id, "Proposal", "Sales", "42000", "2026-06-30", "New Business", "Avery Chen"],
    ["006NS000000OBAD", "Verbal Commit - Platform", northwind.id, amina.id, "Verbal Yes", "Sales", "$18,000", "2026-07-15", "New Business", "Avery Chen"],
    [firstDeal.id, "Northwind Robotics - duplicate opportunity row", northwind.id, amina.id, "Closed Won", "Sales", "96000", "2026-04-01", "New Business", "Avery Chen"],
    ["006NS000000ODAT", "Bad Close Date - Platform", companies[4].id, people.find((person) => person.company === 4)?.id ?? amina.id, "Qualified", "Sales", "TBD", "yesterday", "New Business", "Jordan Hale"],
    ["006NS000000DLOW", "Case folded stage - Platform", companies[5].id, people.find((person) => person.company === 5)?.id ?? amina.id, "closed won", "sales", "64000", "15-Mar-2026", "New Business", "Riley Okonkwo"],
    ["006NS000000ODUP", "Points at duplicate Northwind site", "001NS000000ADUP", amina.id, "Negotiation", "Sales", "72000.00", "4/2/2026", "Expansion", "Avery Chen"],
  );

  write(dir, "accounts.csv", ["Account ID", "Account Name", "Website", "Industry", "Phone", "Billing City", "Billing State", "Billing Country", "Type", "Account Owner", "Employees", "Description"], accountRows);
  write(dir, "contacts.csv", ["Contact ID", "Account ID", "First Name", "Last Name", "Email", "Title", "Phone", "Mobile", "Lead Source", "Lifecycle Stage", "Contact Owner"], contactRows);
  write(dir, "opportunities.csv", ["Opportunity ID", "Opportunity Name", "Account ID", "Primary Contact ID", "Stage", "Pipeline", "Amount", "Close Date", "Type", "Opportunity Owner"], dealRows);
}

function writePipedrive(): void {
  const dir = mkdir("samples/pipedrive");
  const companies = WEST.map((company, index) => ({ ...company, id: String(8001 + index) }));
  const people = peopleFor(companies, 3);
  people.splice(1, 0, {
    company: 0,
    first: "Mary Ann",
    last: "Moss",
    title: "Director of Sales",
    lifecycle: "Customer",
    source: "Outbound",
    owner: "Morgan Ellis",
  });
  const withIds = people.map((person, index) => ({ ...person, id: String(9001 + index) }));
  const deals = westDeals(companies, withIds).map((deal, index) => ({ ...deal, id: String(7001 + index) }));

  const orgRows = companies.map((company, index) => [
    company.id,
    company.name,
    website(company.domain, index),
    company.industry,
    phone(index + 20, index),
    company.city,
    company.state,
    company.country,
    company.type,
    String(company.employees),
    company.owner,
  ]);
  orgRows.push(
    ["8099", "Halcyon Devices West", "https://www.halcyondevices.example/partners", "Manufacturing", "(408) 555-0114", "San Jose", "CA", "United States", "Customer", "275", "Morgan Ellis"],
    ["8098", "", "blankorg.example", "Software", "4085550118", "San Jose", "CA", "United States", "Prospect", "40", "Quinn Alvarez"],
  );

  const peopleRows = withIds.map((person) => [
    person.id,
    `${person.first} ${person.last}`.trim(),
    email(person, companies[person.company].domain),
    phone(person.company + 30, person.company + 2),
    companies[person.company].id,
    person.title,
    person.owner,
    person.source,
    person.lifecycle,
  ]);
  const primaryEmail = String(peopleRows[0][2]);
  const at = primaryEmail.indexOf("@");
  const mixedLocal = primaryEmail
    .slice(0, at)
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(".");
  peopleRows[0][2] = `  ${mixedLocal}@${primaryEmail.slice(at + 1).toUpperCase()} `;
  peopleRows.push(
    ["9099", "Bad Email", "bad-email", "408.555.0199", "8001", "Intern", "Morgan Ellis", "Inbound", "Lead"],
    ["9098", "Prince", "prince@halcyondevices.example", "+1 408 555 0166", "8001", "Advisor", "Morgan Ellis", "Event", "Lead"],
    ["9097", String(peopleRows[0][1]), primaryEmail.toUpperCase(), "4085550102", "8001", "Duplicate", "Quinn Alvarez", "Website", "Customer"],
  );
  const primary = withIds[0];

  const dealRows = deals.map((deal, index) => [
    deal.id,
    deal.name,
    money(deal.amount, index),
    "USD",
    companies[deal.company].id,
    withIds[deal.person].id,
    deal.pipeline,
    deal.stage,
    closeDate(index + 5),
    deal.stage === "6" || deal.stage === "11" ? "won" : deal.stage === "7" || deal.stage === "12" ? "lost" : "open",
    deal.owner,
    deal.type,
  ]);
  dealRows.push(
    ["7098", "Orphan org deal", "24000", "USD", "99999", primary.id, "1", "4", "2026-08-01", "open", "Morgan Ellis", "New Business"],
    ["7099", "Unknown stage", "18000", "USD", "8001", primary.id, "1", "99", "2026-08-15", "open", "Morgan Ellis", "New Business"],
    ["7001", "Halcyon duplicate deal row", "96000", "USD", "8001", primary.id, "1", "6", "2026-05-01", "won", "Morgan Ellis", "New Business"],
  );

  write(dir, "organizations.csv", ["Organization - ID", "Organization - Name", "Organization - Website", "Organization - Industry", "Organization - Phone", "Organization - City", "Organization - State", "Organization - Country", "Organization - Label", "Organization - Employees", "Organization - Owner"], orgRows);
  write(dir, "people.csv", ["Person - ID", "Person - Name", "Person - Email", "Person - Phone", "Person - Organization ID", "Person - Title", "Person - Owner", "Person - Lead source", "Person - Label"], peopleRows);
  write(dir, "deals.csv", ["Deal - ID", "Deal - Title", "Deal - Value", "Deal - Currency", "Deal - Organization ID", "Deal - Person ID", "Deal - Pipeline", "Deal - Stage", "Deal - Expected close date", "Deal - Status", "Deal - Owner", "Deal - Type"], dealRows);
}

function writeZoho(): void {
  const dir = mkdir("samples/zoho");
  const companies = PARTNER.map((company, index) => ({
    ...company,
    country: ["London", "Manchester", "Sheffield", "Edinburgh"].includes(company.city)
      ? "United Kingdom"
      : company.city === "Dublin"
        ? "Ireland"
        : company.city === "Toronto"
          ? "Canada"
          : company.country,
    id: `415820000000${pad(index + 1, 4)}`,
  }));
  const people = peopleFor(companies, 5).map((person, index) => ({ ...person, id: `415820000100${pad(index + 1, 4)}` }));
  const deals = zohoDeals(companies, people).map((deal, index) => ({ ...deal, id: `415820000200${pad(index + 1, 4)}` }));

  const accountRows = companies.map((company, index) => [
    company.id,
    company.name,
    index === 0 ? "https://greyfriars.example/uk" : website(company.domain, index),
    company.industry,
    index === 0 ? "+44 20 7946 0958" : index === 1 ? "+1 416 555 0134" : phone(index + 40, index),
    company.city,
    company.state,
    company.country,
    company.type,
    company.owner,
    String(company.employees),
    company.description,
  ]);
  accountRows.push(
    ["4158200000009099", "Greyfriars Analytics Ltd", "http://www.greyfriars.example", "Software", "+44 20 7946 0958", "London", "", "United Kingdom", "Customer", "Jordan Hale", "120", "Duplicate domain of the London account."],
    ["4158200000009098", "Unmapped Industry Ltd", "unmapped.example", "Astrology", "2015550109", "London", "", "United Kingdom", "Prospect", "Jordan Hale", "10", "Industry is not in the value map."],
  );

  const contactRows = people.map((person) => [
    person.id,
    companies[person.company].id,
    person.first,
    person.last,
    email(person, companies[person.company].domain),
    person.title,
    person.company === 0 ? "+44 20 7946 0991" : phone(person.company + 50, 0),
    "",
    person.source,
    person.lifecycle,
    person.owner,
  ]);
  contactRows.push(
    ["4158200001009099", companies[0].id, "Renée", "Cho", "renee.cho@", "Analyst", "not-a-phone", "", "Inbound", "Hot", "Jordan Hale"],
    ["4158200001009098", companies[0].id, "Renée", "Cho", "  Renee.Cho@Greyfriars.Example ", "Analyst", "+44 20 7946 0100", "", "Inbound", "Customer", "Samir Patel"],
  );

  const dealRows = deals.map((deal, index) => [
    deal.id,
    deal.name,
    companies[deal.company].id,
    people[deal.person].id,
    deal.stage,
    deal.pipeline,
    money(deal.amount, index + 1),
    closeDate(index + 9),
    deal.type,
    deal.owner,
  ]);
  dealRows.push(
    ["4158200002009099", "Orphan partner deal", "4158200000000000", people[0].id, "Qualification", "Sales", "36000", "2026-09-01", "New Business", "Jordan Hale"],
    ["4158200002009098", "Unmapped Zoho stage", companies[2].id, people.find((person) => person.company === 2)?.id ?? people[0].id, "Verbal Commit", "Sales", "18000", "2026-09-15", "Partnership", "Quinn Alvarez"],
    [deals[0].id, "Greyfriars duplicate deal", companies[0].id, people[0].id, "Closed Won", "Sales", "96000", "2026-03-20", "New Business", "Jordan Hale"],
  );

  write(dir, "accounts.csv", ["Account ID", "Account Name", "Website", "Industry", "Phone", "Billing City", "Billing State", "Billing Country", "Account Type", "Account Owner", "Employees", "Description"], accountRows);
  write(dir, "contacts.csv", ["Contact ID", "Account ID", "First Name", "Last Name", "Email", "Title", "Phone", "Mobile", "Lead Source", "Lifecycle Stage", "Contact Owner"], contactRows);
  write(dir, "deals.csv", ["Deal ID", "Deal Name", "Account ID", "Contact ID", "Stage", "Pipeline", "Amount", "Closing Date", "Type", "Deal Owner"], dealRows);
}

function peopleFor(companies: { owner: string; type: string }[], shift: number): Person[] {
  const people: Person[] = [];
  companies.forEach((company, index) => {
    people.push({
      company: index,
      first: FIRST[(index + shift) % FIRST.length],
      last: LAST[(index + shift) % LAST.length],
      title: TITLES[index % TITLES.length],
      lifecycle: company.type === "Customer" ? "Customer" : index % 2 === 0 ? "SQL" : "Opportunity",
      source: SOURCES[index % SOURCES.length],
      owner: company.owner,
    });
    if (index % 3 === 0) {
      people.push({
        company: index,
        first: FIRST[(index + shift + 9) % FIRST.length],
        last: LAST[(index + shift + 5) % LAST.length],
        title: TITLES[(index + 2) % TITLES.length],
        lifecycle: "Opportunity",
        source: SOURCES[(index + 1) % SOURCES.length],
        owner: company.owner,
      });
    }
  });
  return people;
}

interface DealSeed {
  company: number;
  person: number;
  name: string;
  stage: string;
  pipeline: string;
  amount: number;
  type: string;
  owner: string;
}

function dealsFor(
  companies: Company[],
  people: { company: number }[],
  salesPipeline: string,
  renewalPipeline: string,
  salesStages: string[],
  renewalStages: string[],
): DealSeed[] {
  const deals: DealSeed[] = [];
  companies.forEach((company, index) => {
    const person = people.findIndex((item) => item.company === index);
    const stage = index === 0 ? "Closed Won" : salesStages[index % salesStages.length];
    deals.push({
      company: index,
      person,
      name: `${company.name} - Platform`,
      stage,
      pipeline: salesPipeline,
      amount: AMOUNTS[index % AMOUNTS.length],
      type: company.type === "Partner" ? "Partnership" : "New Business",
      owner: company.owner,
    });
    if (company.type === "Customer") {
      deals.push({
        company: index,
        person,
        name: `${company.name} - Renewal 2026`,
        stage: renewalStages[index % renewalStages.length],
        pipeline: renewalPipeline,
        amount: Math.round(AMOUNTS[index % AMOUNTS.length] * 1.08),
        type: "Renewal",
        owner: index % 2 === 0 ? "Samir Patel" : company.owner,
      });
    }
  });
  return deals;
}

function westDeals(companies: Company[], people: { company: number }[]): DealSeed[] {
  const sales = ["1", "2", "3", "4", "5", "6", "7"];
  const partner = ["8", "9", "10", "11", "12"];
  const deals: DealSeed[] = [];
  companies.forEach((company, index) => {
    const person = people.findIndex((item) => item.company === index);
    if (company.type === "Partner") {
      deals.push({
        company: index,
        person,
        name: `${company.name} partnership`,
        stage: partner[index % partner.length],
        pipeline: "2",
        amount: AMOUNTS[(index + 2) % AMOUNTS.length],
        type: "Partnership",
        owner: "Quinn Alvarez",
      });
      return;
    }
    deals.push({
      company: index,
      person,
      name: `${company.name} - Platform`,
      stage: index === 0 ? "6" : sales[index % sales.length],
      pipeline: "1",
      amount: AMOUNTS[index % AMOUNTS.length],
      type: "New Business",
      owner: company.owner,
    });
  });
  return deals;
}

function zohoDeals(companies: Company[], people: { company: number }[]): DealSeed[] {
  const sales = ["Qualification", "Needs Analysis", "Value Proposition", "Proposal/Price Quote", "Negotiation/Review", "Closed Won", "Closed Lost"];
  const success = ["Onboarding", "Adopted", "Expansion", "Renewed", "Churned"];
  const deals: DealSeed[] = [];
  companies.forEach((company, index) => {
    const person = people.findIndex((item) => item.company === index);
    deals.push({
      company: index,
      person,
      name: `${company.name} - Platform`,
      stage: index === 0 ? "Closed Won" : sales[index % sales.length],
      pipeline: "Sales",
      amount: AMOUNTS[(index + 4) % AMOUNTS.length],
      type: company.type === "Partner" ? "Partnership" : "New Business",
      owner: company.owner,
    });
    if (company.type === "Customer") {
      deals.push({
        company: index,
        person,
        name: `${company.name} - Success plan`,
        stage: success[index % success.length],
        pipeline: "Customer Success",
        amount: AMOUNTS[(index + 1) % AMOUNTS.length],
        type: "Renewal",
        owner: "Samir Patel",
      });
    }
  });
  return deals;
}

function website(domain: string, index: number): string {
  if (index % 3 === 0) return `https://www.${domain}`;
  if (index % 3 === 1) return `https://${domain}/`;
  return domain;
}

function phone(index: number, style: number): string {
  const areas = [512, 617, 312, 206, 415, 303, 404, 646, 702, 919];
  const area = areas[index % areas.length];
  const line = String(100 + (index % 90)).padStart(4, "0");
  if (style % 4 === 0) return `(${area}) 555-${line}`;
  if (style % 4 === 1) return `${area}.555.${line}`;
  if (style % 4 === 2) return `+1 ${area} 555 ${line}`;
  return `${area}555${line}`;
}

function email(person: { first: string; last: string }, domain: string): string {
  const local = `${slug(person.first)}.${slug(person.last)}`;
  return `${local}@${domain}`;
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function money(amount: number, index: number): string {
  if (index % 3 === 0) return `$${amount.toLocaleString("en-US")}`;
  if (index % 3 === 1) return `${amount}.00`;
  return String(amount);
}

function closeDate(index: number): string {
  const date = new Date(Date.UTC(2026, index % 12, (index % 27) + 1));
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (index % 3 === 0) return date.toISOString().slice(0, 10);
  if (index % 3 === 1) return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
  return `${date.getUTCDate()}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

function pad(value: number, width = 3): string {
  return String(value).padStart(width, "0");
}

function mkdir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

function write(dir: string, file: string, headers: string[], rows: string[][]): void {
  writeFileSync(join(dir, file), toCsv(headers, rows));
}

main();
