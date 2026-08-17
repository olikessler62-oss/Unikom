/**
 * The vendor's public key. It decides whether an installation checks licences
 * at all.
 *
 * Empty here on purpose: the repository, the tests and the demo are not a
 * licensing exercise, and an installation without a key runs unlicensed — every
 * module available, no paid period, a line in the log saying so.
 *
 * A distribution build puts the real key in. From then on that installation
 * expects a valid licence and stops starting transfers without one. Generate the
 * pair with `npm run licence -- keys`, keep the private half in the vendor's key
 * store, and paste the public half here.
 *
 * The environment variable below is deliberately only a fallback for the empty
 * case: if a key is built in, it wins. Otherwise a customer could point their
 * installation at a key of their own and issue themselves licences.
 */
export const BUILT_IN_LICENCE_PUBLIC_KEY = '';

/**
 * Which key this installation verifies with, or undefined when it verifies
 * nothing. `UNIKOM_LICENCE_PUBLIC_KEY` exists so tests and a vendor's own
 * staging installation can exercise the licensed behaviour without a rebuild.
 */
export function licencePublicKey(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  if (BUILT_IN_LICENCE_PUBLIC_KEY.trim() !== '') {
    return BUILT_IN_LICENCE_PUBLIC_KEY.trim();
  }

  const configured = environment.UNIKOM_LICENCE_PUBLIC_KEY?.trim();

  return configured ? configured : undefined;
}
