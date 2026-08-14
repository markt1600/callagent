"use client";

// Phone entry with a standard country-code picker: a dial-code dropdown plus
// a national-number field, combined into E.164 for the API — no manual "+65"
// typing. The parent still holds a single E.164 string.

import { useEffect, useState } from "react";

const COUNTRIES = [
  { code: "+65", flag: "🇸🇬", name: "Singapore" },
  { code: "+81", flag: "🇯🇵", name: "Japan" },
  { code: "+82", flag: "🇰🇷", name: "South Korea" },
  { code: "+86", flag: "🇨🇳", name: "China" },
  { code: "+852", flag: "🇭🇰", name: "Hong Kong" },
  { code: "+853", flag: "🇲🇴", name: "Macau" },
  { code: "+886", flag: "🇹🇼", name: "Taiwan" },
  { code: "+66", flag: "🇹🇭", name: "Thailand" },
  { code: "+84", flag: "🇻🇳", name: "Vietnam" },
  { code: "+60", flag: "🇲🇾", name: "Malaysia" },
  { code: "+62", flag: "🇮🇩", name: "Indonesia" },
  { code: "+63", flag: "🇵🇭", name: "Philippines" },
  { code: "+91", flag: "🇮🇳", name: "India" },
  { code: "+61", flag: "🇦🇺", name: "Australia" },
  { code: "+64", flag: "🇳🇿", name: "New Zealand" },
  { code: "+44", flag: "🇬🇧", name: "United Kingdom" },
  { code: "+49", flag: "🇩🇪", name: "Germany" },
  { code: "+33", flag: "🇫🇷", name: "France" },
  { code: "+39", flag: "🇮🇹", name: "Italy" },
  { code: "+34", flag: "🇪🇸", name: "Spain" },
  { code: "+1", flag: "🇺🇸", name: "US / Canada" },
];

function splitE164(value: string): { code: string; national: string } | null {
  if (!value.startsWith("+")) return null;
  let best: (typeof COUNTRIES)[number] | null = null;
  for (const c of COUNTRIES) {
    if (value.startsWith(c.code) && (!best || c.code.length > best.code.length)) best = c;
  }
  return best ? { code: best.code, national: value.slice(best.code.length) } : null;
}

export default function PhoneInput({
  value,
  onChange,
  defaultCountry = "+65",
  placeholder = "91234567",
}: {
  /** E.164 value, e.g. "+6591234567" (or "" when empty) */
  value: string;
  onChange: (e164: string) => void;
  /** Dial code selected before anything is typed, e.g. "+81" */
  defaultCountry?: string;
  placeholder?: string;
}) {
  const [country, setCountry] = useState(() => splitE164(value)?.code ?? defaultCountry);

  // Follow prefills/edits that carry a different country code.
  useEffect(() => {
    const parsed = splitE164(value);
    if (parsed && parsed.code !== country) setCountry(parsed.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const national = splitE164(value)?.national ?? value.replace(/[^\d]/g, "");

  return (
    <div className="row" style={{ gap: "0.4rem", flexWrap: "nowrap" }}>
      <select
        value={country}
        onChange={(e) => {
          setCountry(e.target.value);
          onChange(national ? e.target.value + national : "");
        }}
        title={COUNTRIES.find((c) => c.code === country)?.name}
        style={{ flex: "0 0 auto", width: "auto", minWidth: 104 }}
      >
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code} title={c.name}>
            {c.flag} {c.code}
          </option>
        ))}
      </select>
      <input
        type="tel"
        inputMode="tel"
        value={national}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          onChange(digits ? country + digits : "");
        }}
        placeholder={placeholder}
        style={{ flex: 1, minWidth: 0 }}
      />
    </div>
  );
}
