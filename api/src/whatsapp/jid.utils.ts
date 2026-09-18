import type { proto } from '@whiskeysockets/baileys';

type ExtendedMessageKey = proto.IMessageKey & {
  senderPn?: string;
  senderLid?: string;
  participantPn?: string;
  participantLid?: string;
  resolvedPeerPn?: string;
};

const lidToPhoneCache = new Map<string, string>();

export function jidToPhoneDigits(jid: string | null | undefined): string {
  if (!jid) {
    return '';
  }

  const userPart = jid.split('@')[0] ?? '';
  return userPart.split(':')[0]?.split('_')[0]?.replace(/\D/g, '') ?? '';
}

export function isLidJid(jid: string | null | undefined): boolean {
  return Boolean(jid?.endsWith('@lid'));
}

export function isPhoneJid(jid: string | null | undefined): boolean {
  return Boolean(jid?.endsWith('@s.whatsapp.net'));
}

export function registerLidPhoneMapping(lidJid: string, phoneJid: string): void {
  const lid = jidToPhoneDigits(lidJid);
  const phone = jidToPhoneDigits(phoneJid);

  if (lid && phone) {
    lidToPhoneCache.set(lid, phone);
  }
}

export function registerPhoneNumberToLidMapping(
  pnJid?: string | null,
  lidJid?: string | null,
): void {
  if (pnJid && lidJid) {
    registerLidPhoneMapping(lidJid, pnJid);
  }
}

export function registerChatLidMapping(chat: {
  id?: string | null;
  lidJid?: string | null;
  pnJid?: string | null;
}): void {
  const { id, lidJid, pnJid } = chat;

  registerPhoneNumberToLidMapping(pnJid, lidJid);

  if (id && lidJid) {
    if (isLidJid(lidJid) && isPhoneJid(id)) {
      registerLidPhoneMapping(lidJid, id);
    } else if (isLidJid(id) && isPhoneJid(lidJid)) {
      registerLidPhoneMapping(id, lidJid);
    }
  }

  if (id && pnJid && isLidJid(id)) {
    registerLidPhoneMapping(id, pnJid);
  }
}

export function registerContactLidMapping(contact: {
  id?: string | null;
  lid?: string | null;
  jid?: string | null;
}): void {
  if (contact.lid && contact.jid) {
    registerLidPhoneMapping(contact.lid, contact.jid);
  }

  if (contact.lid && contact.id && isPhoneJid(contact.id)) {
    registerLidPhoneMapping(contact.lid, contact.id);
  }

  if (contact.id && isLidJid(contact.id) && contact.jid) {
    registerLidPhoneMapping(contact.id, contact.jid);
  }
}

function resolvePhoneFromLid(lidJid: string, phoneJid?: string | null): string | null {
  if (phoneJid && isPhoneJid(phoneJid)) {
    const phone = jidToPhoneDigits(phoneJid);
    if (phone) {
      registerLidPhoneMapping(lidJid, phoneJid);
      return phone;
    }
  }

  const cached = lidToPhoneCache.get(jidToPhoneDigits(lidJid));
  return cached ?? null;
}

function resolveDirectChatPhone(
  remoteJid: string,
  options?: { senderPn?: string | null; fromMe?: boolean; resolvedPeerPn?: string | null },
): string | null {
  if (options?.resolvedPeerPn) {
    return options.resolvedPeerPn;
  }

  if (isLidJid(remoteJid)) {
    if (options?.fromMe) {
      return resolvePhoneFromLid(remoteJid);
    }

    return resolvePhoneFromLid(remoteJid, options?.senderPn);
  }

  const phone = jidToPhoneDigits(remoteJid);
  return phone || null;
}

/** Resuelve el teléfono del contacto en un chat 1:1 (entrante o saliente). */
export function resolveChatPeerPhone(key: ExtendedMessageKey, fromMe = false): string | null {
  const remoteJid = key.remoteJid ?? '';

  if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
    return null;
  }

  const resolved = resolveDirectChatPhone(remoteJid, {
    senderPn: key.senderPn,
    fromMe,
    resolvedPeerPn: key.resolvedPeerPn,
  });
  if (resolved) {
    return resolved;
  }

  if (!fromMe || !isLidJid(remoteJid)) {
    return null;
  }

  const phoneHints = [key.participantPn, key.participant].filter(Boolean) as string[];
  for (const hint of phoneHints) {
    if (!isPhoneJid(hint)) {
      continue;
    }

    const phone = jidToPhoneDigits(hint);
    if (phone) {
      registerLidPhoneMapping(remoteJid, hint);
      return phone;
    }
  }

  return null;
}

export function resolveInboundSenderPhone(key: ExtendedMessageKey): string | null {
  const remoteJid = key.remoteJid ?? '';
  const isGroup = remoteJid.endsWith('@g.us');

  if (isGroup) {
    const participant = key.participant ?? '';

    if (key.participantPn) {
      if (isLidJid(participant)) {
        registerLidPhoneMapping(participant, key.participantPn);
      }
      return jidToPhoneDigits(key.participantPn) || null;
    }

    if (participant && !isLidJid(participant)) {
      return jidToPhoneDigits(participant) || null;
    }

    if (isLidJid(participant)) {
      return resolvePhoneFromLid(participant, key.participantPn);
    }

    return null;
  }

  return resolveDirectChatPhone(remoteJid, {
    senderPn: key.senderPn,
    resolvedPeerPn: key.resolvedPeerPn,
  });
}

export function getCachedPhoneForJid(jid: string): string | null {
  if (isPhoneJid(jid)) {
    return jidToPhoneDigits(jid) || null;
  }

  if (isLidJid(jid)) {
    return lidToPhoneCache.get(jidToPhoneDigits(jid)) ?? null;
  }

  return null;
}

export function toLidJid(value: string): string {
  if (value.includes('@')) {
    return value;
  }

  return `${value.replace(/\D/g, '')}@lid`;
}

export function lidValuesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) {
    return false;
  }

  const digitsA = a.replace(/\D/g, '');
  const digitsB = b.replace(/\D/g, '');
  return digitsA.length > 0 && digitsA === digitsB;
}
