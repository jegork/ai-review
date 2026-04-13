import type { TicketInfo, TicketProvider, TicketRef } from "../types.js";

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
      console.warn(`failed to fetch ticket ${ref.id} from ${ref.source}:`, err);
    }
  }

  return results;
}
