export function formatCurrency(
  amountCents: number,
  currency: string = "USD",
  locale: string = "en",
): string {
  const amount = amountCents / 100;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount);
}

export function formatDate(
  dateStr: string,
  locale: string = "en",
): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatDateTime(
  dateStr: string,
  locale: string = "en",
): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

export function formatCardMask(mask: string): string {
  return mask.replace(/(.{4})/g, "$1 ").trim();
}

export function formatPeriod(period: string): string {
  const [year, month] = period.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  return new Intl.DateTimeFormat("en", { year: "numeric", month: "long" })
    .format(date);
}
