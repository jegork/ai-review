import type { TicketInfo, TicketProvider, TicketRef } from "../types.js";
import { logger } from "../logger.js";

const MAX_TICKETS = 3;

export async function resolveTickets(
  refs: TicketRef[],
  providers: Map<string, TicketProvider>,
): Promise<TicketInfo[]> {
  const results: TicketInfo[] = [];

  for (const ref of refs.slice(0, MAX_TICKETS)) {
    const provider = providers.get(ref.source);
    if (!provider) continue;

    try {
      const info = await provider.fetchTicket(ref.id);
      if (info) results.push(info);
    } catch (err) {
      logger.warn({ ticketId: ref.id, source: ref.source, err }, "failed to fetch ticket");
    }
  }

  return results;
}
