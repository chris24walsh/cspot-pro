import { useEffect, useMemo, useState } from "react";
import { buildAbsoluteApiUrl, type PlanItem, type RenderedSlide, type Song } from "../api";
import { buildPresentationSlides, suggestedSlideFontCap } from "../presentation";
import { contributionRequest, type GuestStatus } from "../remoteContribution";
import { AutoFitSlideText } from "./AutoFitSlideText";
import { ScaledSlideImage } from "./ScaledSlideImage";

export function RemoteServiceSlide({ token, cue }: { token: string; cue: GuestStatus["cue"] }) {
  const [content, setContent] = useState<{ item: PlanItem; songs: Song[]; rendered: Record<string, RenderedSlide[]> } | null>(null);
  const [error, setError] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const itemId = cue?.item_id;
  useEffect(() => {
    let cancelled = false;
    setContent(null); setError("");
    if (!itemId || cue?.blanked) return;
    void contributionRequest<NonNullable<typeof content>>("/guest/slide", "GET", undefined, token)
      .then(result => { if (!cancelled) setContent(result); })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [itemId, token, cue?.blanked]);
  const slides = useMemo(() => content ? buildPresentationSlides([content.item], content.songs, content.rendered) : [], [content]);
  const slide = slides[Math.max(0, (cue?.slide || 1) - 1)] || null;
  const imageUrl = slide?.imageUrl || slide?.backgroundImageUrl;
  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;
    setImage(null);
    if (!imageUrl) return;
    const match = imageUrl.match(/\/files\/([^/]+)\/(slides\/\d+\.png|download|content)(?:\?|$)/);
    if (!match) { setImage(imageUrl); return; }
    const controller = new AbortController();
    void fetch(buildAbsoluteApiUrl(`/api/v1/broadcast/contributions/guest/files/${match[1]}/${match[2] === "download" ? "content" : match[2]}`), {
      headers: { Authorization: `Bearer ${token}` }, credentials: "omit", signal: controller.signal, cache: "no-store",
    }).then(async response => {
      if (!response.ok) throw new Error("The slide image is unavailable");
      const blob = await response.blob();
      if (!cancelled) { blobUrl = URL.createObjectURL(blob); setImage(blobUrl); }
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; controller.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [imageUrl, token]);
  return <section aria-label="Current church slide"><h2>Current church slide</h2>
    <div className="remote-service-slide stage-theme-dark">
      {cue?.blanked ? <p>Church screen is blanked</p> : image ? <ScaledSlideImage alt={slide?.title || "Church slide"} src={image} fitMode={slide?.fitMode} />
        : slide?.videoUrl ? <p>{slide.title} — media playing at church</p>
        : slide ? <AutoFitSlideText text={slide.text || slide.title} maxFontSize={suggestedSlideFontCap(slide)} />
        : <p>{error || (cue ? "Loading church slide…" : "Waiting for the church presentation")}</p>}
    </div>
    {cue && <p>{cue.title} · Slide {cue.slide}</p>}
  </section>;
}
