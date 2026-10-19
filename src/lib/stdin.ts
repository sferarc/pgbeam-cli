/** Read all of stdin as UTF-8. */
export async function readStdin(
  stream: AsyncIterable<string | Uint8Array> = process.stdin,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}
