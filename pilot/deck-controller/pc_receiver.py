#!/usr/bin/env python3
"""Pilot step 1 (Nov 20 2026): the PC side. Takes the Steam Deck's controls from the network (deck_sender.py) and
feeds a virtual Xbox 360 controller that games see as a real one.

Run on the PC:   py pc_receiver.py          (needs: py -m pip install vgamepad, which installs the ViGEmBus driver)
                 py pc_receiver.py --dry     no virtual controller: only shows what arrives (for testing)

Every packet is echoed back so the Deck can show the round trip. Packets older than the newest are dropped; if none
arrive for half a second, every button is let go. Windows asks once to allow Python on private networks: allow it.
"""
import socket, struct, sys, time

PORT = 27500
MAGIC = b"QCP1"
FMT = "<IIHBBBhhhh"
SIZE = 4 + struct.calcsize(FMT)


def main():
    dry = "--dry" in sys.argv
    pad = None
    if not dry:
        try:
            import vgamepad
            pad = vgamepad.VX360Gamepad()
            print("Virtual Xbox 360 controller created.")
        except Exception as e:  # noqa: BLE001
            print(f"No virtual controller ({e}).\nInstall it with:  py -m pip install vgamepad   (it installs the ViGEmBus driver). Showing what arrives only.")

    def apply(btn=0, lt=0, rt=0, lx=0, ly=0, rx=0, ry=0):
        if not pad:
            return
        r = pad.report
        r.wButtons, r.bLeftTrigger, r.bRightTrigger = btn, lt, rt
        r.sThumbLX, r.sThumbLY, r.sThumbRX, r.sThumbRY = lx, ly, rx, ry
        pad.update()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("0.0.0.0", PORT))
    sock.settimeout(0.1)
    print(f"Waiting for the Deck on port {PORT}. Ctrl+C to stop.")
    newest, count, late, last_at, last_print, active, state = 0, 0, 0, 0.0, time.time(), False, None
    try:
        while True:
            try:
                data, addr = sock.recvfrom(128)
            except socket.timeout:
                data = None
            now = time.time()
            if data:
                if data.startswith(b"QCP-DISCOVER"):
                    sock.sendto(b"QCP-HERE", addr)
                elif data[:4] == MAGIC and len(data) >= SIZE:
                    seq, _ms, btn, extras, lt, rt, lx, ly, rx, ry = struct.unpack_from(FMT, data, 4)
                    sock.sendto(data[:SIZE], addr)  # the echo: the Deck measures the round trip
                    # A sender that started again counts from 1.
                    if seq < newest and newest - seq > 1000:
                        newest = 0
                    if seq <= newest:
                        late += 1
                    else:
                        newest = seq
                        state = (btn, lt, rt, lx, ly, rx, ry, extras)
                        apply(btn, lt, rt, lx, ly, rx, ry)
                        count += 1
                        last_at = now
                        if not active:
                            active = True
                            print(f"Deck connected from {addr[0]}.")
            if active and now - last_at > 0.5:
                active = False
                apply()
                print("Deck stopped sending: every button let go.")
            if now - last_print >= 1:
                if active and state:
                    print(f"{count:4d}/s  out of order {late}  | buttons {state[0]:#06x} grips {state[7]:#03x}  LT {state[1]} RT {state[2]}  L({state[3]},{state[4]}) R({state[5]},{state[6]})")
                count, late, last_print = 0, 0, now
    except KeyboardInterrupt:
        apply()
        print("\nStopped.")


if __name__ == "__main__":
    main()
