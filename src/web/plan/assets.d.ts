// Vite `?raw` imports (file contents as a string) and CSS side-effect imports used by the plan import screen.
declare module '*?raw' {
  const text: string;
  export default text;
}
declare module '*.css';
