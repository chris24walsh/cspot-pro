import { useEffect, useRef, useState } from "react";

import { searchYouTubeVideos, type YouTubeVideo } from "../api";
import { extractYouTubeId } from "../presentation";

export function SongYouTubeSearch({ initialQuery, value, canEdit, onSelect, onClose }: {
  initialQuery: string;
  value: string | null;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<YouTubeVideo[]>([]);
  const [preview, setPreview] = useState<YouTubeVideo | null>(null);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const search = query.trim();
    setResults([]);
    setPreview(null);
    setNextPage(null);
    setError(null);
    const videoId = extractYouTubeId(search);
    setLoading(Boolean(search && !videoId));
    if (videoId) {
      setResults([{ id: videoId, title: "YouTube video", channel_title: videoId, thumbnail_url: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` }]);
    }
    const timer = search && !videoId ? window.setTimeout(() => {
      void searchYouTubeVideos(search).then((result) => {
        if (requestId.current !== id) return;
        setResults(result.items);
        setNextPage(result.next_page_token);
      }).catch((reason: unknown) => {
        if (requestId.current === id) setError(reason instanceof Error ? reason.message : "Could not search YouTube.");
      }).finally(() => {
        if (requestId.current === id) setLoading(false);
      });
    }, 350) : undefined;
    return () => { window.clearTimeout(timer); requestId.current += 1; };
  }, [query]);

  async function loadMore() {
    if (!nextPage || loading) return;
    const id = requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await searchYouTubeVideos(query.trim(), nextPage);
      if (requestId.current !== id) return;
      setResults((current) => [...current, ...result.items.filter((video) => !current.some((item) => item.id === video.id))]);
      setNextPage(result.next_page_token);
    } catch (reason) {
      if (requestId.current === id) setError(reason instanceof Error ? reason.message : "Could not search YouTube.");
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }

  return (
    <section className="song-youtube-search wide-field" aria-label="Song YouTube search">
      <div className="action-row">
        <strong>Find a song video</strong>
        <button type="button" onClick={onClose}>Close search</button>
      </div>
      <label>
        Search YouTube or paste a video link
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }} />
      </label>
      <div className="song-youtube-results">
        {results.map((video) => (
          <div className="song-youtube-result" key={video.id}>
            <button className="search-result-card video-search-result-card" type="button"
              aria-label={`Preview ${video.title}`} aria-pressed={preview?.id === video.id} onClick={() => setPreview(video)}>
              {video.thumbnail_url ? <img alt="" src={video.thumbnail_url} /> : null}
              <span><strong>{video.title}</strong><small>{video.channel_title} · Preview video</small></span>
            </button>
            {preview?.id === video.id ? (
              <div className="song-youtube-preview">
                <iframe
                  key={preview.id}
                  title={`Preview: ${preview.title}`}
                  src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(preview.id)}?playsinline=1&rel=0`}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                />
                <strong>{preview.title}</strong>
                <div className="action-row">
                  <button type="button" disabled={!canEdit || extractYouTubeId(value) === preview.id} onClick={() => onSelect(preview.id)}>
                    {extractYouTubeId(value) === preview.id ? "Selected for song" : "Use this video"}
                  </button>
                  <button type="button" onClick={() => setPreview(null)}>Close preview</button>
                </div>
                <small>Save the song to keep your choice. Some videos cannot be played in an embedded player.</small>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {loading ? <p role="status">Searching YouTube…</p> : null}
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {!loading && !error && query.trim() && !results.length ? <p>No videos found. Try another search.</p> : null}
      {nextPage ? <button type="button" disabled={loading} onClick={() => void loadMore()}>Load more videos</button> : null}
    </section>
  );
}
