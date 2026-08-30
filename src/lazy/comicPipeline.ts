/** Lazy-loaded comic capture + viewer — not needed until first encounter panel. */

export async function loadComicPipeline() {
  const [serviceMod, viewerMod] = await Promise.all([
    import('../comic/ComicService'),
    import('../ui/ComicViewer'),
  ]);
  return {
    ComicService: serviceMod.ComicService,
    ComicViewer: viewerMod.ComicViewer,
  };
}

export type ComicPipeline = Awaited<ReturnType<typeof loadComicPipeline>>;
