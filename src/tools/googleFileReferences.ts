const GOOGLE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{3,}$/;

export type GoogleReferenceKind = 'drive' | 'docs' | 'sheets' | 'slides' | 'unknown';

export interface ResolvedGoogleFileReference {
  original: string;
  fileId: string;
  kind: GoogleReferenceKind;
}

function inferKindFromUrl(url: URL): GoogleReferenceKind {
  if (url.hostname === 'docs.google.com') {
    if (url.pathname.includes('/document/')) return 'docs';
    if (url.pathname.includes('/spreadsheets/')) return 'sheets';
    if (url.pathname.includes('/presentation/')) return 'slides';
  }

  if (url.hostname === 'drive.google.com') {
    return 'drive';
  }

  return 'unknown';
}

export function resolveGoogleFileReference(value: string): ResolvedGoogleFileReference {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('File reference is required');
  }

  if (GOOGLE_FILE_ID_PATTERN.test(trimmed)) {
    return {
      original: value,
      fileId: trimmed,
      kind: 'unknown',
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      original: value,
      fileId: trimmed,
      kind: 'unknown',
    };
  }

  const pathnameMatch = url.pathname.match(/\/d\/([A-Za-z0-9_-]{3,})/);
  const queryId = url.searchParams.get('id');
  const fileId = pathnameMatch?.[1] ?? (queryId && GOOGLE_FILE_ID_PATTERN.test(queryId) ? queryId : null);

  if (!fileId) {
    throw new Error(`Could not extract a Google file ID from: ${value}`);
  }

  return {
    original: value,
    fileId,
    kind: inferKindFromUrl(url),
  };
}
