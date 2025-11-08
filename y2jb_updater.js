// Make sure to change this to your computer's IP (not the PS5 one)
const UPDATE_SERVER_IP = "192.168.1.56";

const UPDATE_SERVER_PORT = 9090;

const TARGET_DIR = "/download0/cache/splash_screen/aHR0cHM6Ly93d3cueW91dHViZS5jb20vdHY=";

const LARGE_FILE_THRESHOLD = 100 * 1024; 

async function main() {
    try {
        await log("=".repeat(40));
        await log("Y2JB Updater Payload");
        await log("=".repeat(40));
        
        send_notification("Y2JB Updater Starting...");
        
        const SYSCALL = {
            read: 3n, write: 4n, open: 5n, close: 6n, unlink: 10n, mkdir: 136n, socket: 97n, connect: 98n
        };
        const O_WRONLY = 0x1n, O_CREATE = 0x200n, O_TRUNC = 0x400n;

        function parseIP(ip_str) {
            const parts = ip_str.split('.');
            return (parseInt(parts[0]) | (parseInt(parts[1]) << 8) | (parseInt(parts[2]) << 16) | (parseInt(parts[3]) << 24)) >>> 0;
        }
        
        async function connectToServer() {
            const sock = syscall(SYSCALL.socket, 2n, 1n, 0n);
            if (Number(sock) < 0) throw new Error(`Socket creation failed: ${Number(sock)}`);
            const sockaddr = malloc(16);
            write8(sockaddr + 1n, 2n);
            const port_be = ((UPDATE_SERVER_PORT & 0xff) << 8) | ((UPDATE_SERVER_PORT >> 8) & 0xff);
            write16(sockaddr + 2n, BigInt(port_be));
            write32(sockaddr + 4n, BigInt(parseIP(UPDATE_SERVER_IP)));
            const ret = syscall(SYSCALL.connect, sock, sockaddr, 16n);
            if (Number(ret) < 0) {
                syscall(SYSCALL.close, sock);
                throw new Error(`Connect failed: ${Number(ret)}`);
            }
            return sock;
        }

        function readHttpResponse(sock) {
            const buffer = malloc(8192);
            let response = "";
            while (true) {
                const n = Number(syscall(SYSCALL.read, sock, buffer, 8192n));
                if (n <= 0) break;
                for (let i = 0; i < n; i++) response += String.fromCharCode(Number(read8(buffer + BigInt(i))));
            }
            const parts = response.split('\r\n\r\n');
            if (parts.length < 2) throw new Error("Invalid HTTP response");
            return parts[1];
        }

        function httpGet(sock, path) {
            const request = `GET ${path} HTTP/1.1\r\nHost: ${UPDATE_SERVER_IP}\r\nConnection: close\r\n\r\n`;
            syscall(SYSCALL.write, sock, alloc_string(request), BigInt(request.length));
        }

        async function downloadAndInstall_Buffer(filename) {
            let sock = await connectToServer();
            httpGet(sock, `/download/${filename}`);
            
            let file_data = [];
            let in_body = false;
            let header_buf = "";
            const buffer = malloc(8192);
            
            while (true) {
                const n = Number(syscall(SYSCALL.read, sock, buffer, 8192n));
                if (n <= 0) break;
                for (let j = 0; j < n; j++) {
                    const byte = Number(read8(buffer + BigInt(j)));
                    if (!in_body) {
                        header_buf += String.fromCharCode(byte);
                        if (header_buf.includes('\r\n\r\n')) {
                            in_body = true;
                            const header_end = header_buf.indexOf('\r\n\r\n') + 4;
                            const remaining = header_buf.slice(header_end);
                            for (let k = 0; k < remaining.length; k++) file_data.push(remaining.charCodeAt(k));
                        }
                    } else {
                        file_data.push(byte);
                    }
                }
            }
            syscall(SYSCALL.close, sock);

            const local_path_str = alloc_string(`${TARGET_DIR}/${filename}`);
            syscall(SYSCALL.unlink, local_path_str);
            
            const fd = BigInt.asIntN(64, syscall(SYSCALL.open, local_path_str, O_WRONLY | O_CREATE | O_TRUNC, 0x1FFn));
            if (fd < 0) { await log(`- Failed to open file, error: ${fd}`); return false; }
            
            const write_buf = malloc(file_data.length);
            for (let j = 0; j < file_data.length; j++) write8(write_buf + BigInt(j), file_data[j]);
            
            const written = Number(BigInt.asIntN(64, syscall(SYSCALL.write, fd, write_buf, BigInt(file_data.length))));
            syscall(SYSCALL.close, fd);
            
            if (written !== file_data.length) { await log(`- Incomplete write: ${written} / ${file_data.length}`); return false; }
            await log(`- Updated successfully (${written} bytes)`);
            return true;
        }

        async function downloadAndInstall_Stream(filename) {
            let sock = await connectToServer();
            httpGet(sock, `/download/${filename}`);
            
            await new Promise(resolve => setTimeout(resolve, 200)); 
            
            const local_path_str = alloc_string(`${TARGET_DIR}/${filename}`);
            syscall(SYSCALL.unlink, local_path_str);
            
            const fd = BigInt.asIntN(64, syscall(SYSCALL.open, local_path_str, O_WRONLY | O_CREATE | O_TRUNC, 0x1FFn));
            if (fd < 0) { await log(`- Failed to open file, error: ${fd}`); syscall(SYSCALL.close, sock); return false; }
            
            const buffer = malloc(8192);
            let total_written = 0;

            const n1 = Number(syscall(SYSCALL.read, sock, buffer, 8192n));
            if (n1 > 0) {
                let header_end_pos = -1;
                for (let k = 0; k < n1 - 3; k++) {
                    if (read8(buffer + BigInt(k)) === 13 && read8(buffer + BigInt(k+1)) === 10 && read8(buffer + BigInt(k+2)) === 13 && read8(buffer + BigInt(k+3)) === 10) {
                        header_end_pos = k;
                        break;
                    }
                }
                if (header_end_pos !== -1) {
                    const data_start_offset = header_end_pos + 4;
                    const len = BigInt(n1 - data_start_offset);
                    if (len > 0) {
                        const w = syscall(SYSCALL.write, fd, buffer + BigInt(data_start_offset), len);
                        if (Number(w) > 0) total_written += Number(w);
                    }
                }
            }
            
            while (true) {
                const n = syscall(SYSCALL.read, sock, buffer, 8192n);
                if (Number(n) <= 0) break;
                const w = syscall(SYSCALL.write, fd, buffer, n);
                if (Number(w) > 0) total_written += Number(w);
            }
            syscall(SYSCALL.close, sock);
            syscall(SYSCALL.close, fd);
            await log(`- Updated successfully (${total_written} bytes)`);
            return true;
        }

        await log(`Ensuring target directory '${TARGET_DIR}' exists...`);
        syscall(SYSCALL.mkdir, alloc_string(TARGET_DIR), 0x1FFn);

        await log("Getting full file list...");
        let sock = await connectToServer();
        httpGet(sock, "/list_all_with_sizes");
        const response_body = readHttpResponse(sock);
        syscall(SYSCALL.close, sock);
        const filesToDownload = JSON.parse(response_body);
        await log(`Server responded: ${filesToDownload.length} files to download.`);

        let success_count = 0, fail_count = 0;

        for (const file of filesToDownload) {
            await log(`Downloading ${file.name}...`);
            try {
                let downloadSuccess = false;
                if (file.size > LARGE_FILE_THRESHOLD) {
                    downloadSuccess = await downloadAndInstall_Stream(file.name);
                } else {
                    downloadSuccess = await downloadAndInstall_Buffer(file.name);
                }
                if(downloadSuccess) success_count++; else fail_count++;
            } catch (e) {
                await log(`- Failed with exception: ${e.message}`);
                fail_count++;
            }
        }

        await log("=".repeat(40));
        await log(`Update complete! Updated: ${success_count}, Failed: ${fail_count}`);
        await log("=".repeat(40));

        send_notification(`Y2JB Updater Complete!\n${success_count} files updated.`);
    } catch (e) {
        await log(`ERROR: ${e.message}`);
        await log(e.stack);
        send_notification(`Update failed: ${e.message}`);
    }
}
main();
