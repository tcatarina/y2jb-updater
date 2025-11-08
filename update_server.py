#!/usr/bin/env python3

import http.server
import socketserver
import json
import os
from pathlib import Path

PORT = 9090
SOURCE_DIR = Path("download0/cache/splash_screen/aHR0cHM6Ly93d3cueW91dHViZS5jb20vdHY=")

class HybridUpdateHandler(http.server.SimpleHTTPRequestHandler):
    
    def do_GET(self):
        if self.path == "/list_all_with_sizes":
            try:
                print(f"\n--- Received request to /list_all_with_sizes ---")
                if not SOURCE_DIR.is_dir():
                    raise FileNotFoundError(f"Source directory not found: {SOURCE_DIR}")
                
                all_files = [{"name": f.name, "size": f.stat().st_size} 
                             for f in SOURCE_DIR.iterdir() if f.is_file()]
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(all_files).encode())
                print("--- Sent file list with sizes to PS5 successfully. ---\n")

            except Exception as e:
                print(f"ERROR in /list_all_with_sizes: {e} !!!")
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())

        elif self.path.startswith("/download/"):
            filename = self.path[10:]
            file_path = SOURCE_DIR / filename
            
            try:
                print(f"\n--- Received request to /download/{filename} ---")
                if not file_path.is_file():
                    raise FileNotFoundError(f"File not found: {file_path}")

                with open(file_path, 'rb') as f:
                    content = f.read()
                
                self.send_response(200)
                self.send_header('Content-type', 'application/octet-stream')
                self.send_header('Content-Length', len(content))
                self.end_headers()
                self.wfile.write(content)
                print(f"--- Served {len(content)} bytes for {filename} successfully. ---\n")
                
            except Exception as e:
                print(f"!!! Error downloading {filename}: {e} !!!")
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())
        
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not Found")
    
    def log_message(self, format, *args):
        pass 

def main():
    print("=" * 60)
    print("Y2JB Update Server")
    print("=" * 60)
    if not SOURCE_DIR.is_dir():
        print(f"ERROR: Source directory not found at '{SOURCE_DIR}'")
        print("Please make sure you are running this script from the root of the Y2JB repository.")
        return
        
    print(f"Serving files from: {SOURCE_DIR.resolve()}")
    print(f"Starting server on port {PORT}...")
    print("=" * 60)
    print(f"\nServer running at http://0.0.0.0:{PORT}")
    print("Waiting for PS5 connection...\n")
    
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", PORT), HybridUpdateHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\nShutting down server...")
            httpd.shutdown()

if __name__ == "__main__":
    main()
