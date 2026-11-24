import { z } from "zod";
import type { AgentTool } from "../agent-loop.js";
import { showProgress } from "../workspace/show-progress.js";
import type { WorkspaceContext } from "../workspace/workspace-context.js";

// Optional: with a search text, only shows whose name, artist or venue contain it.
const ListShowsInputSchema = z.object({
  search: z.string().trim().max(100).optional(),
});

// The workspace assistant's way to find a show: the person names it ("Harbor
// Lights"), the model searches, then asks get_show_progress about the id it found.
export function listShowsTool(context: WorkspaceContext): AgentTool<typeof ListShowsInputSchema> {
  return {
    name: "list_shows",
    description:
      "Lists the venue's shows, newest first: id, name, date, artist, venue, settlement status and which of the four steps it is on, with the next action. Pass `search` (part of a show, artist or venue name, any case) to find the show a person means; call it without `search` for questions about all shows, such as which ones need action. Use get_show_progress with a show's id for the full detail of one show.",
    inputSchema: ListShowsInputSchema,
    run(input) {
      const needle = input.search?.toLowerCase() ?? "";
      const matching = context.shows.filter(
        (show) =>
          needle === "" ||
          [show.name, show.artistName, show.venueName].some((text) =>
            text.toLowerCase().includes(needle),
          ),
      );
      return {
        totalShows: context.shows.length,
        matching: matching.length,
        shows: matching.map((show) => {
          const progress = showProgress(show);
          return {
            showId: show.id,
            name: show.name,
            date: show.showDate,
            artist: show.artistName,
            venue: show.venueName,
            settlementStatus: show.settlement?.status ?? "not started",
            currentStep: `Step ${progress.currentStep} of 4: ${progress.steps[progress.currentStep - 1]!.title}`,
            nextAction: progress.nextAction,
          };
        }),
      };
    },
  };
}
