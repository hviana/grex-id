export function assertServerOnly(fileName: string): void {
  if (typeof window !== "undefined") {
    throw new Error(`${fileName} must not be imported in client-side code.`);
  }
}
