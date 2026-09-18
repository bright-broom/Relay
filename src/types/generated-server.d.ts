// Only the generated server bundle uses this suffix. The source handler defines
// its actual contract; strict checks never treat the generated module as `any`.
declare module '*.relay-server.mjs' {
  const handler: typeof import('../server/handler.js').default;
  export default handler;
}
