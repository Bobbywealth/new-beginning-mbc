// Root shim: forwards to the real server in backend/server.js
// This lets the new-beginning-mbc-api Render service use the
// "node server.js" startCommand without needing rootDir configuration.
require('./backend/server.js');