import { timingSafeEqual } from 'node:crypto';

export function configuredTrmnlToken(token: string | undefined): token is string {
	return typeof token === 'string' && /^[\x21-\x7e]{32,256}$/.test(token);
}

export function authorizedTrmnl(header: string | null, token: string): boolean {
	const match = /^Bearer[ \t]+([\x21-\x7e]+)$/i.exec(header ?? '');
	if (!match) return false;
	const supplied = Buffer.from(match[1]);
	const expected = Buffer.from(token);
	return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
