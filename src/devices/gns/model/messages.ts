import type { SimMessage } from '../../../sim/types';
import { MESSAGES } from './watch';

/*
 * The MSG page shows what a GNS itself would announce. The simulator's
 * shared message list also carries annunciator-panel and autopilot alerts
 * (LOW VOLTS, OIL PRESSURE, STALL, "Autopilot disconnected") the unit never
 * sees, terrain alerts it shows as pop-ups instead, and airspace advisories
 * (the unit's airspace alarms are off by factory default). Messages it does
 * share are shown in its own wording.
 */

/** Simulator messages the unit gives, in its words. */
const IN_GNS_WORDS: Readonly<Record<string, string>> = {
  'GPS NAVIGATION LOST': 'Loss of GPS Navigation - Use other NAV if available',
};

/** Messages the unit posts itself (see watch.ts). */
const OWN: readonly string[] = [MESSAGES.frequency, MESSAGES.vloc, MESSAGES.notActive];
const ownMessage = (text: string) => OWN.includes(text) || text.startsWith(MESSAGES.arrival(''));

/** The unit's messages, newest last. */
export function unitMessages(messages: readonly SimMessage[]): SimMessage[] {
  const out: SimMessage[] = [];
  for (const m of messages) {
    const words = IN_GNS_WORDS[m.text];
    if (words) out.push({ ...m, text: words });
    else if (ownMessage(m.text)) out.push(m);
  }
  return out;
}

/** The MSG annunciator flashes while any of the unit's messages is unread. */
export const hasUnread = (messages: readonly SimMessage[]) => unitMessages(messages).some((m) => !m.read);
