import { SCHOOL_STORIES, storyFrame } from "../sundaySchoolStories";

export function SundaySchoolStory({ storyId, step }: { storyId: string; step: number }) {
  const story = SCHOOL_STORIES[storyId];
  if (!story) return <div className="school-display-idle"><h1>Story unavailable</h1></div>;
  const frame = storyFrame(story, step);
  return <div className={`school-story-scene background-${frame.scene.background}`} key={frame.sceneIndex} aria-label={frame.scene.title}>
    <div className="school-story-sun" />
    <div className="school-story-ground" />
    {frame.layers.map((layer) => <div key={layer.id} className="school-story-layer" data-layer={layer.id} aria-hidden={!layer.visible}
      style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%`, opacity: layer.visible ? 1 : 0, transform: `rotate(${layer.rotation ?? 0}deg)` }}>
      <img className={layer.motion ? `motion-${layer.motion}` : ""} src={`${import.meta.env.BASE_URL}images/stories/${layer.asset}.svg`} alt={layer.label} draggable={false} />
    </div>)}
    <span className="school-story-caption">{frame.scene.title}</span>
  </div>;
}
