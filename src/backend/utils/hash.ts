import crypto from 'node:crypto';

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function computeTtsTextHash(params: {
  contentType: string;
  transcript: string;
  language: string;
  voiceId: string;
}): string {
  const normalized = params.transcript.trim().replace(/\s+/g, ' ');
  return sha256(`${params.contentType}:${params.language}:${params.voiceId}:${normalized}`);
}
