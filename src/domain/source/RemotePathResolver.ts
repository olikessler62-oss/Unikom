/**
 * The one place that turns what somebody typed into a path a server accepts.
 *
 * Operators do not know the physical layout of the server they fetch from, and
 * they should not have to. They know the directory their files are in —
 * "orders/incoming" — and they write it the way their keyboard and their habits
 * suggest: with a leading slash or without, with backslashes because Windows,
 * with a trailing slash because that is how a directory looks, with a doubled
 * slash because two paths were pasted together. All of those mean the same
 * directory, and all of them arrive here.
 *
 * **The working directory is the root, not the server's root.** A server may
 * put its users in a chroot or a virtual directory, so `/` on the wire is not
 * the machine's `/`. Unikom therefore never assumes what `/` points at: a path
 * is resolved against the working directory the connection was given, and a
 * leading slash is a spelling of "from there", not a way past it.
 *
 * That also makes the working directory the boundary. `..` may walk inside it
 * and is refused at its edge — refused, not silently clamped, because a job
 * that quietly fetches from somewhere other than it was told to is the kind of
 * failure nobody notices.
 *
 * Protocol-free on purpose: SFTP and FTPS differ in how they list a directory
 * and in nothing that matters here. An `SftpPathResolver` next to an
 * `FtpsPathResolver` would be two chances to disagree about `..`.
 */

/** A path that cannot be used, with the reason an operator can act on. */
export class RemotePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemotePathError';
  }
}

/** Splits on either separator and drops what carries no name. */
function segmentsOf(value: string): string[] {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0);
}

function pathOf(segments: string[]): string {
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/** Whether `segments` begins with every segment of `prefix` — segment-wise. */
function startsWithSegments(segments: string[], prefix: string[]): boolean {
  return prefix.length <= segments.length && prefix.every((segment, index) => segments[index] === segment);
}

export class RemotePathResolver {
  private readonly baseSegments: string[];

  /**
   * @param remoteWorkingDirectory Where this connection starts. Absent means
   * `/` — the login directory of the account, whatever the server maps that to.
   */
  constructor(remoteWorkingDirectory?: string) {
    const trimmed = (remoteWorkingDirectory ?? '').trim();
    const segments: string[] = [];

    for (const segment of segmentsOf(trimmed)) {
      if (segment === '.') {
        continue;
      }

      if (segment === '..') {
        if (segments.length === 0) {
          throw new RemotePathError(
            `Das Remote-Arbeitsverzeichnis „${remoteWorkingDirectory}“ führt über seine eigene Wurzel hinaus. ` +
              'Bitte das Verzeichnis eintragen, in dem das Konto startet, etwa /customer123.'
          );
        }

        segments.pop();
        continue;
      }

      segments.push(segment);
    }

    this.baseSegments = segments;
  }

  /** The starting point, normalised: `/` or `/customer123`. */
  get workingDirectory(): string {
    return pathOf(this.baseSegments);
  }

  /**
   * What the user typed, as a path for the server.
   *
   * An input that is already absolute *and* already starts with the working
   * directory is taken as it is. Without that, a path copied out of the
   * directory browser — which shows server paths — would be appended to the
   * working directory a second time. The price is that a subdirectory named
   * exactly like the working directory cannot be reached with a leading slash;
   * it can be reached by its relative name, which is the spelling the browser
   * writes into the field anyway.
   */
  resolve(userPath: string): string {
    const entered = userPath.trim();
    const raw = segmentsOf(entered);
    const absolute = entered.startsWith('/') || entered.startsWith('\\');
    const alreadyResolved = absolute && startsWithSegments(raw, this.baseSegments);

    const segments = alreadyResolved ? [] : [...this.baseSegments];
    const floor = segments.length;

    for (const segment of raw) {
      if (segment === '.') {
        continue;
      }

      if (segment === '..') {
        if (segments.length <= floor) {
          throw new RemotePathError(
            `„${userPath}“ führt aus ${this.workingDirectory} heraus, und dieses Verzeichnis darf diese ` +
              'Verbindung nicht verlassen. Bitte einen Pfad darin verwenden — oder das Remote-Arbeitsverzeichnis ändern.'
          );
        }

        segments.pop();
        continue;
      }

      segments.push(segment);
    }

    // Reached when the input was absolute and its own `..` walked out of the
    // working directory it started in — the check above cannot see that,
    // because the walk began below the floor.
    if (!this.contains(pathOf(segments))) {
      throw new RemotePathError(
        `„${userPath}“ führt aus ${this.workingDirectory} heraus, und dieses Verzeichnis darf diese ` +
          'Verbindung nicht verlassen. Bitte einen Pfad darin verwenden — oder das Remote-Arbeitsverzeichnis ändern.'
      );
    }

    return pathOf(segments);
  }

  /**
   * Every directory this input could mean, in the order they are tried.
   *
   * There is more than one reading exactly when somebody types a path that
   * already begins with the working directory. `/customer123/orders` under
   * `/customer123` can mean the directory of that name — or a directory
   * `customer123` inside it, because servers really do carry the customer
   * number twice, and so do doubled subdirectories like `orders/orders`.
   *
   * Guessing between them is what must not happen. So the resolver names both
   * and the caller asks the server which one is there: one hit is the answer,
   * two hits is a question for the operator, none is a path that does not
   * exist. `resolve` returns the first of these — the rule a scheduled run
   * follows when nobody is there to ask.
   */
  candidates(userPath: string): string[] {
    const entered = userPath.trim();
    const raw = segmentsOf(entered);
    const absolute = entered.startsWith('/') || entered.startsWith('\\');

    if (!absolute || !startsWithSegments(raw, this.baseSegments) || this.baseSegments.length === 0) {
      return [this.resolve(userPath)];
    }

    // Read once as it stands, once as a path below the working directory.
    const asWritten = this.resolve(userPath);
    const belowBase = pathOf([...this.baseSegments, ...raw]);

    return asWritten === belowBase ? [asWritten] : [asWritten, belowBase];
  }

  /**
   * Whether a path the server named lies inside the allowed area.
   *
   * Compared segment by segment, never as text: `/customer1234` starts with the
   * characters of `/customer123` and is a different customer's directory.
   *
   * Takes a path the server gave us, and resolves nothing — that is the whole
   * point of asking.
   */
  contains(serverPath: string): boolean {
    return startsWithSegments(segmentsOf(serverPath), this.baseSegments);
  }

  /**
   * A server path as the user should see and type it: without the working
   * directory in front. This is what the directory browser writes back into
   * the input field.
   */
  relative(serverPath: string): string {
    const segments = segmentsOf(serverPath);

    return this.contains(serverPath) ? segments.slice(this.baseSegments.length).join('/') : segments.join('/');
  }

  /**
   * A directory plus one entry of it. Used where a listing is walked, so that
   * the adapters hold no path arithmetic of their own.
   */
  join(parentServerPath: string, name: string): string {
    if (name.includes('/') || name.includes('\\')) {
      throw new RemotePathError(
        `Der Server nennt „${name}“ als Eintrag, und ein Name darf keinen Pfad enthalten.`
      );
    }

    return pathOf([...segmentsOf(parentServerPath), ...segmentsOf(name)]);
  }

  /** The directory above, for walking up in the browser; never above the root. */
  parentOf(serverPath: string): string {
    const segments = segmentsOf(serverPath);

    return segments.length > this.baseSegments.length ? pathOf(segments.slice(0, -1)) : this.workingDirectory;
  }
}
