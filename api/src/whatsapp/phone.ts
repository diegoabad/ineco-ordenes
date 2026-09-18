export function normalizePhoneNumber(value: string): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function toWhatsappJid(phone: string): string {
  const digits = normalizePhoneNumber(phone);
  return `${digits}@s.whatsapp.net`;
}
