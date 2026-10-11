import type { PageServerLoad } from './$types';

export const load = (({ setHeaders }: Pick<Parameters<PageServerLoad>[0], 'setHeaders'>) => {
	setHeaders({ 'cache-control': 'no-store' });
	return { initialTime: Date.now() };
}) satisfies PageServerLoad;
