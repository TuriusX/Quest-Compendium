# Pilot step 1: does the Deck feel good as the PC's controller?

Two small test tools (not part of the apps). See docs/proposals/deck-controller-pilot.md.

## On the PC (once)

1. Install the virtual controller (this installs the ViGEmBus driver; Windows asks for permission):

   ```powershell
   py -m pip install vgamepad
   ```

2. Start the receiver and leave it open. Allow Python on private networks if Windows asks.

   ```powershell
   py pilot\deck-controller\pc_receiver.py
   ```

## On the Deck

1. Switch to Desktop Mode (Steam button, Power, Switch to Desktop).
2. Copy `deck_sender.py` to the Deck (a USB stick, or download it from the repository in the Deck's browser).
3. Open Konsole and run it. It finds the PC by itself (both on the same network):

   ```
   python3 deck_sender.py
   ```

   If it can't find the PC, give the PC's address: `python3 deck_sender.py 192.168.1.20`.

## What to look at

- The Deck prints a line a second: updates sent, the round trip to the PC and back (median and worst), packets lost,
  and the buttons it sees. The round trip shown includes up to 4 ms of waiting for the next report, so real lag is a
  little lower.
- Start a game on the PC that supports a controller and play for ten minutes. Does it feel right?
- In Desktop Mode the Deck's buttons also do desktop things (the right trackpad moves the Deck's mouse, and so on).
  That's only the test setup: the real app would run in Game Mode.

## If the buttons look wrong

`python3 deck_sender.py --raw` prints the controller's raw data; send a few lines back.
`--fake` (on any computer) sends a circling left stick and a blinking A button, to test the PC side without a Deck.
