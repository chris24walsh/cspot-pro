import { type FormEvent, useEffect, useState } from "react";

import { getSongs, saveLyricsImport, type Song } from "../api";

export function ImportManager({ onDataChange }: { onDataChange: () => void }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [songId, setSongId] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceLabel, setSourceLabel] = useState("manual paste");
  const [lyrics, setLyrics] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      setSongs(await getSongs());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load songs.");
    }
  }

  function selectSong(nextSongId: string) {
    setSongId(nextSongId);
    const song = songs.find((candidate) => candidate.id === nextSongId);
    if (song) {
      setTitle(song.title);
      setAuthor(song.author ?? "");
      setLyrics(song.lyrics ?? "");
    }
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    try {
      const saved = await saveLyricsImport({
        title,
        author: author || null,
        lyrics,
        source_url: sourceUrl || null,
        source_label: sourceLabel || null,
        song_id: songId || null,
      });
      await load();
      onDataChange();
      setSongId(saved.song_id);
      setMessage(`Lyrics saved to "${saved.title}".`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save lyrics.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="manager-grid" aria-label="Lyrics import">
      <aside className="manager-list">
        <div className="section-heading">
          <h2>Import Queue</h2>
        </div>
        <div className="legacy-preview">
          <img alt="" src="/images/PlanOverviewNew-Small.png" />
          <p>Paste lyrics, review, then save into the song library.</p>
        </div>
        <div className="stack-list">
          {songs.map((song) => (
            <button
              className={`stack-row ${song.id === songId ? "selected" : ""}`}
              key={song.id}
              onClick={() => selectSong(song.id)}
              type="button"
            >
              <strong>{song.title}</strong>
              <span>{song.lyrics_status}</span>
            </button>
          ))}
        </div>
      </aside>

      <form className="editor-panel" onSubmit={(event) => void submitImport(event)}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Review</p>
            <h2>Lyrics Import</h2>
          </div>
          <button className="primary-button" type="submit">
            Save Lyrics
          </button>
        </div>

        {message ? <p className="form-message">{message}</p> : null}

        <div className="form-grid">
          <label>
            Existing Song
            <select onChange={(event) => selectSong(event.target.value)} value={songId}>
              <option value="">Create a new song</option>
              {songs.map((song) => (
                <option key={song.id} value={song.id}>
                  {song.title}
                </option>
              ))}
            </select>
          </label>

          <label>
            Title
            <input onChange={(event) => setTitle(event.target.value)} required value={title} />
          </label>

          <label>
            Author
            <input onChange={(event) => setAuthor(event.target.value)} value={author} />
          </label>

          <label>
            Source Label
            <input onChange={(event) => setSourceLabel(event.target.value)} value={sourceLabel} />
          </label>

          <label className="wide-field">
            Source URL
            <input
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://..."
              value={sourceUrl}
            />
          </label>

          <label className="wide-field">
            Lyrics
            <textarea
              onChange={(event) => setLyrics(event.target.value)}
              required
              rows={14}
              value={lyrics}
            />
          </label>
        </div>
      </form>
    </section>
  );
}
