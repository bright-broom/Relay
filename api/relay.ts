// Vercel traces the generated ESM bundle and its external packages. Bundling the
// TS/TSX graph first avoids relying on the host's source-extension tracing.
import handler from '../.vercel/server/app.relay-server.mjs';
/** @public Vercel invokes this default export as the Node.js function entry. */
export default handler;
