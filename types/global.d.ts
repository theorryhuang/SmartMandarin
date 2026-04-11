// Allow importing CSS files in TypeScript (handled by Next.js at build time)
declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}
