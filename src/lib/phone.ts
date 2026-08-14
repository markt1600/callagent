// Country prefixes: names for display and destination-aware formatting of
// the guest contact number given out on calls.

interface CountryInfo {
  prefix: string;
  name: string;
  /** Trunk digit prepended when dialing domestically ("0" in Japan, none in Singapore). */
  trunk: string;
}

const COUNTRIES: CountryInfo[] = [
  { prefix: "+65", name: "Singapore", trunk: "" },
  { prefix: "+81", name: "Japan", trunk: "0" },
  { prefix: "+852", name: "Hong Kong", trunk: "" },
  { prefix: "+853", name: "Macau", trunk: "" },
  { prefix: "+886", name: "Taiwan", trunk: "0" },
  { prefix: "+82", name: "South Korea", trunk: "0" },
  { prefix: "+86", name: "China", trunk: "0" },
  { prefix: "+66", name: "Thailand", trunk: "0" },
  { prefix: "+60", name: "Malaysia", trunk: "0" },
  { prefix: "+62", name: "Indonesia", trunk: "0" },
  { prefix: "+84", name: "Vietnam", trunk: "0" },
  { prefix: "+63", name: "Philippines", trunk: "0" },
  { prefix: "+91", name: "India", trunk: "0" },
  { prefix: "+61", name: "Australia", trunk: "0" },
  { prefix: "+64", name: "New Zealand", trunk: "0" },
  { prefix: "+44", name: "United Kingdom", trunk: "0" },
  { prefix: "+33", name: "France", trunk: "0" },
  { prefix: "+49", name: "Germany", trunk: "0" },
  { prefix: "+39", name: "Italy", trunk: "" },
  { prefix: "+34", name: "Spain", trunk: "" },
  { prefix: "+1", name: "US / Canada", trunk: "" },
];

/** Longest-prefix country match for an E.164-ish number, or null. */
export function countryOf(phoneNumber: string): CountryInfo | null {
  let best: CountryInfo | null = null;
  for (const c of COUNTRIES) {
    if (phoneNumber.startsWith(c.prefix) && (!best || c.prefix.length > best.prefix.length)) {
      best = c;
    }
  }
  return best;
}

/** Display name for a "+NN" prefix (e.g. "+81" → "Japan"); falls back to the prefix. */
export function countryForPrefix(prefix: string): string {
  return COUNTRIES.find((c) => c.prefix === prefix)?.name ?? prefix;
}

/**
 * The guest contact number as it should be given out on a call to
 * `restaurantPhone`: domestic format (country code dropped, trunk digit
 * added) when both numbers are in the same country — a Singapore restaurant
 * hears "9750 8007", not "+65 9750 8007" — and the full international
 * number otherwise.
 */
export function contactNumberForCall(contactPhone: string, restaurantPhone: string): string {
  const contact = contactPhone.replace(/[\s-]/g, "");
  const contactCountry = countryOf(contact);
  const restaurantCountry = countryOf(restaurantPhone);
  if (!contactCountry || !restaurantCountry || contactCountry.prefix !== restaurantCountry.prefix) {
    return contactPhone;
  }
  return contactCountry.trunk + contact.slice(contactCountry.prefix.length);
}
