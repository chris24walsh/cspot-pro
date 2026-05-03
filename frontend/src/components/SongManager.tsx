import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  createSong,
  deleteSong,
  getFiles,
  getSongs,
  parseSlideDeck,
  updateSong,
  uploadStoredFile,
  type ParsedSlideDeck,
  type Song,
  type StoredFile,
} from "../api";
import { formatWorshipText, normalizeImportedSongSlides } from "../worshipText";

type SongPayload = Omit<Song, "id" | "lyrics_status">;

function blankSong(): SongPayload {
  return {
    title: "",
    alternate_title: null,
    author: null,
    lyrics: null,
    chords: null,
    ccli_number: null,
    book_reference: null,
    license: "Unknown",
    sequence: null,
    youtube_id: null,
    external_link: null,
  };
}

function formFromSong(song: Song): SongPayload {
  return {
    title: song.title,
    alternate_title: song.alternate_title,
    author: song.author,
    lyrics: song.lyrics,
    chords: song.chords,
    ccli_number: song.ccli_number,
    book_reference: song.book_reference,
    license: song.license,
    sequence: song.sequence,
    youtube_id: song.youtube_id,
    external_link: song.external_link,
  };
}

function normalizeForm(form: SongPayload): SongPayload {
  return {
    title: form.title,
    alternate_title: form.alternate_title || null,
    author: form.author || null,
    lyrics: form.lyrics ? formatWorshipText(form.lyrics, { removeChordLines: true }) : null,
    chords: form.chords || null,
    ccli_number: form.ccli_number || null,
    book_reference: form.book_reference || null,
    license: form.license || null,
    sequence: form.sequence || null,
    youtube_id: form.youtube_id || null,
    external_link: form.external_link || null,
  };
}

export function SongManager({
  canCreate,
  canEdit,
  onDataChange,
}: {
  canCreate: boolean;
  canEdit: boolean;
  onDataChange: () => void;
}) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [mode, setMode] = useState<"edit" | "create">("edit");
  const [form, setForm] = useState<SongPayload>(blankSong());
  const [songFiles, setSongFiles] = useState<StoredFile[]>([]);
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [fileDisplayName, setFileDisplayName] = useState("");
  const [songDeckFiles, setSongDeckFiles] = useState<File[]>([]);
  const [parsedSongDeck, setParsedSongDeck] = useState<ParsedSlideDeck | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const filteredSongs = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return songs;
    }

    return songs.filter((song) =>
      [song.title, song.alternate_title, song.author, song.ccli_number]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [songs, searchTerm]);

  async function load(selectedId?: string | null) {
    setLoading(true);
    setMessage(null);

    try {
      const nextSongs = await getSongs();
      setSongs(nextSongs);
      const target =
        selectedId === null
          ? nextSongs[0]
          : nextSongs.find((song) => song.id === selectedId) ?? selectedSong ?? nextSongs[0];

      if (target) {
        setSelectedSong(target);
        setForm(formFromSong(target));
        setMode("edit");
        setSongFiles(await getFiles({ song_id: target.id }));
      } else {
        startCreate();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load songs.");
    } finally {
      setLoading(false);
    }
  }

  function startCreate() {
    setSelectedSong(null);
    setMode("create");
    setForm(blankSong());
    setSongFiles([]);
    setMessage(null);
  }

  async function selectSong(song: Song) {
    setSelectedSong(song);
    setForm(formFromSong(song));
    setMode("edit");
    setMessage(null);
    setSongFiles(await getFiles({ song_id: song.id }));
  }

  async function submitSong(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((mode === "create" && !canCreate) || (mode === "edit" && !canEdit)) {
      setMessage("You do not have permission to save songs.");
      return;
    }
    setMessage(null);

    try {
      const payload = normalizeForm(form);
      const saved =
        mode === "create" ? await createSong(payload) : await updateSong(selectedSong!.id, payload);
      await load(saved.id);
      onDataChange();
      setMessage(mode === "create" ? "Song created." : "Song updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save song.");
    }
  }

  async function removeSong() {
    if (!selectedSong) {
      return;
    }
    if (!canCreate) {
      setMessage("You do not have permission to archive songs.");
      return;
    }

    const confirmed = window.confirm(`Archive song "${selectedSong.title}"?`);
    if (!confirmed) {
      return;
    }

    setMessage(null);

    try {
      await deleteSong(selectedSong.id);
      setSelectedSong(null);
      await load(null);
      onDataChange();
      setMessage("Song archived.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not archive song.");
    }
  }

  async function uploadSongFile() {
    if (!selectedSong || !fileToUpload) {
      setMessage("Select a song and a slide file first.");
      return;
    }
    if (!canCreate) {
      setMessage("You do not have permission to attach files.");
      return;
    }

    setMessage(null);
    try {
      await uploadStoredFile({
        file: fileToUpload,
        display_name: fileDisplayName || fileToUpload.name,
        song_id: selectedSong.id,
      });
      setFileToUpload(null);
      setFileDisplayName("");
      setSongFiles(await getFiles({ song_id: selectedSong.id }));
      setMessage("Slide file attached to song.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not upload slide file.");
    }
  }

  function lyricsFromParsedDeck(deck: ParsedSlideDeck) {
    return normalizeImportedSongSlides(
      deck.slides.map((slide) => slide.text),
      deck.filename.replace(/\.[^.]+$/, ""),
    );
  }

  async function parseFirstSongDeck() {
    const [file] = songDeckFiles;
    if (!file) {
      setMessage("Choose a PowerPoint or OpenDocument song file first.");
      return;
    }
    if (!canCreate && !canEdit) {
      setMessage("You do not have permission to parse imported song slides.");
      return;
    }

    try {
      const parsed = await parseSlideDeck(file);
      const lyrics = lyricsFromParsedDeck(parsed);
      setParsedSongDeck(parsed);
      setForm({
        ...form,
        title: form.title || parsed.filename.replace(/\.[^.]+$/, ""),
        lyrics,
      });
      setMessage(`Parsed ${parsed.slide_count} slide${parsed.slide_count === 1 ? "" : "s"} into lyrics.`);
    } catch (error) {
      setParsedSongDeck(null);
      setMessage(error instanceof Error ? error.message : "Could not parse song deck.");
    }
  }

  async function bulkImportSongDecks() {
    if (!songDeckFiles.length) {
      setMessage("Choose one or more PowerPoint/OpenDocument song files first.");
      return;
    }
    if (!canCreate) {
      setMessage("You do not have permission to bulk import songs.");
      return;
    }

    setMessage(null);
    let imported = 0;
    const failures: string[] = [];

    for (const file of songDeckFiles) {
      try {
        const parsed = await parseSlideDeck(file);
        const lyrics = lyricsFromParsedDeck(parsed);
        if (!lyrics) {
          failures.push(`${file.name}: no lyrics found`);
          continue;
        }
        await createSong({
          ...blankSong(),
          title: parsed.filename.replace(/\.[^.]+$/, ""),
          lyrics,
        });
        imported += 1;
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : "failed"}`);
      }
    }

    await load(null);
    onDataChange();
    setMessage(
      failures.length
        ? `Imported ${imported}. ${failures.length} failed: ${failures.join("; ")}`
        : `Imported ${imported} song${imported === 1 ? "" : "s"}.`,
    );
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="manager-grid" aria-label="Song management">
      <aside className="manager-list">
        <div className="section-heading">
          <h2>Songs</h2>
          <button className="text-button" disabled={!canCreate} onClick={startCreate} type="button">
            New Song
          </button>
        </div>

        <label className="list-search">
          <span>Search</span>
          <input
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Title, author, CCLI"
            type="search"
            value={searchTerm}
          />
        </label>

        <div className="stack-list">
          {filteredSongs.map((song) => (
            <button
              className={`stack-row ${song.id === selectedSong?.id ? "selected" : ""}`}
              key={song.id}
              onClick={() => void selectSong(song)}
              type="button"
            >
              <strong>{song.title}</strong>
              <span>
                {song.author ?? "Unknown author"} · {song.lyrics_status}
              </span>
            </button>
          ))}
          {!filteredSongs.length ? (
            <div className="empty-state">No songs match that search.</div>
          ) : null}
        </div>
      </aside>

      <form className="editor-panel" onSubmit={(event) => void submitSong(event)}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">{mode === "create" ? "Create" : "Edit"}</p>
            <h2>{mode === "create" ? "New Song" : selectedSong?.title ?? "Song"}</h2>
          </div>
          <div className="action-row">
            {mode === "edit" ? (
              <button className="danger-button" disabled={!canCreate} onClick={() => void removeSong()} type="button">
                Archive Song
              </button>
            ) : null}
            <button className="primary-button" disabled={loading || (mode === "create" ? !canCreate : !canEdit)} type="submit">
              Save Song
            </button>
          </div>
        </div>

        {message ? <p className="form-message">{message}</p> : null}

        <details className="dropdown-panel">
          <summary>Import Song Slides</summary>
          <div className="dropdown-panel-body">
            <div className="form-grid">
              <label className="wide-field">
                PowerPoint / OpenDocument Files
                <input
                  accept=".pptx,.odp"
                  disabled={!canCreate && !canEdit}
                  multiple
                  onChange={(event) => {
                    setSongDeckFiles(Array.from(event.target.files ?? []));
                    setParsedSongDeck(null);
                  }}
                  type="file"
                />
              </label>
            </div>
            {parsedSongDeck ? (
              <div className="deck-preview">
                {parsedSongDeck.slides.slice(0, 8).map((slide) => (
                  <article className="slide-tile readonly" key={slide.index}>
                    <span>{slide.index.toString().padStart(2, "0")}</span>
                    <strong>{slide.text.split(/\r?\n/)[0] ?? `Slide ${slide.index}`}</strong>
                  </article>
                ))}
              </div>
            ) : null}
            <div className="action-row form-actions">
              <button className="text-button" disabled={!canCreate && !canEdit} onClick={() => void parseFirstSongDeck()} type="button">
                Parse Into Editor
              </button>
              <button className="primary-button" disabled={!canCreate} onClick={() => void bulkImportSongDecks()} type="button">
                Bulk Import Songs
              </button>
            </div>
          </div>
        </details>

        <div className="form-grid">
          <label>
            Title
            <input
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              required
              value={form.title}
            />
          </label>

          <label>
            Alternate Title
            <input
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, alternate_title: event.target.value })}
              value={form.alternate_title ?? ""}
            />
          </label>

          <label>
            Author
            <input
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, author: event.target.value })}
              value={form.author ?? ""}
            />
          </label>

          <label>
            License
            <select
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, license: event.target.value })}
              value={form.license ?? "Unknown"}
            >
              <option value="Unknown">Unknown</option>
              <option value="Public Domain">Public Domain</option>
              <option value="CCLI">CCLI</option>
              <option value="Other">Other</option>
            </select>
          </label>

          <label>
            CCLI Number
            <input
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, ccli_number: event.target.value })}
              value={form.ccli_number ?? ""}
            />
          </label>

          <label>
            Sequence
            <input
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, sequence: event.target.value })}
              placeholder="V1 C V2 C B C"
              value={form.sequence ?? ""}
            />
          </label>

          <label>
            YouTube ID
            <input
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, youtube_id: event.target.value })}
              value={form.youtube_id ?? ""}
            />
          </label>

          <label>
            External Link
            <input
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, external_link: event.target.value })}
              value={form.external_link ?? ""}
            />
          </label>

          <label className="wide-field">
            Book Reference
            <input
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, book_reference: event.target.value })}
              value={form.book_reference ?? ""}
            />
          </label>

          <label className="wide-field">
            Lyrics
            <div className="field-action-row">
              <button
                className="text-button"
                disabled={mode === "create" ? !canCreate : !canEdit}
                onClick={() =>
                  setForm({
                    ...form,
                    lyrics: form.lyrics ? formatWorshipText(form.lyrics, { removeChordLines: true }) : "",
                  })
                }
                type="button"
              >
                Format Lyrics
              </button>
            </div>
            <textarea
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, lyrics: event.target.value })}
              rows={8}
              value={form.lyrics ?? ""}
            />
          </label>

          <label className="wide-field">
            Chords
            <textarea
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, chords: event.target.value })}
              rows={6}
              value={form.chords ?? ""}
            />
          </label>
        </div>

        {mode === "edit" ? (
          <>
            <details className="dropdown-panel">
              <summary>Slide Files</summary>
              <div className="dropdown-panel-body">
                <div className="form-grid">
                  <label>
                    Display Name
                    <input
                      disabled={!canCreate}
                      onChange={(event) => setFileDisplayName(event.target.value)}
                      placeholder={fileToUpload?.name ?? "Optional"}
                      value={fileDisplayName}
                    />
                  </label>

                  <label>
                    File
                    <input
                      disabled={!canCreate}
                      accept=".ppt,.pptx,.pdf,.key,.txt,.png,.jpg,.jpeg"
                      onChange={(event) => setFileToUpload(event.target.files?.[0] ?? null)}
                      type="file"
                    />
                  </label>
                </div>
                <div className="action-row form-actions">
                  <button className="primary-button" disabled={!canCreate} onClick={() => void uploadSongFile()} type="button">
                    Attach File
                  </button>
                </div>
              </div>
            </details>

            <div className="stack-list compact">
              {songFiles.map((file) => (
                <div className="stack-row readonly" key={file.id}>
                  <strong>{file.display_name}</strong>
                  <span>{file.content_type ?? "file"}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </form>
    </section>
  );
}
