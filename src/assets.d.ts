// Lets TypeScript import image files (Vite turns them into URLs at build time).
declare module '*.png' {
  const src: string;
  export default src;
}
