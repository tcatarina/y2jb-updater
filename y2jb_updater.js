// Make sure to change this to your computer's IP (not the PS5 one)
const UPDATE_SERVER_IP = "192.168.98.178";

const UPDATE_SERVER_PORT = 9090;

const TARGET_DIR =
  "/download0/cache/splash_screen/aHR0cHM6Ly93d3cueW91dHViZS5jb20vdHY=";

async function closeYouTubeApp() {
  try {
    await log("=== Closing YouTube app ===");

    await log("Applying updates...");

    const SYS_GETPID = 0x14n;
    const SYS_KILL = 0x25n;
    const SIGKILL = 0x9n;

    const pid = syscall(SYS_GETPID);
    await log("Current PID: " + toHex(pid));

    await log("Sending SIGKILL to close the app...");

    await new Promise((resolve) => setTimeout(resolve, 2000));

    syscall(SYS_KILL, pid, SIGKILL);
  } catch (e) {
    await log("ERROR closing YouTube: " + e.message);
    send_notification("Failed to close app: " + e.message);
  }
}

async function main() {
  try {
    await log("=== Y2JB Updater Payload ===");

    send_notification("Y2JB Updater Starting...");

    if (UPDATE_SERVER_IP === "192.168.98.178") {
      await log(
        "Default IP detected, please make sure to update the variable UPDATE_SERVER_IP" +
          " in the y2jb_updater.js",
      );

      send_notification(`Y2JB Updater Terminated.`);

      return;
    }

    const SYSCALL = {
      read: 3n,
      write: 4n,
      open: 5n,
      close: 6n,
      unlink: 10n,
      mkdir: 136n,
      socket: 97n,
      connect: 98n,
    };
    const O_WRONLY = 0x1n,
      O_CREATE = 0x200n,
      O_TRUNC = 0x400n;

    function parseIP(ip_str) {
      const parts = ip_str.split(".");
      return (
        (parseInt(parts[0]) |
          (parseInt(parts[1]) << 8) |
          (parseInt(parts[2]) << 16) |
          (parseInt(parts[3]) << 24)) >>>
        0
      );
    }

    async function connectToServer() {
      const sock = syscall(SYSCALL.socket, 2n, 1n, 0n);
      if (Number(sock) < 0)
        throw new Error(`Socket creation failed: ${Number(sock)}`);
      const sockaddr = malloc(16);
      write8(sockaddr + 1n, 2n);
      const port_be =
        ((UPDATE_SERVER_PORT & 0xff) << 8) | ((UPDATE_SERVER_PORT >> 8) & 0xff);
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
        for (let i = 0; i < n; i++)
          response += String.fromCharCode(Number(read8(buffer + BigInt(i))));
      }
      const parts = response.split("\r\n\r\n");
      if (parts.length < 2) throw new Error("Invalid HTTP response");
      return parts[1];
    }

    function httpGet(sock, path) {
      const request = `GET ${path} HTTP/1.1\r\nHost: ${UPDATE_SERVER_IP}\r\nConnection: close\r\n\r\n`;
      syscall(
        SYSCALL.write,
        sock,
        alloc_string(request),
        BigInt(request.length),
      );
    }

    async function downloadAndSaveFile(filename) {
      let sock;
      let fd = -1n;
      try {
        sock = await connectToServer();
        httpGet(sock, `/download/${filename}`);

        const local_path_str = alloc_string(`${TARGET_DIR}/${filename}`);
        syscall(SYSCALL.unlink, local_path_str);

        const mode = filename === "splash.html" ? 0x124n : 0x1ffn;
        fd = BigInt.asIntN(
          64,
          syscall(
            SYSCALL.open,
            local_path_str,
            O_WRONLY | O_CREATE | O_TRUNC,
            mode,
          ),
        );

        if (fd < 0) {
          throw new Error(`Failed to open file, error: ${fd}`);
        }

        const buffer = malloc(8192);
        let total_written = 0;
        let header_found = false;
        let search_str = "";

        while (!header_found) {
          const bytes_read = Number(syscall(SYSCALL.read, sock, buffer, 8192n));

          if (bytes_read <= 0) {
            throw new Error("Connection closed before HTTP header was found.");
          }

          for (let i = 0; i < bytes_read; i++) {
            search_str += String.fromCharCode(
              Number(read8(buffer + BigInt(i))),
            );
          }

          const header_end_idx = search_str.indexOf("\r\n\r\n");

          if (header_end_idx !== -1) {
            header_found = true;

            const body_offset = header_end_idx + 4;

            if (body_offset < search_str.length) {
              const body_part = search_str.substring(body_offset);
              const body_buf = malloc(body_part.length);

              for (let i = 0; i < body_part.length; i++) {
                write8(body_buf + BigInt(i), body_part.charCodeAt(i));
              }

              const w = syscall(
                SYSCALL.write,
                fd,
                body_buf,
                BigInt(body_part.length),
              );

              if (Number(w) > 0) {
                total_written += Number(w);
              }
            }
          } else if (search_str.length > 16384) {
            throw new Error("Could not find HTTP header; response too large");
          }
        }

        while (true) {
          const n = syscall(SYSCALL.read, sock, buffer, 8192n);

          if (Number(n) <= 0) break;

          const w = syscall(SYSCALL.write, fd, buffer, n);

          if (Number(w) > 0) {
            total_written += Number(w);
          }
        }

        await log(`- Updated successfully (${total_written} bytes)`);
        return true;
      } catch (e) {
        await log(`- File download failed: ${e.message}`);
        return false;
      } finally {
        if (sock) syscall(SYSCALL.close, sock);
        if (fd >= 0) syscall(SYSCALL.close, fd);
      }
    }

    await log(`Ensuring target directory '${TARGET_DIR}' exists...`);
    syscall(SYSCALL.mkdir, alloc_string(TARGET_DIR), 0x1ffn);

    await log("Getting full file list...");
    await log(
      `Connecting to update server: ${UPDATE_SERVER_IP}:${UPDATE_SERVER_PORT}`,
    );

    let sock = await connectToServer();
    httpGet(sock, "/list_all_with_sizes");

    const response_body = readHttpResponse(sock);
    syscall(SYSCALL.close, sock);

    const filesToDownload = JSON.parse(response_body);

    await log(`Server responded: ${filesToDownload.length} files to download.`);

    let success_count = 0,
      fail_count = 0;

    for (const file of filesToDownload) {
      await log(`Downloading ${file.name}...`);
      try {
        let downloadSuccess = false;
        downloadSuccess = await downloadAndSaveFile(file.name);
        if (downloadSuccess) success_count++;
        else fail_count++;
      } catch (e) {
        await log(`- Failed with exception: ${e.message}`);
        fail_count++;
      }
    }

    await log(
      `=== Update complete! Updated: ${success_count}, Failed: ${fail_count} ===`,
    );

    send_notification(
      `Y2JB Updater Complete!\n${success_count} files updated.`,
    );

    if (fail_count === 0) {
      await closeYouTubeApp();
    }
  } catch (e) {
    await log(`ERROR: ${e.message}`);
    await log(e.stack);
    send_notification(`Update failed: ${e.message}`);
  }
}
main();
