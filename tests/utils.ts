/**
 * Generates a random lowercase ASCII string (Latin letters [a-z]) using the
 * code points between 97 and 122.
 *
 * @param length - The length of the string.
 * @returns - The string.
 */
export function randomAsciiString(length: number): string {
  return Array.from({ length }, () => String.fromCharCode(Math.floor(Math.random() * (122 - 97)) + 97)).join("");
}

/**
 * Generates a random Unicode string using the code points between 0 and 65536.
 *
 * @param length - The length of the string.
 * @returns - The string.
 */
export function randomUnicodeString(length: number): string {
  return Array.from({ length }, () => String.fromCharCode(Math.floor(Math.random() * 65536))).join("");
}
