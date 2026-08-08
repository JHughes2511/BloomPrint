import { api } from './client';
import type { UploadProgress } from './client';

/**
 * A game film, sent to storage in pieces instead of in one breath.
 *
 * A three-hour game is several gigabytes. Sent as one request to the API — the
 * way this worked — it is a single connection that has to survive the entire
 * upload, often an hour, with no way to resume: a phone changing wifi, a laptop
 * sleeping, a proxy timing out, or a deploy restarting the server all end the
 * same way, "Upload failed — the connection dropped", with the hour thrown
 * away.
 *
 * Here the file is cut into ~32 MB parts and each is PUT straight to storage as
 * its own request. A dropped connection costs one part, which is retried, not
 * the film. Nothing about the bytes goes through the API server, which never had
 * a reason to see them.
 *
 * Falls back to the old single-request upload wherever direct upload isn't
 * configured (a dev box with no bucket), so one build works in both places.
 */
export type DirectUploadResult = { ref: string };

const RETRIES = 4;

/** Is the browser allowed to upload straight to storage? Asked once. */
let availability: Promise<{ direct: boolean; part_size: number }> | null = null;
export function directUploadAvailable() {
  if (!availability) {
    availability = api.get('/film-upload/available').then(r => r.data)
      .catch(() => ({ direct: false, part_size: 0 }));
  }
  return availability;
}

function putPart(url: string, blob: Blob, onBytes: (n: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    let lastLoaded = 0;
    xhr.upload.onprogress = (e) => {
      // Report the delta: the caller is adding up the whole film, and a retried
      // part must not count its bytes twice.
      onBytes(e.loaded - lastLoaded);
      lastLoaded = e.loaded;
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // The ETag identifies the part when the upload is assembled. Storage
        // quotes it; S3 wants it back exactly as given.
        const etag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag');
        if (!etag) return reject(new Error('Storage did not acknowledge a part.'));
        resolve(etag);
      } else {
        // Undo this attempt's contribution so a retry starts from where the
        // part began rather than inflating the total.
        onBytes(-lastLoaded);
        reject(new Error(`Part rejected (${xhr.status})`));
      }
    };
    xhr.onerror = () => { onBytes(-lastLoaded); reject(new Error('connection dropped')); };
    xhr.ontimeout = () => { onBytes(-lastLoaded); reject(new Error('timed out')); };
    xhr.send(blob);
  });
}

export async function uploadFilmDirect(
  file: Blob,
  opts: { purpose?: string; onProgress?: (p: UploadProgress) => void } = {},
): Promise<DirectUploadResult> {
  const { purpose = 'film', onProgress } = opts;
  const name = (file as File)?.name || 'film.mp4';
  const type = file.type || 'video/mp4';

  const start = await api.post('/film-upload/start', {
    filename: name, content_type: type, purpose,
  }).then(r => r.data);

  const partSize: number = start.part_size;
  const total = file.size;
  const count = Math.max(1, Math.ceil(total / partSize));
  const parts: { PartNumber: number; ETag: string }[] = [];

  let sent = 0;
  const bump = (delta: number) => {
    sent += delta;
    onProgress?.({ sent, total, fraction: total ? sent / total : 0 });
  };

  try {
    // Signed a batch at a time: a hundred-part film should not begin with a
    // hundred signatures, and a URL that expires mid-upload can be re-signed.
    const BATCH = 10;
    for (let first = 1; first <= count; first += BATCH) {
      const numbers = [];
      for (let n = first; n < first + BATCH && n <= count; n++) numbers.push(n);
      const { urls } = await api.post('/film-upload/sign', {
        key: start.key, upload_id: start.upload_id, part_numbers: numbers,
      }).then(r => r.data);

      for (const { part, url } of urls) {
        const from = (part - 1) * partSize;
        const blob = file.slice(from, Math.min(from + partSize, total));
        let etag: string | null = null;
        let lastError: any = null;
        for (let attempt = 0; attempt < RETRIES; attempt++) {
          try {
            etag = await putPart(url, blob, bump);
            break;
          } catch (e) {
            lastError = e;
            // Back off, then have another go at this part alone. This is the
            // whole point of the exercise: an hour of upload is no longer
            // riding on one unbroken connection.
            await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
          }
        }
        if (!etag) throw lastError ?? new Error('A part of the film could not be uploaded.');
        parts.push({ PartNumber: part, ETag: etag });
      }
    }

    const { ref } = await api.post('/film-upload/complete', {
      key: start.key, upload_id: start.upload_id, parts,
    }).then(r => r.data);
    return { ref };
  } catch (err) {
    // Abandoned parts sit in the bucket, invisible to a listing and billed for,
    // so an upload that gives up cleans up after itself.
    api.post('/film-upload/abort', { key: start.key, upload_id: start.upload_id })
      .catch(() => {});
    throw err;
  }
}
