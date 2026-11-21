#!/usr/bin/env python3
"""Pilot step 1 (Nov 20 2026): the Steam Deck's controls, sent to the PC over the home network.

Run on the Deck (Desktop Mode, Konsole):   python3 deck_sender.py            finds the PC by itself
                                           python3 deck_sender.py 192.168.1.20   or name the PC's address
Other modes:   --raw    print the controller's raw reports (to check the layout)
               --fake   no Deck needed: sends a moving stick and a blinking A button (for testing on any computer)

It reads the Deck's built-in controller directly (the hidraw device, 250 reports a second; Steam keeps working), sends
each state as one small UDP packet, and shows the round trip to the PC and back (the PC echoes every packet).
Only Python's standard library. Ctrl+C stops it; the PC lets go of every button when the packets stop.
"""
import glob, math, os, select, socket, struct, sys, time

PORT = 27500
MAGIC = b"QCP1"
# XInput button bits (what the PC's virtual Xbox controller takes).
UP, DOWN, LEFT, RIGHT, START, BACK, L3, R3, LB, RB, A, B, X, Y = 0x1, 0x2, 0x4, 0x8, 0x10, 0x20, 0x40, 0x80, 0x100, 0x200, 0x1000, 0x2000, 0x4000, 0x8000
NAMES = [(UP, "Up"), (DOWN, "Down"), (LEFT, "Left"), (RIGHT, "Right"), (START, "Menu"), (BACK, "View"), (L3, "L3"), (R3, "R3"), (LB, "L1"), (RB, "R1"), (A, "A"), (B, "B"), (X, "X"), (Y, "Y")]


def parse_deck(d: bytes):
    """A Deck controller report (64 bytes, type 0x09) -> (buttons, extras, lt, rt, lx, ly, rx, ry), or None.
    Layout as in the Linux kernel's hid-steam.c (steam_do_deck_input_event)."""
    if len(d) < 56 or d[0] != 0x01 or d[2] != 0x09:
        return None
    b8, b9, b10, b11, b13 = d[8], d[9], d[10], d[11], d[13]
    btn = 0
    for byte, bit, flag in ((b8, 7, A), (b8, 5, B), (b8, 6, X), (b8, 4, Y), (b8, 3, LB), (b8, 2, RB),
                            (b9, 0, UP), (b9, 1, RIGHT), (b9, 2, LEFT), (b9, 3, DOWN), (b9, 4, BACK), (b9, 6, START),
                            (b10, 6, L3), (b11, 2, R3)):
        if byte >> bit & 1:
            btn |= flag
    # The back grips (not on an Xbox pad): bit 0 L4, 1 R4, 2 L5, 3 R5. For the switch chord and "talk" later.
    extras = (b13 >> 1 & 1) | (b13 >> 2 & 1) << 1 | (b9 >> 7 & 1) << 2 | (b10 & 1) << 3
    lt, rt = struct.unpack_from("<hh", d, 44)
    lx, ly, rx, ry = struct.unpack_from("<hhhh", d, 48)
    trig = lambda v: max(0, min(255, v * 255 // 32767))
    return btn, extras, trig(lt), trig(rt), lx, ly, rx, ry


def find_deck():
    """The Deck controller's hidraw device: Valve's (28DE:1205) interface that sends type-0x09 reports."""
    for path in sorted(glob.glob("/sys/class/hidraw/hidraw*")):
        try:
            uevent = open(os.path.join(path, "device", "uevent")).read().upper()
        except OSError:
            continue
        if "28DE" not in uevent or "1205" not in uevent:
            continue
        dev = "/dev/" + os.path.basename(path)
        try:
            fd = os.open(dev, os.O_RDONLY | os.O_NONBLOCK)
        except OSError as e:
            print(f"  {dev}: can't open ({e.strerror})")
            continue
        end = time.time() + 0.5
        while time.time() < end:
            if select.select([fd], [], [], 0.1)[0]:
                try:
                    if parse_deck(os.read(fd, 64)):
                        return fd, dev
                except OSError:
                    break
        os.close(fd)
    return None, None


def discover(sock):
    """Ask the network who the PC is (the receiver answers a broadcast)."""
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    for _ in range(10):
        try:
            sock.sendto(b"QCP-DISCOVER", ("255.255.255.255", PORT))
        except OSError:
            pass
        if select.select([sock], [], [], 0.5)[0]:
            data, addr = sock.recvfrom(64)
            if data.startswith(b"QCP-HERE"):
                return addr[0]
    return None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    raw, fake = "--raw" in sys.argv, "--fake" in sys.argv
    fd = None
    if not fake:
        fd, dev = find_deck()
        if fd is None:
            sys.exit("Couldn't find the Deck's controller. Run this on the Steam Deck (or use --fake to test elsewhere).")
        print(f"Deck controller: {dev}")
    if raw:
        while True:
            if select.select([fd], [], [], 1)[0]:
                d = os.read(fd, 64)
                print(d[:16].hex(" "), "|", d[44:56].hex(" "), "|", parse_deck(d))
                time.sleep(0.1)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setblocking(False)
    host = args[0] if args else discover(sock)
    if not host:
        sys.exit("Couldn't find the PC. Start pc_receiver.py on the PC first, or give its address: python3 deck_sender.py 192.168.x.x")
    print(f"Sending to {host}:{PORT}. Ctrl+C to stop.")
    seq, sent, got, rtts, last_print, t0 = 0, 0, 0, [], time.time(), time.time()
    state = (0, 0, 0, 0, 0, 0, 0, 0)
    try:
        while True:
            if fake:
                time.sleep(0.004)
                t = time.time() - t0
                state = (A if int(t * 2) % 2 else 0, 0, 0, 0, int(math.cos(t * 2) * 30000), int(math.sin(t * 2) * 30000), 0, 0)
            else:
                if not select.select([fd], [], [], 0.05)[0]:
                    continue
                p = parse_deck(os.read(fd, 64))
                if not p:
                    continue
                state = p
            seq += 1
            now_ms = int(time.monotonic() * 1000) & 0xFFFFFFFF
            sock.sendto(MAGIC + struct.pack("<IIHBBBhhhh", seq, now_ms, state[0], state[1], state[2], state[3], *state[4:]), (host, PORT))
            sent += 1
            # Echoes from the PC: the round trip.
            while select.select([sock], [], [], 0)[0]:
                data, _ = sock.recvfrom(64)
                if data[:4] == MAGIC and len(data) >= 12:
                    then = struct.unpack_from("<I", data, 8)[0]
                    rtts.append(((int(time.monotonic() * 1000) & 0xFFFFFFFF) - then) & 0xFFFFFFFF)
                    got += 1
            if time.time() - last_print >= 1:
                held = " ".join(n for f, n in NAMES if state[0] & f) or "-"
                if rtts:
                    rtts.sort()
                    line = f"round trip median {rtts[len(rtts) // 2]} ms, worst {rtts[-1]} ms; lost {max(0, sent - got)} of {sent}"
                else:
                    line = "no answer from the PC"
                print(f"{sent:4d}/s  {line}  | buttons {held}  LT {state[2]} RT {state[3]}  L({state[4]},{state[5]}) R({state[6]},{state[7]})")
                sent, got, rtts, last_print = 0, 0, [], time.time()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
