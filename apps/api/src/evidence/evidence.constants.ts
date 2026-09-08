/**
 * What a participant may attach to a report.
 *
 * One image, and only these three types. The list is an allowlist rather than a block list
 * because the failure mode of getting it wrong is storing something that is executed rather
 * than displayed: an SVG is an image to a human and a script host to a browser, which is why
 * it is absent and must stay absent.
 */
export const ALLOWED_EVIDENCE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type EvidenceContentType = (typeof ALLOWED_EVIDENCE_TYPES)[number];

/**
 * 6 MB. A modern phone photo is 2-4 MB, and this is the ceiling a participant hits by
 * uploading an unresized original rather than by attacking anything.
 *
 * The real defence is not this number, it is that the stream is abandoned the moment it is
 * exceeded -- see EvidenceService. A limit checked only after the body is buffered is a limit
 * that has already cost you the memory it was supposed to protect.
 */
export const MAX_EVIDENCE_BYTES = 6 * 1024 * 1024;

/** The GridFS bucket. Its collections are `evidence.files` and `evidence.chunks`. */
export const EVIDENCE_BUCKET = 'evidence';

/**
 * The first bytes of each allowed format.
 *
 * A `Content-Type` header is a claim by the client (rule 2), so it is checked against what the
 * bytes actually are. Without this, "image/png" plus an HTML payload is stored and later
 * served back, and the only thing standing between that and a stored XSS is the download
 * headers on the read route.
 */
export const MAGIC_BYTES: Record<EvidenceContentType, number[][]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  // RIFF....WEBP -- bytes 0-3 and 8-11, so the check is split.
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
};

export function looksLikeType(head: Buffer, type: EvidenceContentType): boolean {
  const signatures = MAGIC_BYTES[type];
  const matchesPrefix = signatures.some((sig) =>
    sig.every((byte, i) => head[i] === byte),
  );
  if (!matchesPrefix) return false;
  if (type === 'image/webp') {
    // RIFF is a container; the format lives at offset 8.
    return head.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return true;
}
