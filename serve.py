#!/usr/bin/env python3
import http.server, mimetypes
mimetypes.add_type('application/wasm', '.wasm')
mimetypes.add_type('text/turtle', '.ttl')
handler = http.server.SimpleHTTPRequestHandler
httpd = http.server.HTTPServer(('0.0.0.0', 8080), handler)
print("Serving on :8080")
httpd.serve_forever()
