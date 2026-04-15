import type { TicketInfo, TicketProvider, TicketRef, TicketResolutionStatus } from "../types.js";
import { logger } from "../logger.js";

const MAX_TICKETS = 3;

export async function resolveTicketsWithStatus(
  refs: TicketRef[],
  providers: Map<string, TicketProvider>,
): Promise<{ tickets: TicketInfo[]; status: TicketResolutionStatus }> {
  const results: TicketInfo[] = [];
  const refsToConsider = refs.slice(0, MAX_TICKETS);
  let consideredMissingProvider = 0;
  let consideredFetchFailed = 0;
  const startMs = Date.now();

  for (const ref of refsToConsider) {
    const provider = providers.get(ref.source);
    if (!provider) {
      consideredMissingProvider++;
      continue;
    }

    try {
      const info = await provider.fetchTicket(ref.id);
      if (info) {
        results.push(info);
      } else {
        consideredFetchFailed++;
      }
    } catch (err) {
      consideredFetchFailed++;
      logger.warn({ ticketId: ref.id, source: ref.source, err }, "failed to fetch ticket");
    }
  }

  const status: TicketResolutionStatus = {
    totalRefsFound: refs.length,
    refsConsidered: refsToConsider.length,
    refsSkippedByLimit: refs.length - refsToConsider.length,
    fetched: results.length,
    consideredMissingProvider,
    consideredFetchFailed,
  };

  const sources = [...new Set(refs.map((r) => r.source))];

  logger.info(
    {
      module: "tickets",
      durationMs: Date.now() - startMs,
      sources,
      configuredProviders: [...providers.keys()],
      ...status,
    },
    "ticket resolution complete",
  );

  return { tickets: results, status };
}

export async function resolveTickets(
  refs: TicketRef[],
  providers: Map<string, TicketProvider>,
): Promise<TicketInfo[]> {
  const { tickets } = await resolveTicketsWithStatus(refs, providers);
  return tickets;
}
