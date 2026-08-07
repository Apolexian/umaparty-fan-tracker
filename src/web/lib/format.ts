/** Fan counts run to nine digits, so lists get a compact form. */
export function compactFans(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function fullFans(value: number): string {
  return value.toLocaleString("en-US");
}

export function signed(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${compactFans(Math.abs(value))}`;
}

/** 20260806 -> "6 Aug" */
export function ymdLabel(ymd: number): string {
  const day = ymd % 100;
  const month = Math.floor(ymd / 100) % 100;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${day} ${months[month - 1] ?? "?"}`;
}

/** 20260806 -> "6 August 2026" */
export function ymdLong(ymd: number): string {
  const year = Math.floor(ymd / 10000);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${ymd % 100} ${months[(Math.floor(ymd / 100) % 100) - 1] ?? "?"} ${year}`;
}

export function ymdToDate(ymd: number): Date {
  return new Date(
    Date.UTC(Math.floor(ymd / 10000), (Math.floor(ymd / 100) % 100) - 1, ymd % 100),
  );
}

export function daysBetween(a: number, b: number): number {
  return Math.round(
    (ymdToDate(b).getTime() - ymdToDate(a).getTime()) / 86_400_000,
  );
}
