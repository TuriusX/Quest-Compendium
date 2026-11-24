/**
 * A press of the controller's A on a control in the panel (ControllerLayer) never sends a question (owner, Nov 23
 * 2026: "I don't want pressing a button in the controller to ask a question when the controller is connected. It can
 * lead to accidental waste of questions for players. Only when using the fan out wheel."). The click A makes runs
 * inside padClick(); the app's ask functions check padClicking() first and do nothing while it's set. The quick menu
 * (the wheel) and the on-screen keyboard's Send ask as before: they don't go through here.
 */
let clicking = false;

export function padClick(fn: () => void): void {
  clicking = true;
  try {
    fn();
  } finally {
    clicking = false;
  }
}

export const padClicking = (): boolean => clicking;
