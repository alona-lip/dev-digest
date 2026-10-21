/** Bytes → base64 (chunked: `String.fromCharCode(...bigArray)` overflows the stack). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** `.md` / `.zip` only (the server re-checks; this just gives instant feedback). */
export function isImportable(filename: string): boolean {
  return /\.(md|markdown|zip)$/i.test(filename);
}


/** File bytes; `File.arrayBuffer` where it exists, FileReader otherwise (older browsers, jsdom). */
export function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
